output "prod_app_instance_profile_name" {
  value = aws_iam_instance_profile.prod_app.name
}

output "prod_kms_key_arn" {
  value = aws_kms_key.prod.arn
}

output "prod_kms_key_id" {
  value = aws_kms_key.prod.key_id
}

output "prod_lambda_role_arn" {
  value = aws_iam_role.prod_lambda.arn
}

output "prod_scanner_role_arn" {
  value = aws_iam_role.prod_scanner.arn
}

output "staging_cross_account_role_arn" {
  value = aws_iam_role.staging_cross_account.arn
}
