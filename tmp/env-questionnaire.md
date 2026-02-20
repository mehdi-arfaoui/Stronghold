# Questionnaire valeurs env

Instructions: pour chaque variable, indique `KEEP` pour conserver la valeur actuelle ou remplace par une nouvelle valeur.

## PostgreSQL
- DATABASE_POOL_SIZE = __A_COMPLETER__  # actuel: non definie | example: 10
- DATABASE_URL = __A_COMPLETER__  # actuel: postgresql://pra_user:change_me_dev_only_please_override@postgres:5432/pra_platform?schema=public | example: postgresql://stronghold:CHANGE_ME_POSTGRES_PASSWORD_20+_CHARS@postgres:5432/stronghold?schema=public
- POSTGRES_DB = __A_COMPLETER__  # actuel: pra_platform | example: stronghold
- POSTGRES_PASSWORD = __A_COMPLETER__  # actuel: change_me_dev_only_please_override | example: CHANGE_ME_POSTGRES_PASSWORD_20+_CHARS
- POSTGRES_USER = __A_COMPLETER__  # actuel: pra_user | example: stronghold

## Redis
- REDIS_PASSWORD = __A_COMPLETER__  # actuel: non definie | example: CHANGE_ME_REDIS_PASSWORD_20+_CHARS
- REDIS_URL = __A_COMPLETER__  # actuel: redis://redis:6379 | example: redis://:CHANGE_ME_REDIS_PASSWORD_20+_CHARS@redis:6379

## Application
- API_PUBLIC_URL = __A_COMPLETER__  # actuel: non definie | example: 
- API_URL = __A_COMPLETER__  # actuel: non definie | example: non definie
- APP_ENV = __A_COMPLETER__  # actuel: non definie | example: development
- FRONTEND_URL = __A_COMPLETER__  # actuel: http://localhost:3000 | example: http://localhost:3000
- HOST = __A_COMPLETER__  # actuel: 0.0.0.0 | example: 0.0.0.0
- NODE_ENV = __A_COMPLETER__  # actuel: development | example: development
- PORT = __A_COMPLETER__  # actuel: 4000 | example: 4000

## Security Auth
- BCRYPT_ROUNDS = __A_COMPLETER__  # actuel: non definie | example: 12
- CREDENTIAL_ENCRYPTION_KEY = __A_COMPLETER__  # actuel: non definie | example: CHANGE_ME_HEX_64
- DISCOVERY_SECRET = __A_COMPLETER__  # actuel: dev_discovery_secret_that_is_at_least_32_characters | example: CHANGE_ME_IN_PRODUCTION_MIN_32_CHARS
- JWT_EXPIRATION = __A_COMPLETER__  # actuel: non definie | example: 24h
- JWT_SECRET = __A_COMPLETER__  # actuel: dev_jwt_secret_that_is_at_least_32_characters_long | example: CHANGE_ME_IN_PRODUCTION_MIN_32_CHARS
- LICENSE_FILE_PATH = __A_COMPLETER__  # actuel: non definie | example: 
- LICENSE_ISSUER = __A_COMPLETER__  # actuel: non definie | example: stronghold
- LICENSE_QUOTA_RESET_ENABLED = __A_COMPLETER__  # actuel: non definie | example: true
- LICENSE_SIGNING_SECRET = __A_COMPLETER__  # actuel: dev_license_signing_secret_that_is_at_least_sixty_four_characters_long_123 | example: CHANGE_ME_IN_PRODUCTION_MIN_64_CHARS
- SECRETS_MASTER_KEY = __A_COMPLETER__  # actuel: non definie | example: non definie
- SESSION_SECRET = __A_COMPLETER__  # actuel: dev_session_secret_that_is_at_least_32_chars | example: CHANGE_ME_IN_PRODUCTION_MIN_32_CHARS
- SMTP_FROM = __A_COMPLETER__  # actuel: non definie | example: non definie
- SMTP_HOST = __A_COMPLETER__  # actuel: non definie | example: non definie
- SMTP_PASSWORD = __A_COMPLETER__  # actuel: non definie | example: non definie
- SMTP_PORT = __A_COMPLETER__  # actuel: non definie | example: non definie
- SMTP_USER = __A_COMPLETER__  # actuel: non definie | example: non definie

## Storage Vector
- CHROMADB_API_TOKEN = __A_COMPLETER__  # actuel:  | example: 
- CHROMADB_COLLECTION = __A_COMPLETER__  # actuel: pra-documents | example: pra-documents
- CHROMADB_URL = __A_COMPLETER__  # actuel: http://chroma:8000 | example: http://chroma:8000
- MINIO_ROOT_PASSWORD = __A_COMPLETER__  # actuel: change_me_minio_dev_only | example: CHANGE_ME_MINIO_PASSWORD_20+_CHARS
- MINIO_ROOT_USER = __A_COMPLETER__  # actuel: minioadmin | example: stronghold_minio
- S3_ACCESS_KEY_ID = __A_COMPLETER__  # actuel: minioadmin | example: CHANGE_ME_S3_ACCESS_KEY_ID
- S3_BUCKET_PREFIX = __A_COMPLETER__  # actuel: stronghold-docs | example: stronghold-docs
- S3_ENDPOINT = __A_COMPLETER__  # actuel: http://minio:9000 | example: http://minio:9000
- S3_FORCE_PATH_STYLE = __A_COMPLETER__  # actuel: true | example: true
- S3_REGION = __A_COMPLETER__  # actuel: us-east-1 | example: us-east-1
- S3_SECRET_ACCESS_KEY = __A_COMPLETER__  # actuel: change_me_minio_dev_only | example: CHANGE_ME_S3_SECRET_ACCESS_KEY
- S3_SERVER_SIDE_ENCRYPTION = __A_COMPLETER__  # actuel: non definie | example: 
- S3_SIGNED_URL_TTL_SECONDS = __A_COMPLETER__  # actuel: 900 | example: 900
- S3_SSE_ALGORITHM = __A_COMPLETER__  # actuel: non definie | example: 
- S3_SSE_KMS_KEY_ID = __A_COMPLETER__  # actuel: non definie | example: 
- VECTOR_DB_OPTIONAL = __A_COMPLETER__  # actuel: non definie | example: false

## Seed Demo
- ALLOW_DEMO_SEED = __A_COMPLETER__  # actuel: true | example: false
- DEMO_PRA_EXERCISE_KEY = __A_COMPLETER__  # actuel: non definie | example: non definie
- DEMO_RUNBOOK_KEY = __A_COMPLETER__  # actuel: non definie | example: non definie
- OWNER_API_KEY = __A_COMPLETER__  # actuel: non definie | example: 
- OWNER_EMAIL = __A_COMPLETER__  # actuel: mehdi@stronghold.io | example: mehdi@stronghold.io
- OWNER_PASSWORD = __A_COMPLETER__  # actuel: change_me_on_first_login | example: CHANGE_ME_AT_FIRST_LOGIN
- SEED_API_KEY = __A_COMPLETER__  # actuel: dev_seed_api_key_for_local_runs | example: CHANGE_ME_DEV_API_KEY
- SEED_ON_START = __A_COMPLETER__  # actuel: non definie | example: non definie
- SEED_PLAN = __A_COMPLETER__  # actuel: PRO | example: PRO

## Frontend
- VITE_API_KEY = __A_COMPLETER__  # actuel: dev-key | example: non definie
- VITE_API_URL = __A_COMPLETER__  # actuel: /api | example: /api
- VITE_APP_VERSION = __A_COMPLETER__  # actuel: dev | example: dev
- VITE_BACKEND_URL = __A_COMPLETER__  # actuel: http://localhost:4000 | example: non definie
- VITE_ENV = __A_COMPLETER__  # actuel: development | example: development

## Workers Cron
- API_KEY_ROTATION_BATCH_SIZE = __A_COMPLETER__  # actuel: non definie | example: non definie
- API_KEY_ROTATION_DAYS_BEFORE_EXPIRY = __A_COMPLETER__  # actuel: non definie | example: non definie
- API_KEY_ROTATION_ENABLED = __A_COMPLETER__  # actuel: non definie | example: true
- API_KEY_ROTATION_NEW_TTL_DAYS = __A_COMPLETER__  # actuel: non definie | example: non definie
- CRON_API_KEY_ROTATION = __A_COMPLETER__  # actuel: non definie | example: 0 */6 * * *
- CRON_DISCOVERY = __A_COMPLETER__  # actuel: non definie | example: */30 * * * *
- CRON_DRIFT_CHECK = __A_COMPLETER__  # actuel: non definie | example: 0 6 * * 1
- CRON_LICENSE_RESET = __A_COMPLETER__  # actuel: non definie | example: 0 0 1 * *
- DISCOVERY_SCHEDULER_ENABLED = __A_COMPLETER__  # actuel: non definie | example: true
- DISCOVERY_WORKER_ENABLED = __A_COMPLETER__  # actuel: non definie | example: true
- DOCUMENT_WORKER_ENABLED = __A_COMPLETER__  # actuel: non definie | example: true
- DRIFT_CHECK_ENABLED = __A_COMPLETER__  # actuel: non definie | example: true
- HEALTHCHECK_RETRIES = __A_COMPLETER__  # actuel: non definie | example: 2
- HEALTHCHECK_RETRY_DELAY_MS = __A_COMPLETER__  # actuel: non definie | example: 500
- HEALTHCHECK_TIMEOUT_MS = __A_COMPLETER__  # actuel: non definie | example: 2000

## AI ML OCR
- ANTHROPIC_API_KEY = __A_COMPLETER__  # actuel: non definie | example: 
- ANTHROPIC_MODEL = __A_COMPLETER__  # actuel: non definie | example: non definie
- AWS_TEXTRACT_ENABLED = __A_COMPLETER__  # actuel: non definie | example: false
- AWS_TEXTRACT_REGION = __A_COMPLETER__  # actuel: non definie | example: us-east-1
- CLASSIFICATION_CACHE_ENABLED = __A_COMPLETER__  # actuel: non definie | example: true
- CLASSIFICATION_CACHE_TTL_SEC = __A_COMPLETER__  # actuel: non definie | example: 900
- DOC_CLASSIFICATION_API_KEY = __A_COMPLETER__  # actuel: non definie | example: 
- DOC_CLASSIFICATION_ENDPOINT = __A_COMPLETER__  # actuel: non definie | example: 
- DOC_CLASSIFICATION_LABEL_MAP = __A_COMPLETER__  # actuel: non definie | example: 
- DOC_CLASSIFICATION_LABELS = __A_COMPLETER__  # actuel: non definie | example: 
- DOC_CLASSIFICATION_MAX_CHARS = __A_COMPLETER__  # actuel: non definie | example: 8000
- DOC_CLASSIFICATION_MODE = __A_COMPLETER__  # actuel: non definie | example: zero-shot
- DOC_CLASSIFICATION_MODEL = __A_COMPLETER__  # actuel: non definie | example: bert
- DOC_CLASSIFICATION_PROVIDER = __A_COMPLETER__  # actuel: non definie | example: ml
- DOC_CLASSIFICATION_TIMEOUT_MS = __A_COMPLETER__  # actuel: non definie | example: 8000
- ENABLE_OCR = __A_COMPLETER__  # actuel: non definie | example: true
- ML_TRAINING_ENABLED = __A_COMPLETER__  # actuel: non definie | example: true
- ML_TRAINING_FORCE = __A_COMPLETER__  # actuel: non definie | example: non definie
- ML_TRAINING_INTERVAL_HOURS = __A_COMPLETER__  # actuel: non definie | example: 24
- ML_TRAINING_TRIGGER = __A_COMPLETER__  # actuel: non definie | example: non definie
- OCR_LANGS = __A_COMPLETER__  # actuel: non definie | example: eng+fra
- OCR_PROVIDER = __A_COMPLETER__  # actuel: non definie | example: tesseract
- OCR_TESSERACT_DOC_URL = __A_COMPLETER__  # actuel: non definie | example: non definie
- OPENAI_API_KEY = __A_COMPLETER__  # actuel: non definie | example: 
- OPENAI_CIRCUIT_BREAKER_OPEN_MS = __A_COMPLETER__  # actuel: non definie | example: 60000
- OPENAI_CIRCUIT_BREAKER_THRESHOLD = __A_COMPLETER__  # actuel: non definie | example: 0.5
- OPENAI_MODEL = __A_COMPLETER__  # actuel: non definie | example: gpt-4.1-mini
- RAG_CROSS_WEIGHTS = __A_COMPLETER__  # actuel: non definie | example: 
- RAG_FUSION_ALPHA = __A_COMPLETER__  # actuel: non definie | example: 0.5
- RAG_RECALL_KS = __A_COMPLETER__  # actuel: non definie | example: 5,10,20
- RAG_RERANKING = __A_COMPLETER__  # actuel: non definie | example: rrf

## Integrations Observability
- ALLOWED_SENSITIVE_DATA_TYPES = __A_COMPLETER__  # actuel: non definie | example: ip,email,phone,iban,secret
- AWS_ACCESS_KEY_ID = __A_COMPLETER__  # actuel: non definie | example: 
- AWS_DEFAULT_REGION = __A_COMPLETER__  # actuel: non definie | example: us-east-1
- AWS_PRICING_REGION = __A_COMPLETER__  # actuel: non definie | example: us-east-1
- AWS_REGION = __A_COMPLETER__  # actuel: non definie | example: us-east-1
- AWS_SECRET_ACCESS_KEY = __A_COMPLETER__  # actuel: non definie | example: 
- AZURE_CLIENT_ID = __A_COMPLETER__  # actuel: non definie | example: 
- AZURE_CLIENT_SECRET = __A_COMPLETER__  # actuel: non definie | example: 
- AZURE_TENANT_ID = __A_COMPLETER__  # actuel: non definie | example: 
- DLP_YARA_BIN = __A_COMPLETER__  # actuel: non definie | example: yara
- DLP_YARA_ENABLED = __A_COMPLETER__  # actuel: non definie | example: false
- DLP_YARA_RULES_PATH = __A_COMPLETER__  # actuel: non definie | example: 
- DOC_RETENTION_DAYS = __A_COMPLETER__  # actuel: non definie | example: 180
- EMBEDDING_RETENTION_DAYS = __A_COMPLETER__  # actuel: non definie | example: 365
- EXTRACTION_FAILURE_ALERT_THRESHOLD = __A_COMPLETER__  # actuel: non definie | example: 0.2
- GCP_CATALOG_ENDPOINT = __A_COMPLETER__  # actuel: non definie | example: non definie
- GCP_PRICING_API_KEY = __A_COMPLETER__  # actuel: non definie | example: 
- GCP_SERVICE_ACCOUNT_KEY = __A_COMPLETER__  # actuel: non definie | example: 
- LLM_FAILURE_ALERT_THRESHOLD = __A_COMPLETER__  # actuel: non definie | example: 0.15
- N8N_ALERT_WEBHOOK_TOKEN = __A_COMPLETER__  # actuel: non definie | example: 
- N8N_ALERT_WEBHOOK_URL = __A_COMPLETER__  # actuel: non definie | example: 
- N8N_INGESTION_CALLBACK_URL = __A_COMPLETER__  # actuel: non definie | example: 
- N8N_INGESTION_TRIGGER_URL = __A_COMPLETER__  # actuel: non definie | example: 
- N8N_WEBHOOK_TOKEN = __A_COMPLETER__  # actuel: non definie | example: 
- NMAP_PATH = __A_COMPLETER__  # actuel: non definie | example: 
- OTEL_SERVICE_NAME = __A_COMPLETER__  # actuel: non definie | example: stronghold-backend
- SCENARIO_CATALOG_SOURCE_URL = __A_COMPLETER__  # actuel: non definie | example: 
- VAULT_ADDR = __A_COMPLETER__  # actuel: non definie | example: 
- VAULT_TOKEN = __A_COMPLETER__  # actuel: non definie | example: 

## Multi tenant
- AUTO_UPDATE_ENABLED = __A_COMPLETER__  # actuel: non definie | example: true
- DEPLOYMENT_MODE = __A_COMPLETER__  # actuel: non definie | example: saas

## Autres
- ANALYZE = __A_COMPLETER__  # actuel: non definie | example: non definie
- CACHE_PREFIX = __A_COMPLETER__  # actuel: non definie | example: non definie
- CIRCUIT_BREAKER_REDIS_ENABLED = __A_COMPLETER__  # actuel: non definie | example: non definie
- COMPOSE_DOCKER_CLI_BUILD = __A_COMPLETER__  # actuel: 1 | example: 1
- CORS_ALLOW_NO_ORIGIN = __A_COMPLETER__  # actuel: true | example: false
- CORS_ALLOWED_ORIGINS = __A_COMPLETER__  # actuel: http://localhost:3000,http://127.0.0.1:3000 | example: http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173
- CORS_ORIGIN = __A_COMPLETER__  # actuel: http://localhost:3000 | example: http://localhost:3000
- CORS_ORIGINS = __A_COMPLETER__  # actuel: http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173 | example: http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173
- DISCOVERY_SCHEDULER_INTERVAL_MS = __A_COMPLETER__  # actuel: non definie | example: 60000
- DOCKER_BUILDKIT = __A_COMPLETER__  # actuel: 1 | example: 1
- DOCUMENT_DIRECT_UPLOADS_ENABLED = __A_COMPLETER__  # actuel: non definie | example: false
- DOCUMENT_ENCRYPTION_SECRET = __A_COMPLETER__  # actuel: non definie | example: CHANGE_ME_IN_PRODUCTION_MIN_32_CHARS
- DOCUMENT_INGESTION_QUEUE_MODE = __A_COMPLETER__  # actuel: non definie | example: bullmq
- IMPACT_LEVEL_MAX = __A_COMPLETER__  # actuel: non definie | example: non definie
- RUNBOOK_TEMPLATE_ALLOWED_MIME_TYPES = __A_COMPLETER__  # actuel: non definie | example: application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.oasis.opendocument.text,text/markdown
- RUNBOOK_TEMPLATE_DIRECT_UPLOADS_ENABLED = __A_COMPLETER__  # actuel: non definie | example: false
- RUNBOOK_TEMPLATE_MAX_FILE_SIZE_MB = __A_COMPLETER__  # actuel: non definie | example: 10
- STRONGHOLD_API_KEY = __A_COMPLETER__  # actuel: non definie | example: non definie
- STRONGHOLD_API_URL = __A_COMPLETER__  # actuel: non definie | example: non definie
- STRONGHOLD_BACKEND_URL = __A_COMPLETER__  # actuel: non definie | example: non definie
- TENANT_MAX_DOCUMENTS = __A_COMPLETER__  # actuel: non definie | example: 5000
- TENANT_MAX_RPM = __A_COMPLETER__  # actuel: non definie | example: 1200
- TENANT_MAX_RUNBOOKS_PER_MONTH = __A_COMPLETER__  # actuel: non definie | example: 200
- TENANT_MAX_STORAGE_GB = __A_COMPLETER__  # actuel: non definie | example: 200
- TENANT_MAX_USERS = __A_COMPLETER__  # actuel: non definie | example: 50
- TENANT_SCHEMA_PREFIX = __A_COMPLETER__  # actuel: non definie | example: tenant
- UPLOAD_ALLOWED_MIME_TYPES = __A_COMPLETER__  # actuel: non definie | example: application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document
- UPLOAD_MAX_FILE_SIZE_MB = __A_COMPLETER__  # actuel: non definie | example: 25
- UPLOAD_MAX_FILES = __A_COMPLETER__  # actuel: non definie | example: 1

