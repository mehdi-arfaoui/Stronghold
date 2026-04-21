output "stronghold_config_yaml" {
  description = "Paste this into .stronghold/config.yml for E2E tests"
  sensitive   = false

  value = templatefile("${path.module}/stronghold-config.yaml.tpl", {
    prod_account_id    = var.prod_account_id
    staging_account_id = var.staging_account_id
    prod_profile       = var.prod_profile
    staging_profile    = var.staging_profile
    region             = var.region
  })
}

output "resource_summary" {
  description = "Key resource identifiers for the deployed test environment"
  value = {
    prod_vpc_id                = module.networking.prod_vpc_id
    staging_vpc_id             = module.networking.staging_vpc_id
    vpc_peering_connection_id  = module.networking.vpc_peering_connection_id
    prod_scanner_role_arn      = module.security.prod_scanner_role_arn
    staging_cross_role_arn     = module.security.staging_cross_account_role_arn
    prod_kms_key_arn           = module.security.prod_kms_key_arn
    route53_private_zone_id    = module.data.route53_private_zone_id
    prod_bucket_name           = module.data.prod_bucket_name
    staging_bucket_name        = module.data.staging_bucket_name
    prod_rds_identifier        = module.data.prod_rds_identifier
    prod_lambda_function_name  = module.data.prod_lambda_function_name
  }
}
