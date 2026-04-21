terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
      configuration_aliases = [aws.prod, aws.staging]
    }
  }
}

data "aws_ssm_parameter" "amazon_linux_2023_ami" {
  provider = aws.prod
  name     = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

resource "aws_vpc" "prod" {
  provider             = aws.prod
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "stronghold-test-prod-vpc"
    Tier = "prod"
  }
}

resource "aws_vpc" "staging" {
  provider             = aws.staging
  cidr_block           = "10.1.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "stronghold-test-staging-vpc"
    Tier = "staging"
  }
}

resource "aws_internet_gateway" "prod" {
  provider = aws.prod
  vpc_id   = aws_vpc.prod.id

  tags = {
    Name = "stronghold-test-prod-igw"
  }
}

resource "aws_internet_gateway" "staging" {
  provider = aws.staging
  vpc_id   = aws_vpc.staging.id

  tags = {
    Name = "stronghold-test-staging-igw"
  }
}

resource "aws_subnet" "prod_public_a" {
  provider                = aws.prod
  vpc_id                  = aws_vpc.prod.id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = "${var.region}a"
  map_public_ip_on_launch = true

  tags = {
    Name = "stronghold-test-prod-public-a"
    Tier = "public"
  }
}

resource "aws_subnet" "prod_private_a" {
  provider                = aws.prod
  vpc_id                  = aws_vpc.prod.id
  cidr_block              = "10.0.2.0/24"
  availability_zone       = "${var.region}a"
  map_public_ip_on_launch = false

  tags = {
    Name = "stronghold-test-prod-private-a"
    Tier = "private"
  }
}

resource "aws_subnet" "prod_private_b" {
  provider                = aws.prod
  vpc_id                  = aws_vpc.prod.id
  cidr_block              = "10.0.3.0/24"
  availability_zone       = "${var.region}b"
  map_public_ip_on_launch = false

  tags = {
    Name = "stronghold-test-prod-private-b"
    Tier = "private"
  }
}

resource "aws_subnet" "staging_public_a" {
  provider                = aws.staging
  vpc_id                  = aws_vpc.staging.id
  cidr_block              = "10.1.1.0/24"
  availability_zone       = "${var.region}a"
  map_public_ip_on_launch = true

  tags = {
    Name = "stronghold-test-staging-public-a"
    Tier = "public"
  }
}

resource "aws_subnet" "staging_private_a" {
  provider                = aws.staging
  vpc_id                  = aws_vpc.staging.id
  cidr_block              = "10.1.2.0/24"
  availability_zone       = "${var.region}a"
  map_public_ip_on_launch = false

  tags = {
    Name = "stronghold-test-staging-private-a"
    Tier = "private"
  }
}

resource "aws_route_table" "prod_public" {
  provider = aws.prod
  vpc_id   = aws_vpc.prod.id

  tags = {
    Name = "stronghold-test-prod-public-rt"
  }
}

resource "aws_route" "prod_public_internet" {
  provider               = aws.prod
  route_table_id         = aws_route_table.prod_public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.prod.id
}

resource "aws_route_table_association" "prod_public_a" {
  provider       = aws.prod
  subnet_id      = aws_subnet.prod_public_a.id
  route_table_id = aws_route_table.prod_public.id
}

resource "aws_route_table" "prod_private" {
  provider = aws.prod
  vpc_id   = aws_vpc.prod.id

  tags = {
    Name = "stronghold-test-prod-private-rt"
  }
}

resource "aws_route_table_association" "prod_private_a" {
  provider       = aws.prod
  subnet_id      = aws_subnet.prod_private_a.id
  route_table_id = aws_route_table.prod_private.id
}

resource "aws_route_table_association" "prod_private_b" {
  provider       = aws.prod
  subnet_id      = aws_subnet.prod_private_b.id
  route_table_id = aws_route_table.prod_private.id
}

resource "aws_route_table" "staging_public" {
  provider = aws.staging
  vpc_id   = aws_vpc.staging.id

  tags = {
    Name = "stronghold-test-staging-public-rt"
  }
}

resource "aws_route" "staging_public_internet" {
  provider               = aws.staging
  route_table_id         = aws_route_table.staging_public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.staging.id
}

resource "aws_route_table_association" "staging_public_a" {
  provider       = aws.staging
  subnet_id      = aws_subnet.staging_public_a.id
  route_table_id = aws_route_table.staging_public.id
}

resource "aws_route_table" "staging_private" {
  provider = aws.staging
  vpc_id   = aws_vpc.staging.id

  tags = {
    Name = "stronghold-test-staging-private-rt"
  }
}

resource "aws_route_table_association" "staging_private_a" {
  provider       = aws.staging
  subnet_id      = aws_subnet.staging_private_a.id
  route_table_id = aws_route_table.staging_private.id
}

resource "aws_security_group" "prod_app" {
  provider    = aws.prod
  name        = "stronghold-test-app-sg"
  description = "Stronghold test application security group"
  vpc_id      = aws_vpc.prod.id

  ingress {
    description = "SSH from operator"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.my_ip]
  }

  ingress {
    description = "HTTP from prod VPC"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = [aws_vpc.prod.cidr_block]
  }

  ingress {
    description = "HTTPS from prod VPC"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [aws_vpc.prod.cidr_block]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "stronghold-test-app-sg"
  }
}

resource "aws_security_group" "prod_db" {
  provider    = aws.prod
  name        = "stronghold-test-db-sg"
  description = "Stronghold test database security group"
  vpc_id      = aws_vpc.prod.id

  ingress {
    description     = "MySQL from app security group"
    from_port       = 3306
    to_port         = 3306
    protocol        = "tcp"
    security_groups = [aws_security_group.prod_app.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "stronghold-test-db-sg"
  }
}

resource "aws_security_group" "staging" {
  provider    = aws.staging
  name        = "stronghold-test-staging-sg"
  description = "Stronghold test staging security group"
  vpc_id      = aws_vpc.staging.id

  ingress {
    description = "SSH from operator"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.my_ip]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "stronghold-test-staging-sg"
  }
}

resource "aws_vpc_peering_connection" "prod_to_staging" {
  provider      = aws.prod
  vpc_id        = aws_vpc.prod.id
  peer_vpc_id   = aws_vpc.staging.id
  peer_owner_id = var.staging_account_id
  peer_region   = var.region
  auto_accept   = false

  tags = {
    Name = "stronghold-test-prod-to-staging"
  }
}

resource "aws_vpc_peering_connection_accepter" "staging_accept" {
  provider                  = aws.staging
  vpc_peering_connection_id = aws_vpc_peering_connection.prod_to_staging.id
  auto_accept               = true

  tags = {
    Name = "stronghold-test-staging-accept"
  }
}

resource "aws_route" "prod_public_to_staging" {
  provider                  = aws.prod
  route_table_id            = aws_route_table.prod_public.id
  destination_cidr_block    = aws_vpc.staging.cidr_block
  vpc_peering_connection_id = aws_vpc_peering_connection.prod_to_staging.id

  depends_on = [aws_vpc_peering_connection_accepter.staging_accept]
}

resource "aws_route" "prod_private_to_staging" {
  provider                  = aws.prod
  route_table_id            = aws_route_table.prod_private.id
  destination_cidr_block    = aws_vpc.staging.cidr_block
  vpc_peering_connection_id = aws_vpc_peering_connection.prod_to_staging.id

  depends_on = [aws_vpc_peering_connection_accepter.staging_accept]
}

resource "aws_route" "staging_public_to_prod" {
  provider                  = aws.staging
  route_table_id            = aws_route_table.staging_public.id
  destination_cidr_block    = aws_vpc.prod.cidr_block
  vpc_peering_connection_id = aws_vpc_peering_connection.prod_to_staging.id

  depends_on = [aws_vpc_peering_connection_accepter.staging_accept]
}

resource "aws_route" "staging_private_to_prod" {
  provider                  = aws.staging
  route_table_id            = aws_route_table.staging_private.id
  destination_cidr_block    = aws_vpc.prod.cidr_block
  vpc_peering_connection_id = aws_vpc_peering_connection.prod_to_staging.id

  depends_on = [aws_vpc_peering_connection_accepter.staging_accept]
}

resource "aws_instance" "prod_app" {
  provider                    = aws.prod
  ami                         = data.aws_ssm_parameter.amazon_linux_2023_ami.value
  instance_type               = "t3.micro"
  subnet_id                   = aws_subnet.prod_public_a.id
  vpc_security_group_ids      = [aws_security_group.prod_app.id]
  iam_instance_profile        = var.prod_instance_profile_name
  associate_public_ip_address = true

  tags = {
    Name = "stronghold-test-prod-app"
    Role = "app"
  }
}

resource "aws_instance" "staging_app" {
  provider                    = aws.staging
  ami                         = data.aws_ssm_parameter.amazon_linux_2023_ami.value
  instance_type               = "t3.micro"
  subnet_id                   = aws_subnet.staging_public_a.id
  vpc_security_group_ids      = [aws_security_group.staging.id]
  associate_public_ip_address = true

  tags = {
    Name = "stronghold-test-staging-app"
    Role = "app"
  }
}
