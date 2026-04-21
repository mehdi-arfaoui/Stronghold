output "prod_vpc_id" {
  value = aws_vpc.prod.id
}

output "prod_private_subnet_ids" {
  value = [
    aws_subnet.prod_private_a.id,
    aws_subnet.prod_private_b.id,
  ]
}

output "prod_db_sg_id" {
  value = aws_security_group.prod_db.id
}

output "staging_vpc_id" {
  value = aws_vpc.staging.id
}

output "vpc_peering_connection_id" {
  value = aws_vpc_peering_connection.prod_to_staging.id
}
