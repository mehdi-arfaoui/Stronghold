terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
      configuration_aliases = [aws.prod, aws.staging]
    }
    archive = {
      source = "hashicorp/archive"
    }
  }
}

locals {
  prod_bucket_name    = "stronghold-test-prod-data-${var.prod_account_id}-${var.region}"
  staging_bucket_name = "stronghold-test-staging-data-${var.staging_account_id}-${var.region}"
}

resource "aws_db_subnet_group" "prod" {
  provider   = aws.prod
  name       = "stronghold-test-prod-db-subnets"
  subnet_ids = var.prod_private_subnets

  tags = {
    Name = "stronghold-test-prod-db-subnets"
  }
}

resource "aws_db_instance" "prod" {
  provider                     = aws.prod
  identifier                   = "stronghold-test-prod-db"
  allocated_storage            = 20
  engine                       = "mysql"
  instance_class               = "db.t3.micro"
  db_name                      = "stronghold"
  username                     = "strongholdadmin"
  manage_master_user_password  = true
  storage_encrypted            = true
  kms_key_id                   = var.prod_kms_key_arn
  db_subnet_group_name         = aws_db_subnet_group.prod.name
  vpc_security_group_ids       = [var.prod_db_sg_id]
  publicly_accessible          = false
  multi_az                     = false
  skip_final_snapshot          = true
  deletion_protection          = false
  backup_retention_period      = 1
  auto_minor_version_upgrade   = true
  apply_immediately            = true

  tags = {
    Name = "stronghold-test-prod-db"
    Role = "database"
  }
}

resource "aws_s3_bucket" "prod" {
  provider      = aws.prod
  bucket        = local.prod_bucket_name
  force_destroy = true

  tags = {
    Name = local.prod_bucket_name
    Role = "data"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "prod" {
  provider = aws.prod
  bucket   = aws_s3_bucket.prod.id

  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = var.prod_kms_key_arn
      sse_algorithm     = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket" "staging" {
  provider      = aws.staging
  bucket        = local.staging_bucket_name
  force_destroy = true

  tags = {
    Name = local.staging_bucket_name
    Role = "data"
  }
}

data "archive_file" "lambda_zip" {
  type        = "zip"
  source_dir  = "${path.module}/lambda"
  output_path = "${path.module}/lambda/stronghold-test-hello.zip"
}

resource "aws_lambda_function" "prod_hello" {
  provider         = aws.prod
  function_name    = "stronghold-test-hello"
  role             = var.prod_lambda_role_arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256
  timeout          = 10

  tags = {
    Name = "stronghold-test-hello"
    Role = "lambda"
  }
}

resource "aws_route53_zone" "private" {
  provider = aws.prod
  name     = "internal.stronghold-test.local"

  vpc {
    vpc_id     = var.prod_vpc_id
    vpc_region = var.region
  }

  tags = {
    Name = "internal.stronghold-test.local"
    Role = "dns"
  }
}

resource "aws_route53_vpc_association_authorization" "staging" {
  provider   = aws.prod
  zone_id    = aws_route53_zone.private.zone_id
  vpc_id     = var.staging_vpc_id
  vpc_region = var.region
}

resource "aws_route53_zone_association" "staging" {
  provider   = aws.staging
  zone_id    = aws_route53_zone.private.zone_id
  vpc_id     = var.staging_vpc_id
  vpc_region = var.region

  depends_on = [aws_route53_vpc_association_authorization.staging]
}

resource "aws_route53_record" "db" {
  provider = aws.prod
  zone_id  = aws_route53_zone.private.zone_id
  name     = "db.internal.stronghold-test.local"
  type     = "CNAME"
  ttl      = 60
  records  = [aws_db_instance.prod.address]
}
