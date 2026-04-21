output "route53_private_zone_id" {
  value = aws_route53_zone.private.zone_id
}

output "prod_bucket_name" {
  value = aws_s3_bucket.prod.bucket
}

output "staging_bucket_name" {
  value = aws_s3_bucket.staging.bucket
}

output "prod_rds_identifier" {
  value = aws_db_instance.prod.identifier
}

output "prod_lambda_function_name" {
  value = aws_lambda_function.prod_hello.function_name
}
