// Docker Bake configuration for Stronghold
// Enables parallel builds with persistent caching

variable "CACHE_DIR" {
  default = "/tmp/.buildx-cache"
}

variable "VITE_BACKEND_URL" {
  default = "http://localhost:4000"
}

variable "VITE_API_URL" {
  default = "http://localhost:4000"
}

variable "VITE_API_KEY" {
  default = "dev-key"
}

group "default" {
  targets = ["backend", "backend-migrate", "frontend"]
}

group "backend-only" {
  targets = ["backend", "backend-migrate"]
}

group "frontend-only" {
  targets = ["frontend"]
}

target "backend" {
  context    = "./backend"
  dockerfile = "Dockerfile"
  target     = "runtime"
  tags       = ["stronghold-backend:latest"]
  cache-from = ["type=local,src=${CACHE_DIR}/backend"]
  cache-to   = ["type=local,dest=${CACHE_DIR}-new/backend,mode=max"]
}

target "backend-migrate" {
  context    = "./backend"
  dockerfile = "Dockerfile"
  target     = "migrate"
  tags       = ["stronghold-backend-migrate:latest"]
  cache-from = ["type=local,src=${CACHE_DIR}/backend"]
  cache-to   = ["type=local,dest=${CACHE_DIR}-new/backend-migrate,mode=max"]
}

target "frontend" {
  context    = "./frontend"
  dockerfile = "Dockerfile"
  target     = "runtime"
  tags       = ["stronghold-frontend:latest"]
  args = {
    VITE_BACKEND_URL = "${VITE_BACKEND_URL}"
    VITE_API_URL     = "${VITE_API_URL}"
    VITE_API_KEY     = "${VITE_API_KEY}"
  }
  cache-from = ["type=local,src=${CACHE_DIR}/frontend"]
  cache-to   = ["type=local,dest=${CACHE_DIR}-new/frontend,mode=max"]
}
