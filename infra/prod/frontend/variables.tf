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

variable "domain" {
  type        = string
  description = "Домен фронтенда (CNAME на CDN)."
  default     = "ege.braintent.ru"
}

variable "certificate_id" {
  type        = string
  description = "ID уже выпущенного сертификата в Certificate Manager. Если не задано — Terraform запросит managed certificate и выведет DNS-задание для reg.ru."
  default     = null
}

variable "storage_access_key" {
  type        = string
  description = "S3 access key (service account)."
  sensitive   = true
}

variable "storage_secret_key" {
  type        = string
  description = "S3 secret key (service account)."
  sensitive   = true
}

variable "frontend_bucket_name" {
  type        = string
  description = "Имя бакета под статику (должно быть глобально уникальным). Если не задано — вычисляется из domain+folder_id."
  default     = null
}
