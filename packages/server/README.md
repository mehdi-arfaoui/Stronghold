# @stronghold-dr/server

## Setup

```bash
# 1. Start PostgreSQL
cd packages/server && docker compose -f docker-compose.dev.yml up -d

# 2. Configure the environment
cp .env.example .env

# 3. Initialize the database
npm run db:migrate

# 4. Start the server
npm run dev
```
