terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.5"
    }
  }
}

provider "aws" {
  alias   = "prod"
  region  = var.region
  profile = var.prod_profile

  default_tags {
    tags = {
      Project   = "stronghold-test"
      ManagedBy = "terraform"
    }
  }
}

provider "aws" {
  alias   = "staging"
  region  = var.region
  profile = var.staging_profile

  default_tags {
    tags = {
      Project   = "stronghold-test"
      ManagedBy = "terraform"
    }
  }
}
