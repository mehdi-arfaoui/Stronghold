terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
      configuration_aliases = [aws.prod, aws.staging]
    }
  }
}

locals {
  prod_scanner_role_name      = "StrongholdTestScannerRole"
  prod_app_role_name          = "StrongholdTestAppRole"
  prod_lambda_role_name       = "StrongholdTestLambdaRole"
  staging_cross_role_name     = "StrongholdTestCrossAccountRole"
  staging_cross_role_arn      = "arn:aws:iam::${var.staging_account_id}:role/${local.staging_cross_role_name}"
  prod_scanner_role_arn       = "arn:aws:iam::${var.prod_account_id}:role/${local.prod_scanner_role_name}"
  staging_root_principal_arn  = "arn:aws:iam::${var.staging_account_id}:root"
}

resource "aws_iam_role" "staging_cross_account" {
  provider = aws.staging
  name     = local.staging_cross_role_name

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          AWS = local.staging_root_principal_arn
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  inline_policy {
    name = "assume-prod-scanner-role"
    policy = jsonencode({
      Version = "2012-10-17"
      Statement = [
        {
          Effect   = "Allow"
          Action   = ["sts:AssumeRole"]
          Resource = [local.prod_scanner_role_arn]
        }
      ]
    })
  }

  tags = {
    Name = local.staging_cross_role_name
    Role = "cross-account"
  }
}

resource "aws_iam_role" "prod_scanner" {
  provider = aws.prod
  name     = local.prod_scanner_role_name

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          AWS = local.staging_cross_role_arn
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  managed_policy_arns = [
    "arn:aws:iam::aws:policy/ReadOnlyAccess",
  ]

  tags = {
    Name = local.prod_scanner_role_name
    Role = "scanner"
  }
}

resource "aws_iam_role" "prod_app" {
  provider = aws.prod
  name     = local.prod_app_role_name

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = {
    Name = local.prod_app_role_name
    Role = "app"
  }
}

resource "aws_iam_instance_profile" "prod_app" {
  provider = aws.prod
  name     = "StrongholdTestAppInstanceProfile"
  role     = aws_iam_role.prod_app.name
}

resource "aws_iam_role" "prod_lambda" {
  provider = aws.prod
  name     = local.prod_lambda_role_name

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  managed_policy_arns = [
    "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
  ]

  tags = {
    Name = local.prod_lambda_role_name
    Role = "lambda"
  }
}

resource "aws_kms_key" "prod" {
  provider                = aws.prod
  description             = "Stronghold test multi-account KMS key"
  deletion_window_in_days = 7
  enable_key_rotation     = true

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowProdRootAdministration"
        Effect = "Allow"
        Principal = {
          AWS = "arn:aws:iam::${var.prod_account_id}:root"
        }
        Action   = "kms:*"
        Resource = "*"
      },
      {
        Sid    = "AllowStagingDecryptAccess"
        Effect = "Allow"
        Principal = {
          AWS = local.staging_root_principal_arn
        }
        Action = [
          "kms:Decrypt",
          "kms:DescribeKey",
          "kms:GenerateDataKey",
          "kms:GenerateDataKeyWithoutPlaintext",
          "kms:ListGrants"
        ]
        Resource = "*"
      }
    ]
  })

  tags = {
    Name = "stronghold-test-prod-kms-key"
    Role = "encryption"
  }
}

resource "aws_kms_alias" "prod" {
  provider      = aws.prod
  name          = "alias/stronghold-test-prod"
  target_key_id = aws_kms_key.prod.key_id
}

resource "aws_kms_grant" "staging_root_decrypt" {
  provider          = aws.prod
  name              = "stronghold-test-staging-root"
  key_id            = aws_kms_key.prod.key_id
  grantee_principal = local.staging_root_principal_arn
  operations = [
    "Decrypt",
    "GenerateDataKey",
  ]
}
