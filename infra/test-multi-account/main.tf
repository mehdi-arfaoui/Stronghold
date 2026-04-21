module "security" {
  source = "./modules/security"

  providers = {
    aws.prod    = aws.prod
    aws.staging = aws.staging
  }

  prod_account_id    = var.prod_account_id
  staging_account_id = var.staging_account_id
}

module "networking" {
  source = "./modules/networking"

  providers = {
    aws.prod    = aws.prod
    aws.staging = aws.staging
  }

  region                     = var.region
  my_ip                      = var.my_ip
  prod_account_id            = var.prod_account_id
  staging_account_id         = var.staging_account_id
  prod_instance_profile_name = module.security.prod_app_instance_profile_name
}

module "data" {
  source = "./modules/data"

  providers = {
    aws.prod    = aws.prod
    aws.staging = aws.staging
  }

  region               = var.region
  prod_account_id      = var.prod_account_id
  staging_account_id   = var.staging_account_id
  prod_vpc_id          = module.networking.prod_vpc_id
  staging_vpc_id       = module.networking.staging_vpc_id
  prod_private_subnets = module.networking.prod_private_subnet_ids
  prod_db_sg_id        = module.networking.prod_db_sg_id
  prod_kms_key_arn     = module.security.prod_kms_key_arn
  prod_kms_key_id      = module.security.prod_kms_key_id
  prod_lambda_role_arn = module.security.prod_lambda_role_arn
}
