output "service_account_id" {
  value       = yandex_iam_service_account.deployer.id
  description = "Service account id."
}

output "storage_access_key" {
  value       = yandex_iam_service_account_static_access_key.storage.access_key
  description = "S3 access key."
}

output "storage_secret_key" {
  value       = yandex_iam_service_account_static_access_key.storage.secret_key
  description = "S3 secret key."
  sensitive   = true
}

output "tfstate_bucket_name" {
  value       = yandex_storage_bucket.tfstate.bucket
  description = "Bucket name for Terraform state."
}

