variable "region" {
  type = string
}

variable "prod_account_id" {
  type = string
}

variable "staging_account_id" {
  type = string
}

variable "prod_vpc_id" {
  type = string
}

variable "staging_vpc_id" {
  type = string
}

variable "prod_private_subnets" {
  type = list(string)
}

variable "prod_db_sg_id" {
  type = string
}

variable "prod_kms_key_arn" {
  type = string
}

variable "prod_kms_key_id" {
  type = string
}

variable "prod_lambda_role_arn" {
  type = string
}
