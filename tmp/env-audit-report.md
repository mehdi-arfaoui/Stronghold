# Audit variables environnement

Total variables detectees: 160

## Variable : ALLOW_DEMO_SEED
- Utilisee dans : .\backend\tests\discoveryResilienceRoutes.demoSeed.test.ts, .\docker-compose.yml, docker-compose.yml:131
- Valeur actuelle (.env racine) : true
- Valeur dans docker-compose : ALLOW_DEMO_SEED: ${ALLOW_DEMO_SEED}
- Valeur dans .env.example (racine) : false
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (valeurs heterogenes entre fichiers d environnement)

## Variable : ALLOWED_SENSITIVE_DATA_TYPES
- Utilisee dans : .\backend\src\services\sensitiveDataScanService.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : ip,email,phone,iban,secret
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : ANALYZE
- Utilisee dans : .\frontend\vite.config.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : ANTHROPIC_API_KEY
- Utilisee dans : .\backend\src\routes\businessFlowRoutes.ts, .\backend\src\services\ai-flow-suggester.service.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : ANTHROPIC_MODEL
- Utilisee dans : .\backend\src\services\ai-flow-suggester.service.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : API_KEY_ROTATION_BATCH_SIZE
- Utilisee dans : .\backend\src\services\apiKeyRotationService.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : API_KEY_ROTATION_ENABLED
- Utilisee dans : .\backend\src\index.js, .\backend\src\index.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : true
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : API_PUBLIC_URL
- Utilisee dans : .\backend\src\services\documentIngestionService.js, .\backend\src\services\documentIngestionService.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : API_URL
- Utilisee dans : .\backend\scripts\discovery-cli.js
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : APP_ENV
- Utilisee dans : 
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : development
- Valeur backend/.env : non definie
- Valeur backend/.env.example : development
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : AUTO_UPDATE_ENABLED
- Utilisee dans : .\backend\src\config\deployment.js, .\backend\src\config\deployment.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : true
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : AWS_ACCESS_KEY_ID
- Utilisee dans : 
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : AWS_DEFAULT_REGION
- Utilisee dans : 
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : us-east-1
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : AWS_PRICING_REGION
- Utilisee dans : .\backend\src\services\awsPricingService.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : us-east-1
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : AWS_REGION
- Utilisee dans : .\backend\src\services\ocrService.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : us-east-1
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : AWS_SECRET_ACCESS_KEY
- Utilisee dans : 
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : AWS_TEXTRACT_ENABLED
- Utilisee dans : .\backend\src\services\ocrService.ts, .\backend\tests\ocrService.test.js
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : false
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : AWS_TEXTRACT_REGION
- Utilisee dans : .\backend\src\services\ocrService.ts, .\backend\tests\ocrService.test.js
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : us-east-1
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : AZURE_CLIENT_ID
- Utilisee dans : 
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : AZURE_CLIENT_SECRET
- Utilisee dans : 
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : AZURE_TENANT_ID
- Utilisee dans : 
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : BCRYPT_ROUNDS
- Utilisee dans : 
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : 12
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : CACHE_PREFIX
- Utilisee dans : .\backend\src\services\classificationService.js, .\backend\src\services\classificationService.ts, .\backend\src\services\licenseService.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : CHROMADB_API_TOKEN
- Utilisee dans : .\backend\src\clients\chromaClient.ts, .\backend\src\services\documentIntelligenceService.js, .\backend\src\services\documentIntelligenceService.ts, .\docker-compose.yml, docker-compose.yml:114, docker-compose.yml:85
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : CHROMADB_API_TOKEN: ${CHROMADB_API_TOKEN}
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : CHROMADB_COLLECTION
- Utilisee dans : .\backend\src\ai\ragService.js, .\backend\src\ai\ragService.ts, .\backend\src\services\documentIntelligenceService.js, .\backend\src\services\documentIntelligenceService.ts, .\docker-compose.yml, docker-compose.yml:113, docker-compose.yml:84
- Valeur actuelle (.env racine) : pra-documents
- Valeur dans docker-compose : CHROMADB_COLLECTION: ${CHROMADB_COLLECTION}
- Valeur dans .env.example (racine) : pra-documents
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : non (aucun conflit detecte)

## Variable : CHROMADB_URL
- Utilisee dans : .\backend\src\clients\chromaClient.ts, .\backend\src\index.js, .\backend\src\index.ts, .\backend\src\services\documentIntelligenceService.js, .\backend\src\services\documentIntelligenceService.ts, .\backend\tests\documentIntelligenceIntegration.test.js, .\docker-compose.yml, docker-compose.yml:112, docker-compose.yml:83
- Valeur actuelle (.env racine) : http://chroma:8000
- Valeur dans docker-compose : CHROMADB_URL: ${CHROMADB_URL}
- Valeur dans .env.example (racine) : http://chroma:8000
- Valeur backend/.env : non definie
- Valeur backend/.env.example : http://localhost:8000
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (valeurs heterogenes entre fichiers d environnement)

## Variable : CIRCUIT_BREAKER_REDIS_ENABLED
- Utilisee dans : .\backend\src\ai\circuitBreakerStore.js, .\backend\src\ai\circuitBreakerStore.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : CLASSIFICATION_CACHE_ENABLED
- Utilisee dans : .\backend\src\services\classificationService.js, .\backend\src\services\classificationService.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : true
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : CLASSIFICATION_CACHE_TTL_SEC
- Utilisee dans : .\backend\src\services\classificationService.js, .\backend\src\services\classificationService.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : 900
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : COMPOSE_DOCKER_CLI_BUILD
- Utilisee dans : .\docker-compose.yml, docker-compose.yml:102, docker-compose.yml:158, docker-compose.yml:73
- Valeur actuelle (.env racine) : 1
- Valeur dans docker-compose : COMPOSE_DOCKER_CLI_BUILD: ${COMPOSE_DOCKER_CLI_BUILD}
- Valeur dans .env.example (racine) : 1
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : non (aucun conflit detecte)

## Variable : CORS_ALLOW_NO_ORIGIN
- Utilisee dans : .\backend\src\index.js, .\docker-compose.yml, docker-compose.yml:109
- Valeur actuelle (.env racine) : true
- Valeur dans docker-compose : CORS_ALLOW_NO_ORIGIN: ${CORS_ALLOW_NO_ORIGIN}
- Valeur dans .env.example (racine) : false
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (valeurs heterogenes entre fichiers d environnement)

## Variable : CORS_ALLOWED_ORIGINS
- Utilisee dans : .\backend\src\config\env.validation.ts, .\backend\src\index.js, .\docker-compose.yml, docker-compose.yml:107
- Valeur actuelle (.env racine) : http://localhost:3000,http://127.0.0.1:3000
- Valeur dans docker-compose : CORS_ALLOWED_ORIGINS: ${CORS_ALLOWED_ORIGINS}
- Valeur dans .env.example (racine) : http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (valeurs heterogenes entre fichiers d environnement)

## Variable : CORS_ORIGIN
- Utilisee dans : .\backend\src\config\env.validation.ts, .\backend\src\index.js, .\docker-compose.yml, docker-compose.yml:108
- Valeur actuelle (.env racine) : http://localhost:3000
- Valeur dans docker-compose : CORS_ORIGIN: ${CORS_ORIGIN}
- Valeur dans .env.example (racine) : http://localhost:3000
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : non (aucun conflit detecte)

## Variable : CORS_ORIGINS
- Utilisee dans : .\backend\src\config\env.validation.ts, .\backend\src\index.ts, .\docker-compose.yml, docker-compose.yml:110
- Valeur actuelle (.env racine) : http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173
- Valeur dans docker-compose : CORS_ORIGINS: ${CORS_ORIGINS}
- Valeur dans .env.example (racine) : http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173
- Valeur backend/.env : non definie
- Valeur backend/.env.example : http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : non (aucun conflit detecte)

## Variable : CREDENTIAL_ENCRYPTION_KEY
- Utilisee dans : .\backend\src\routes\discoveryResilienceRoutes.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : CHANGE_ME_HEX_64
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : CREDENTIAL_ENCRYPTION_KEY_ENV
- Utilisee dans : .\backend\src\utils\credential-encryption.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : CRON_API_KEY_ROTATION
- Utilisee dans : .\backend\src\workers\apiKeyRotationWorker.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : 0 */6 * * *
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : CRON_DISCOVERY
- Utilisee dans : .\backend\src\workers\discoveryScheduler.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : */30 * * * *
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : CRON_DRIFT_CHECK
- Utilisee dans : .\backend\src\workers\driftScheduler.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : 0 6 * * 1
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : CRON_LICENSE_RESET
- Utilisee dans : .\backend\src\workers\licenseQuotaResetWorker.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : 0 0 1 * *
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : DATABASE_POOL_SIZE
- Utilisee dans : 
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : 10
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : DATABASE_URL
- Utilisee dans : .\backend\prisma\schema.prisma
- Valeur actuelle (.env racine) : postgresql://pra_user:change_me_dev_only_please_override@postgres:5432/pra_platform?schema=public
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : postgresql://stronghold:CHANGE_ME_POSTGRES_PASSWORD_20+_CHARS@postgres:5432/stronghold?schema=public
- Valeur backend/.env : postgresql://pra_user:change_me@localhost:5432/pra_platform?schema=public
- Valeur backend/.env.example : postgresql://stronghold:CHANGE_ME_POSTGRES_PASSWORD_20+_CHARS@localhost:5432/stronghold?schema=public
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (valeurs differentes entre .env racine et backend/.env)

## Variable : DEMO_PRA_EXERCISE_KEY
- Utilisee dans : .\backend\src\services\demoOnboardingService.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : DEMO_RUNBOOK_KEY
- Utilisee dans : .\backend\src\services\demoOnboardingService.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : DEPLOYMENT_MODE
- Utilisee dans : .\backend\src\config\deployment.js, .\backend\src\config\deployment.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : saas
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : DISCOVERY_SCHEDULER_ENABLED
- Utilisee dans : .\backend\src\index.js, .\backend\src\index.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : true
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : DISCOVERY_SCHEDULER_INTERVAL_MS
- Utilisee dans : .\backend\src\services\discoveryScheduleService.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : 60000
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : DISCOVERY_SECRET
- Utilisee dans : .\backend\src\routes\discoveryRoutes.ts, .\backend\src\workers\discoveryWorker.ts, .\docker-compose.yml, docker-compose.yml:127
- Valeur actuelle (.env racine) : dev_discovery_secret_that_is_at_least_32_characters
- Valeur dans docker-compose : DISCOVERY_SECRET: ${DISCOVERY_SECRET}
- Valeur dans .env.example (racine) : CHANGE_ME_IN_PRODUCTION_MIN_32_CHARS
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (valeurs heterogenes entre fichiers d environnement)

## Variable : DISCOVERY_WORKER_ENABLED
- Utilisee dans : .\backend\src\index.js, .\backend\src\index.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : true
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : DLP_YARA_BIN
- Utilisee dans : .\backend\src\services\sensitiveDataScanService.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : yara
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : DLP_YARA_ENABLED
- Utilisee dans : .\backend\src\services\sensitiveDataScanService.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : false
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : DLP_YARA_RULES_PATH
- Utilisee dans : .\backend\src\services\sensitiveDataScanService.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : DOC_CLASSIFICATION_API_KEY
- Utilisee dans : .\backend\src\services\documentTypeClassificationService.js, .\backend\src\services\documentTypeClassificationService.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : DOC_CLASSIFICATION_ENDPOINT
- Utilisee dans : .\backend\src\services\documentTypeClassificationService.js, .\backend\src\services\documentTypeClassificationService.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : DOC_CLASSIFICATION_LABEL_MAP
- Utilisee dans : .\backend\src\services\documentTypeClassificationService.js, .\backend\src\services\documentTypeClassificationService.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : DOC_CLASSIFICATION_LABELS
- Utilisee dans : .\backend\src\services\documentTypeClassificationService.js, .\backend\src\services\documentTypeClassificationService.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : DOC_CLASSIFICATION_MAX_CHARS
- Utilisee dans : .\backend\src\services\documentTypeClassificationService.js, .\backend\src\services\documentTypeClassificationService.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : 8000
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : DOC_CLASSIFICATION_MODE
- Utilisee dans : .\backend\src\services\documentTypeClassificationService.js, .\backend\src\services\documentTypeClassificationService.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : zero-shot
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : DOC_CLASSIFICATION_MODEL
- Utilisee dans : .\backend\src\services\documentClassificationFeedbackService.js, .\backend\src\services\documentClassificationFeedbackService.ts, .\backend\src\services\documentTypeClassificationService.js, .\backend\src\services\documentTypeClassificationService.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : bert
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : DOC_CLASSIFICATION_PROVIDER
- Utilisee dans : .\backend\src\services\documentTypeClassificationService.js, .\backend\src\services\documentTypeClassificationService.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : ml
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : DOC_CLASSIFICATION_TIMEOUT_MS
- Utilisee dans : .\backend\src\services\documentTypeClassificationService.js, .\backend\src\services\documentTypeClassificationService.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : 8000
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : DOC_RETENTION_DAYS
- Utilisee dans : .\backend\src\config\observability.js, .\backend\src\config\observability.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : 180
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : DOCKER_BUILDKIT
- Utilisee dans : .\docker-compose.yml, docker-compose.yml:101, docker-compose.yml:157, docker-compose.yml:72
- Valeur actuelle (.env racine) : 1
- Valeur dans docker-compose : DOCKER_BUILDKIT: ${DOCKER_BUILDKIT}
- Valeur dans .env.example (racine) : 1
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : non (aucun conflit detecte)

## Variable : DOCUMENT_DIRECT_UPLOADS_ENABLED
- Utilisee dans : .\backend\src\routes\documentRoutes.js, .\backend\src\routes\documentRoutes.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : false
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : DOCUMENT_ENCRYPTION_SECRET
- Utilisee dans : .\backend\src\services\encryptionService.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : CHANGE_ME_IN_PRODUCTION_MIN_32_CHARS
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : DOCUMENT_INGESTION_QUEUE_MODE
- Utilisee dans : .\backend\src\services\documentIngestionService.js, .\backend\src\services\documentIngestionService.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : bullmq
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : DOCUMENT_WORKER_ENABLED
- Utilisee dans : .\backend\src\index.js, .\backend\src\index.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : true
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : DRIFT_CHECK_ENABLED
- Utilisee dans : .\backend\src\index.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : true
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : EMBEDDING_RETENTION_DAYS
- Utilisee dans : .\backend\src\config\observability.js, .\backend\src\config\observability.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : 365
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : ENABLE_OCR
- Utilisee dans : .\backend\src\services\documentIngestionService.js, .\backend\src\services\ocrService.ts, .\backend\tests\ocrService.test.js
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : true
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : EXTRACTION_FAILURE_ALERT_THRESHOLD
- Utilisee dans : .\backend\src\config\observability.js, .\backend\src\config\observability.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : 0.2
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : FRONTEND_URL
- Utilisee dans : .\backend\src\index.js, .\docker-compose.yml, docker-compose.yml:106
- Valeur actuelle (.env racine) : http://localhost:3000
- Valeur dans docker-compose : FRONTEND_URL: ${FRONTEND_URL}
- Valeur dans .env.example (racine) : http://localhost:3000
- Valeur backend/.env : non definie
- Valeur backend/.env.example : http://localhost:3000
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : non (aucun conflit detecte)

## Variable : GCP_CATALOG_ENDPOINT
- Utilisee dans : .\backend\src\services\gcpPricingService.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : GCP_PRICING_API_KEY
- Utilisee dans : .\backend\src\services\gcpPricingService.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : GCP_SERVICE_ACCOUNT_KEY
- Utilisee dans : 
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : HEALTHCHECK_RETRIES
- Utilisee dans : .\backend\src\index.js, .\backend\src\index.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : 2
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : HEALTHCHECK_RETRY_DELAY_MS
- Utilisee dans : .\backend\src\index.js, .\backend\src\index.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : 500
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : HEALTHCHECK_TIMEOUT_MS
- Utilisee dans : .\backend\src\index.js, .\backend\src\index.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : 2000
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : HOST
- Utilisee dans : .\backend\src\index.js, .\backend\src\index.ts, .\docker-compose.yml, docker-compose.yml:105
- Valeur actuelle (.env racine) : 0.0.0.0
- Valeur dans docker-compose : HOST: ${HOST}
- Valeur dans .env.example (racine) : 0.0.0.0
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : non (aucun conflit detecte)

## Variable : IMPACT_LEVEL_MAX
- Utilisee dans : .\backend\src\routes\biaRoutes.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : JWT_EXPIRATION
- Utilisee dans : 
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : 24h
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : JWT_SECRET
- Utilisee dans : .\docker-compose.yml, docker-compose.yml:124
- Valeur actuelle (.env racine) : dev_jwt_secret_that_is_at_least_32_characters_long
- Valeur dans docker-compose : JWT_SECRET: ${JWT_SECRET}
- Valeur dans .env.example (racine) : CHANGE_ME_IN_PRODUCTION_MIN_32_CHARS
- Valeur backend/.env : non definie
- Valeur backend/.env.example : CHANGE_ME_IN_PRODUCTION_MIN_32_CHARS
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (valeurs heterogenes entre fichiers d environnement)

## Variable : LICENSE_FILE_PATH
- Utilisee dans : .\backend\src\config\deployment.js, .\backend\src\config\deployment.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : LICENSE_ISSUER
- Utilisee dans : 
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : stronghold
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : LICENSE_QUOTA_RESET_ENABLED
- Utilisee dans : .\backend\src\index.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : true
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : LICENSE_SIGNING_SECRET
- Utilisee dans : .\docker-compose.yml, docker-compose.yml:126
- Valeur actuelle (.env racine) : dev_license_signing_secret_that_is_at_least_sixty_four_characters_long_123
- Valeur dans docker-compose : LICENSE_SIGNING_SECRET: ${LICENSE_SIGNING_SECRET}
- Valeur dans .env.example (racine) : CHANGE_ME_IN_PRODUCTION_MIN_64_CHARS
- Valeur backend/.env : non definie
- Valeur backend/.env.example : CHANGE_ME_IN_PRODUCTION_MIN_64_CHARS
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (valeurs heterogenes entre fichiers d environnement)

## Variable : LLM_FAILURE_ALERT_THRESHOLD
- Utilisee dans : .\backend\src\config\observability.js, .\backend\src\config\observability.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : 0.15
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : MASTER_KEY_ENV
- Utilisee dans : .\backend\src\services\secretVaultService.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : MINIO_ROOT_PASSWORD
- Utilisee dans : .\docker-compose.yml, docker-compose.yml:24
- Valeur actuelle (.env racine) : change_me_minio_dev_only
- Valeur dans docker-compose : MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD}
- Valeur dans .env.example (racine) : CHANGE_ME_MINIO_PASSWORD_20+_CHARS
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (valeurs heterogenes entre fichiers d environnement)

## Variable : MINIO_ROOT_USER
- Utilisee dans : .\docker-compose.yml, docker-compose.yml:23
- Valeur actuelle (.env racine) : minioadmin
- Valeur dans docker-compose : MINIO_ROOT_USER: ${MINIO_ROOT_USER}
- Valeur dans .env.example (racine) : stronghold_minio
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (valeurs heterogenes entre fichiers d environnement)

## Variable : ML_TRAINING_ENABLED
- Utilisee dans : .\backend\src\services\mlTrainingService.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : true
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : ML_TRAINING_FORCE
- Utilisee dans : .\backend\scripts\retrainModels.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : ML_TRAINING_INTERVAL_HOURS
- Utilisee dans : .\backend\src\services\mlTrainingService.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : 24
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : ML_TRAINING_TRIGGER
- Utilisee dans : .\backend\scripts\retrainModels.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : N8N_ALERT_WEBHOOK_TOKEN
- Utilisee dans : .\backend\src\services\n8nAlertService.js, .\backend\src\services\n8nAlertService.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : N8N_ALERT_WEBHOOK_URL
- Utilisee dans : .\backend\src\services\n8nAlertService.js, .\backend\src\services\n8nAlertService.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : N8N_INGESTION_CALLBACK_URL
- Utilisee dans : .\backend\src\services\documentIngestionService.js, .\backend\src\services\documentIngestionService.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : N8N_INGESTION_TRIGGER_URL
- Utilisee dans : .\backend\src\services\documentIngestionService.js, .\backend\src\services\documentIngestionService.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : N8N_WEBHOOK_TOKEN
- Utilisee dans : .\backend\src\routes\webhookRoutes.js, .\backend\src\routes\webhookRoutes.ts, .\backend\src\services\documentIngestionService.js, .\backend\src\services\documentIngestionService.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : NMAP_PATH
- Utilisee dans : .\backend\src\services\discoveryConnectors.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : NODE_ENV
- Utilisee dans : .\backend\src\filters\global-exception.filter.ts, .\backend\src\index.js, .\backend\src\index.ts, .\backend\src\services\currency.service.ts, .\backend\tests\discoveryResilienceRoutes.demoSeed.test.ts, .\docker-compose.yml, docker-compose.yml:103
- Valeur actuelle (.env racine) : development
- Valeur dans docker-compose : NODE_ENV: ${NODE_ENV}
- Valeur dans .env.example (racine) : development
- Valeur backend/.env : non definie
- Valeur backend/.env.example : development
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : non (aucun conflit detecte)

## Variable : OCR_LANGS
- Utilisee dans : .\backend\src\services\documentIngestionService.js, .\backend\src\services\ocrService.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : eng+fra
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : OCR_PROVIDER
- Utilisee dans : .\backend\src\services\ocrService.ts, .\backend\tests\ocrService.test.js
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : tesseract
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : OCR_TESSERACT_DOC_URL
- Utilisee dans : .\backend\src\services\ocrService.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : OPENAI_API_KEY
- Utilisee dans : .\backend\src\ai\extractedFactsAnalyzer.js, .\backend\src\ai\extractedFactsAnalyzer.ts, .\backend\tests\openAiAnalyzer.test.js
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : OPENAI_CIRCUIT_BREAKER_OPEN_MS
- Utilisee dans : .\backend\src\ai\extractedFactsAnalyzer.js, .\backend\src\ai\extractedFactsAnalyzer.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : 60000
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : OPENAI_CIRCUIT_BREAKER_THRESHOLD
- Utilisee dans : .\backend\src\ai\extractedFactsAnalyzer.js, .\backend\src\ai\extractedFactsAnalyzer.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : 0.5
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : OPENAI_MODEL
- Utilisee dans : .\backend\src\ai\extractedFactsAnalyzer.js, .\backend\src\ai\extractedFactsAnalyzer.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : gpt-4.1-mini
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : OTEL_SERVICE_NAME
- Utilisee dans : .\backend\src\observability\telemetry.js, .\backend\src\observability\telemetry.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : stronghold-backend
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : OWNER_API_KEY
- Utilisee dans : .\backend\prisma\seed.cjs, .\docker-compose.yml, docker-compose.yml:129, docker-compose.yml:89
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : OWNER_API_KEY: ${OWNER_API_KEY:-}
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : OWNER_EMAIL
- Utilisee dans : .\backend\prisma\seed.cjs, .\docker-compose.yml, docker-compose.yml:128
- Valeur actuelle (.env racine) : mehdi@stronghold.io
- Valeur dans docker-compose : OWNER_EMAIL: ${OWNER_EMAIL}
- Valeur dans .env.example (racine) : mehdi@stronghold.io
- Valeur backend/.env : non definie
- Valeur backend/.env.example : mehdi@stronghold.io
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : non (aucun conflit detecte)

## Variable : OWNER_PASSWORD
- Utilisee dans : .\docker-compose.yml, docker-compose.yml:130
- Valeur actuelle (.env racine) : change_me_on_first_login
- Valeur dans docker-compose : OWNER_PASSWORD: ${OWNER_PASSWORD}
- Valeur dans .env.example (racine) : CHANGE_ME_AT_FIRST_LOGIN
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (valeurs heterogenes entre fichiers d environnement)

## Variable : PORT
- Utilisee dans : .\backend\src\index.js, .\backend\src\index.ts, .\docker-compose.yml, docker-compose.yml:104
- Valeur actuelle (.env racine) : 4000
- Valeur dans docker-compose : PORT: ${PORT}
- Valeur dans .env.example (racine) : 4000
- Valeur backend/.env : non definie
- Valeur backend/.env.example : 4000
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : non (aucun conflit detecte)

## Variable : POSTGRES_DB
- Utilisee dans : .\docker-compose.yml, docker-compose.yml:111, docker-compose.yml:13, docker-compose.yml:74, docker-compose.yml:9
- Valeur actuelle (.env racine) : pra_platform
- Valeur dans docker-compose : POSTGRES_DB: ${POSTGRES_DB} | test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"] | DATABASE_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}?schema=public
- Valeur dans .env.example (racine) : stronghold
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (valeurs heterogenes entre fichiers d environnement)

## Variable : POSTGRES_PASSWORD
- Utilisee dans : .\docker-compose.yml, docker-compose.yml:111, docker-compose.yml:74, docker-compose.yml:8
- Valeur actuelle (.env racine) : change_me_dev_only_please_override
- Valeur dans docker-compose : POSTGRES_PASSWORD: ${POSTGRES_PASSWORD} | DATABASE_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}?schema=public
- Valeur dans .env.example (racine) : CHANGE_ME_POSTGRES_PASSWORD_20+_CHARS
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (valeurs heterogenes entre fichiers d environnement)

## Variable : POSTGRES_USER
- Utilisee dans : .\docker-compose.yml, docker-compose.yml:111, docker-compose.yml:13, docker-compose.yml:7, docker-compose.yml:74
- Valeur actuelle (.env racine) : pra_user
- Valeur dans docker-compose : POSTGRES_USER: ${POSTGRES_USER} | test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"] | DATABASE_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}?schema=public
- Valeur dans .env.example (racine) : stronghold
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (valeurs heterogenes entre fichiers d environnement)

## Variable : RAG_CROSS_WEIGHTS
- Utilisee dans : .\backend\src\ai\ragService.js, .\backend\src\ai\ragService.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : RAG_FUSION_ALPHA
- Utilisee dans : .\backend\src\ai\ragService.js, .\backend\src\ai\ragService.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : 0.5
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : RAG_RECALL_KS
- Utilisee dans : .\backend\src\ai\ragService.js, .\backend\src\ai\ragService.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : 5,10,20
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : RAG_RERANKING
- Utilisee dans : .\backend\src\ai\ragService.js, .\backend\src\ai\ragService.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : rrf
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : REDIS_PASSWORD
- Utilisee dans : .\backend\src\utils\redisConnection.ts, .\docker-compose.yml, docker-compose.yml:123, docker-compose.yml:55, docker-compose.yml:57, docker-compose.yml:82
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : command: ["redis-server", "--appendonly", "yes", "--requirepass", "${REDIS_PASSWORD}"] | test: ["CMD-SHELL", "redis-cli -a \"${REDIS_PASSWORD}\" ping"] | REDIS_PASSWORD: ${REDIS_PASSWORD}
- Valeur dans .env.example (racine) : CHANGE_ME_REDIS_PASSWORD_20+_CHARS
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine; REDIS_PASSWORD manquant alors que redis compose le requiert)

## Variable : REDIS_URL
- Utilisee dans : .\backend\src\ai\circuitBreakerStore.js, .\backend\src\ai\circuitBreakerStore.ts, .\backend\src\index.js, .\backend\src\queues\documentIngestionQueue.js, .\backend\src\services\classificationService.js, .\backend\src\services\classificationService.ts, .\backend\src\utils\redisConnection.ts, .\backend\tests\financialMultiTenantE2E.test.ts, .\docker-compose.yml, docker-compose.yml:122, docker-compose.yml:81
- Valeur actuelle (.env racine) : redis://redis:6379
- Valeur dans docker-compose : REDIS_URL: ${REDIS_URL}
- Valeur dans .env.example (racine) : redis://:CHANGE_ME_REDIS_PASSWORD_20+_CHARS@redis:6379
- Valeur backend/.env : non definie
- Valeur backend/.env.example : redis://localhost:6379
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (valeurs heterogenes entre fichiers d environnement; URL Redis sans mot de passe alors que redis compose active requirepass)

## Variable : RUNBOOK_TEMPLATE_ALLOWED_MIME_TYPES
- Utilisee dans : .\backend\src\routes\runbookRoutes.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.oasis.opendocument.text,text/markdown
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : RUNBOOK_TEMPLATE_DIRECT_UPLOADS_ENABLED
- Utilisee dans : .\backend\src\routes\runbookRoutes.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : false
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : RUNBOOK_TEMPLATE_MAX_FILE_SIZE_MB
- Utilisee dans : .\backend\src\routes\runbookRoutes.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : 10
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : S3_ACCESS_KEY_ID
- Utilisee dans : .\backend\src\clients\s3Client.js, .\backend\src\clients\s3Client.ts, .\docker-compose.yml, docker-compose.yml:117, docker-compose.yml:77
- Valeur actuelle (.env racine) : minioadmin
- Valeur dans docker-compose : S3_ACCESS_KEY_ID: ${S3_ACCESS_KEY_ID}
- Valeur dans .env.example (racine) : CHANGE_ME_S3_ACCESS_KEY_ID
- Valeur backend/.env : non definie
- Valeur backend/.env.example : CHANGE_ME_S3_ACCESS_KEY_ID
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (valeurs heterogenes entre fichiers d environnement)

## Variable : S3_BUCKET_PREFIX
- Utilisee dans : .\backend\src\clients\s3Client.js, .\backend\src\clients\s3Client.ts, .\docker-compose.yml, docker-compose.yml:119, docker-compose.yml:79
- Valeur actuelle (.env racine) : stronghold-docs
- Valeur dans docker-compose : S3_BUCKET_PREFIX: ${S3_BUCKET_PREFIX}
- Valeur dans .env.example (racine) : stronghold-docs
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : non (aucun conflit detecte)

## Variable : S3_ENDPOINT
- Utilisee dans : .\backend\src\clients\s3Client.js, .\backend\src\clients\s3Client.ts, .\backend\src\index.js, .\backend\src\index.ts, .\docker-compose.yml, docker-compose.yml:115, docker-compose.yml:75
- Valeur actuelle (.env racine) : http://minio:9000
- Valeur dans docker-compose : S3_ENDPOINT: ${S3_ENDPOINT}
- Valeur dans .env.example (racine) : http://minio:9000
- Valeur backend/.env : non definie
- Valeur backend/.env.example : http://localhost:9000
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (valeurs heterogenes entre fichiers d environnement)

## Variable : S3_FORCE_PATH_STYLE
- Utilisee dans : .\backend\src\clients\s3Client.js, .\backend\src\clients\s3Client.ts, .\docker-compose.yml, docker-compose.yml:120, docker-compose.yml:80
- Valeur actuelle (.env racine) : true
- Valeur dans docker-compose : S3_FORCE_PATH_STYLE: ${S3_FORCE_PATH_STYLE}
- Valeur dans .env.example (racine) : true
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : non (aucun conflit detecte)

## Variable : S3_REGION
- Utilisee dans : .\backend\src\clients\s3Client.js, .\backend\src\clients\s3Client.ts, .\docker-compose.yml, docker-compose.yml:116, docker-compose.yml:76
- Valeur actuelle (.env racine) : us-east-1
- Valeur dans docker-compose : S3_REGION: ${S3_REGION}
- Valeur dans .env.example (racine) : us-east-1
- Valeur backend/.env : non definie
- Valeur backend/.env.example : us-east-1
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : non (aucun conflit detecte)

## Variable : S3_SECRET_ACCESS_KEY
- Utilisee dans : .\backend\src\clients\s3Client.js, .\backend\src\clients\s3Client.ts, .\docker-compose.yml, docker-compose.yml:118, docker-compose.yml:78
- Valeur actuelle (.env racine) : change_me_minio_dev_only
- Valeur dans docker-compose : S3_SECRET_ACCESS_KEY: ${S3_SECRET_ACCESS_KEY}
- Valeur dans .env.example (racine) : CHANGE_ME_S3_SECRET_ACCESS_KEY
- Valeur backend/.env : non definie
- Valeur backend/.env.example : CHANGE_ME_S3_SECRET_ACCESS_KEY
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (valeurs heterogenes entre fichiers d environnement)

## Variable : S3_SERVER_SIDE_ENCRYPTION
- Utilisee dans : .\backend\src\clients\s3Client.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : S3_SIGNED_URL_TTL_SECONDS
- Utilisee dans : .\backend\src\clients\s3Client.js, .\backend\src\clients\s3Client.ts, .\docker-compose.yml, docker-compose.yml:121
- Valeur actuelle (.env racine) : 900
- Valeur dans docker-compose : S3_SIGNED_URL_TTL_SECONDS: ${S3_SIGNED_URL_TTL_SECONDS}
- Valeur dans .env.example (racine) : 900
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : non (aucun conflit detecte)

## Variable : S3_SSE_ALGORITHM
- Utilisee dans : .\backend\src\clients\s3Client.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : S3_SSE_KMS_KEY_ID
- Utilisee dans : .\backend\src\clients\s3Client.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : SCENARIO_CATALOG_SOURCE_URL
- Utilisee dans : .\backend\src\services\scenarioCatalogService.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : SEED_API_KEY
- Utilisee dans : .\backend\prisma\seed.cjs, .\backend\prisma\seed-demo.ts, .\docker-compose.yml, docker-compose.yml:87
- Valeur actuelle (.env racine) : dev_seed_api_key_for_local_runs
- Valeur dans docker-compose : SEED_API_KEY: ${SEED_API_KEY}
- Valeur dans .env.example (racine) : CHANGE_ME_DEV_API_KEY
- Valeur backend/.env : stronghold-dev-seed-2026
- Valeur backend/.env.example : CHANGE_ME_DEV_API_KEY
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (valeurs differentes entre .env racine et backend/.env)

## Variable : SEED_ON_START
- Utilisee dans : .\docker-compose.yml, docker-compose.yml:86
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : SEED_ON_START: ${SEED_ON_START:-true}
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : SEED_PLAN
- Utilisee dans : .\backend\prisma\seed.cjs, .\docker-compose.yml, docker-compose.yml:88
- Valeur actuelle (.env racine) : PRO
- Valeur dans docker-compose : SEED_PLAN: ${SEED_PLAN}
- Valeur dans .env.example (racine) : PRO
- Valeur backend/.env : non definie
- Valeur backend/.env.example : PRO
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : non (aucun conflit detecte)

## Variable : SESSION_SECRET
- Utilisee dans : .\docker-compose.yml, docker-compose.yml:125
- Valeur actuelle (.env racine) : dev_session_secret_that_is_at_least_32_chars
- Valeur dans docker-compose : SESSION_SECRET: ${SESSION_SECRET}
- Valeur dans .env.example (racine) : CHANGE_ME_IN_PRODUCTION_MIN_32_CHARS
- Valeur backend/.env : non definie
- Valeur backend/.env.example : CHANGE_ME_IN_PRODUCTION_MIN_32_CHARS
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (valeurs heterogenes entre fichiers d environnement)

## Variable : STRONGHOLD_API_KEY
- Utilisee dans : .\backend\scripts\discovery-cli.js, .\backend\scripts\import-github-discovery.mjs
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : STRONGHOLD_API_URL
- Utilisee dans : .\backend\scripts\discovery-cli.js
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : STRONGHOLD_BACKEND_URL
- Utilisee dans : .\backend\scripts\import-github-discovery.mjs
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : TENANT_MAX_DOCUMENTS
- Utilisee dans : .\backend\src\config\deployment.js, .\backend\src\config\deployment.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : 5000
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : TENANT_MAX_RPM
- Utilisee dans : .\backend\src\config\deployment.js, .\backend\src\config\deployment.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : 1200
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : TENANT_MAX_RUNBOOKS_PER_MONTH
- Utilisee dans : .\backend\src\config\deployment.js, .\backend\src\config\deployment.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : 200
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : TENANT_MAX_STORAGE_GB
- Utilisee dans : .\backend\src\config\deployment.js, .\backend\src\config\deployment.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : 200
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : TENANT_MAX_USERS
- Utilisee dans : .\backend\src\config\deployment.js, .\backend\src\config\deployment.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : 50
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : TENANT_SCHEMA_PREFIX
- Utilisee dans : .\backend\src\config\deployment.js, .\backend\src\config\deployment.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : tenant
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : UPLOAD_ALLOWED_MIME_TYPES
- Utilisee dans : .\backend\src\routes\documentRoutes.js, .\backend\src\routes\documentRoutes.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : UPLOAD_MAX_FILE_SIZE_MB
- Utilisee dans : .\backend\src\routes\documentRoutes.js, .\backend\src\routes\documentRoutes.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : 25
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : UPLOAD_MAX_FILES
- Utilisee dans : .\backend\src\routes\documentRoutes.js, .\backend\src\routes\documentRoutes.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : 1
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : VAULT_ADDR
- Utilisee dans : .\backend\src\services\discoveryVaultService.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : VAULT_TOKEN
- Utilisee dans : .\backend\src\services\discoveryVaultService.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : VECTOR_DB_OPTIONAL
- Utilisee dans : .\backend\src\index.js, .\backend\src\index.ts
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : false
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : VITE_API_KEY
- Utilisee dans : 
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : dev-key
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : VITE_API_URL
- Utilisee dans : .\docker-compose.yml, .\frontend\src\api\client.ts, .\frontend\src\lib\constants.ts, .\frontend\src\pages\SettingsPage.tsx, docker-compose.yml:151
- Valeur actuelle (.env racine) : /api
- Valeur dans docker-compose : VITE_API_URL: ${VITE_API_URL}
- Valeur dans .env.example (racine) : /api
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : http://localhost:3000
- Valeur frontend/.env.example : /api
- Conflit detecte : oui (valeurs differentes entre frontend/.env et frontend/.env.example)

## Variable : VITE_APP_VERSION
- Utilisee dans : .\docker-compose.yml, docker-compose.yml:152
- Valeur actuelle (.env racine) : dev
- Valeur dans docker-compose : VITE_APP_VERSION: ${VITE_APP_VERSION}
- Valeur dans .env.example (racine) : dev
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : dev
- Conflit detecte : non (aucun conflit detecte)

## Variable : VITE_BACKEND_URL
- Utilisee dans : 
- Valeur actuelle (.env racine) : non definie
- Valeur dans docker-compose : 
- Valeur dans .env.example (racine) : non definie
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : http://localhost:4000
- Valeur frontend/.env.example : non definie
- Conflit detecte : oui (variable referencee par docker-compose mais absente du .env racine)

## Variable : VITE_ENV
- Utilisee dans : .\docker-compose.yml, docker-compose.yml:153
- Valeur actuelle (.env racine) : development
- Valeur dans docker-compose : VITE_ENV: ${VITE_ENV}
- Valeur dans .env.example (racine) : development
- Valeur backend/.env : non definie
- Valeur backend/.env.example : non definie
- Valeur frontend/.env : non definie
- Valeur frontend/.env.example : development
- Conflit detecte : non (aucun conflit detecte)

