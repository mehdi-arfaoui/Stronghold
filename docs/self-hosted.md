# Self-Hosted Deployment

## Quick Start

```bash
git clone https://github.com/mehdi-arfaoui/stronghold.git
cd stronghold
cp .env.example .env
# Edit .env at minimum: DB_PASSWORD
docker compose up -d --build
```

Open:

- Web UI: `http://localhost:8080`
- API health: `http://localhost:3000/api/health`

## What Docker Compose Starts

The default compose stack includes:

- `postgres` for persistence
- `server` for the Express API
- `web` for the nginx-served frontend

PostgreSQL stays on the internal Docker network. The exposed ports are the API and the web UI.

```text
┌─────────────┐     ┌──────────────┐     ┌────────────┐
│   Browser   │ --> │ nginx (web)  │ --> │   Express  │
│             │     │ port 8080    │     │ port 3000  │
└─────────────┘     └──────────────┘     └──────┬─────┘
                                                │
                                         ┌──────▼─────┐
                                         │ PostgreSQL │
                                         │ internal   │
                                         └────────────┘
```

## Configuration

See [.env.example](../.env.example) and [docker-compose.yml](../docker-compose.yml) for the full runtime defaults. The main settings are:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | Host port mapped to the API container |
| `WEB_PORT` | `8080` | Host port mapped to the web container |
| `DB_PASSWORD` | `change-me-local-only` | PostgreSQL password for the bundled stack |
| `LOG_LEVEL` | `info` | Server log level |
| `AWS_ACCESS_KEY_ID` | empty | Optional AWS credential env var |
| `AWS_SECRET_ACCESS_KEY` | empty | Optional AWS credential env var |
| `AWS_DEFAULT_REGION` | `us-east-1` | Default region for server-side scans |
| `AWS_PROFILE` | `default` | Optional named profile if you mount `~/.aws` |
| `CORS_ORIGIN` | `http://localhost:8080` | Allowed web origin for the API, defaulted in `docker-compose.yml` |

## AWS Credentials

The server needs AWS credentials to perform scans.

### Option 1: Environment Variables

Add these to `.env`:

```dotenv
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_DEFAULT_REGION=eu-west-1
```

### Option 2: Mount AWS Config Read-Only

The server container runs as the `node` user, so the correct home directory is `/home/node/.aws`.

Example compose override:

```yaml
services:
  server:
    environment:
      AWS_PROFILE: production
    volumes:
      - ~/.aws:/home/node/.aws:ro
```

On Windows, replace `~/.aws` with an explicit path such as `${USERPROFILE}\\.aws`.

## Database Migrations

On startup, the `server` container runs:

```bash
prisma migrate deploy
```

This happens from the container entrypoint before the API starts listening.

### If a migration fails

If migrations cannot run, the `server` container exits before the API starts. Because the compose file uses `restart: unless-stopped`, Docker may keep trying to restart it.

Check the failure first:

```bash
docker compose ps
docker compose logs -f server
```

Common causes:

- wrong `DB_PASSWORD`
- PostgreSQL not healthy yet
- a broken migration history or incompatible schema state

After fixing the underlying issue, restart the server container:

```bash
docker compose restart server
```

If you changed the image or dependencies, rebuild before restarting:

```bash
docker compose up -d --build server
```

## Operational Checks

Useful commands:

```bash
docker compose ps
docker compose logs -f server
docker compose logs -f web
curl http://localhost:3000/api/health
curl http://localhost:3000/api/health/db
```

Those health endpoints are suitable for simple uptime probes.

## Updating

```bash
git pull
docker compose build
docker compose up -d
```

The server reapplies Prisma migrations on startup, then launches the API.

## Production Considerations

- Put a reverse proxy with TLS in front of the stack.
- Back up PostgreSQL independently; Stronghold does not back up its own database for you.
- Prefer short-lived AWS credentials or mounted profiles over long-lived static keys.
- Keep the AWS mount read-only if you use `~/.aws`.
- Set resource limits and log retention in your production compose or orchestration layer.
- Review scan data before sharing it externally; it contains infrastructure metadata even though it does not contain credentials or application payloads.

## Related Docs

- [Getting Started](./getting-started.md)
- [Architecture](./architecture.md)
- [AWS provider details](./providers/aws.md)
