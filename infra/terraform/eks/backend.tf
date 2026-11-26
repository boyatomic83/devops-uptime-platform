# Remote state in S3 with native S3 locking (Terraform >= 1.10, no DynamoDB needed).
# Create the bucket once (versioning + encryption on), then uncomment and run
#   terraform init -migrate-state
#
# terraform {
#   backend "s3" {
#     bucket       = "my-tfstate-bucket"
#     key          = "uptime-platform/eks/terraform.tfstate"
#     region       = "us-east-1"
#     encrypt      = true
#     use_lockfile = true
#   }
# }
