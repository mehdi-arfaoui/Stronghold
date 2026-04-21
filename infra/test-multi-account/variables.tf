variable "prod_account_id" {
  description = "12-digit AWS Account ID for prod"
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.prod_account_id))
    error_message = "Must be a 12-digit AWS account ID"
  }
}

variable "staging_account_id" {
  description = "12-digit AWS Account ID for staging"
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.staging_account_id))
    error_message = "Must be a 12-digit AWS account ID"
  }
}

variable "prod_profile" {
  description = "AWS CLI profile for prod account"
  type        = string
  default     = "stronghold-test-prod"
}

variable "staging_profile" {
  description = "AWS CLI profile for staging account"
  type        = string
  default     = "stronghold-test-staging"
}

variable "region" {
  description = "AWS region"
  type        = string
  default     = "eu-west-3"
}

variable "my_ip" {
  description = "Your public IP for SSH ingress (CIDR, e.g. 1.2.3.4/32)"
  type        = string
}
