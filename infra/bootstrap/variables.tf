variable "cloud_id" {
  type        = string
  description = "Yandex Cloud cloud id."
}

variable "folder_id" {
  type        = string
  description = "Yandex Cloud folder id."
}

variable "yc_token" {
  type        = string
  description = "IAM token. Удобнее задавать через env YC_TOKEN."
  sensitive   = true
  default     = null
}

variable "service_account_name" {
  type        = string
  description = "Имя service account для Terraform/деплоя."
  default     = "terraform-deployer"
}

variable "tfstate_bucket_name" {
  type        = string
  description = "Имя бакета для Terraform state (должно быть глобально уникальным). Если не задано — вычисляется из folder_id."
  default     = null
}

