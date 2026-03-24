# BuildingOS Docker Setup Guide

## Overview

This guide explains how to run BuildingOS using Docker. The architecture follows a **two-compose-file pattern** for maximum flexibility:

- **`docker-compose.yml`** — Infrastructure only (PostgreSQL, Redis, MinIO)
- **`docker-compose.full.yml`** — Full stack (infra + API + Web)

This approach allows you to:
- Run infrastructure separately for development
- Scale app containers independently
- Coexist with other Docker projects
- Choose between minimal dev setup or full demo environment

## Architecture Diagram

```
┌─────────────────────────────────────────────────────┐
│ buildingos_net (Docker Network)                     │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │  PostgreSQL  │  │    Redis     │  │  MinIO    │ │
│  │   (5433)     │  │   (6380)     │  │ (9100)    │ │
│  │              │  │              │  │           │ │
│  │ buildingos   │  │              │  │ buildingos│ │
│  │              │  │              │  │  -local   │ │
│  └──────────────┘  └──────────────┘  └───────────┘ │
│        ↑                   ↑               ↑         │
│        └───────────────────┴───────────────┘         │
│                   ↓                                  │
│        ┌──────────────────────────┐                 │
│        │  NestJS API Container    │                 │
│        │  buildingos-api (3010)   │                 │
│        └──────────────────────────┘                 │
│                   ↓                                  │
│        ┌──────────────────────────┐                 │
│        │  Next.js Web Container   │                 │
│        │  buildingos-web (3011)   │                 │
│        └──────────────────────────┘                 │
│                                                     │
└─────────────────────────────────────────────────────┘
```

## File Structure

```
infra/docker/
├── docker-compose.yml           # Infrastructure only
├── docker-compose.full.yml      # Full stack (extends docker-compose.yml)
├── .env.example                 # Infrastructure variables
├── .env.api.example             # API-specific variables
└── .env.web.example             # Web-specific variables

apps/api/
└── Dockerfile                   # NestJS multi-stage build

apps/web/
└── Dockerfile                   # Next.js multi-stage build
```

## Quick Start

### 1. Infrastructure Only (Recommended for Development)

Perfect for local development where you run `npm run dev` in your terminal.

```bash
# Create .env file from example
cp infra/docker/.env.example infra/docker/.env

# Edit if needed (optional, defaults are fine)
# nano infra/docker/.env

# Start infrastructure
npm run infra:up

# Verify containers are running
docker ps | grep buildingos

# Check database connectivity
docker compose -f infra/docker/docker-compose.yml logs postgres
```

In another terminal:
```bash
npm run dev      # Runs both API and Web in watch mode
```

### 2. Full Stack (Demo/Staging)

Runs everything in containers, perfect for demos or staging environments.

```bash
# Create environment files
cp infra/docker/.env.example infra/docker/.env
cp infra/docker/.env.api.example infra/docker/.env.api
cp infra/docker/.env.web.example infra/docker/.env.web

# Edit if needed
nano infra/docker/.env
nano infra/docker/.env.api
nano infra/docker/.env.web

# Start full stack
npm run stack:up

# Wait for healthchecks (about 30 seconds)
docker compose -f infra/docker/docker-compose.full.yml ps

# Access services
# - API: http://localhost:3010
# - Web: http://localhost:3011
# - MinIO Console: http://localhost:9101 (user: buildingos, password: buildingos123)
```

## Available npm Scripts

```bash
# Infrastructure commands
npm run infra:up        # Start PostgreSQL, Redis, MinIO
npm run infra:down      # Stop infrastructure containers
npm run infra:reset     # Remove volumes and restart (CAUTION: Deletes data)
npm run infra:logs      # View infrastructure logs

# Full stack commands
npm run stack:up        # Start entire application
npm run stack:down      # Stop entire application
```

## Port Mapping

All ports are configurable via `.env` file:

| Service | Container Port | Host Port | Default | Config |
|---------|---|---|---|---|
| PostgreSQL | 5432 | 5433 | 5433 | `POSTGRES_PORT` |
| Redis | 6379 | 6380 | 6380 | `REDIS_PORT` |
| MinIO API | 9000 | 9100 | 9100 | `MINIO_API_PORT` |
| MinIO Console | 9001 | 9101 | 9101 | `MINIO_CONSOLE_PORT` |
| NestJS API | 3000 | 3010 | 3010 | `API_PORT` |
| Next.js Web | 3000 | 3011 | 3011 | `WEB_PORT` |

## Environment Variables

### Infrastructure (`.env`)

```bash
# Database
POSTGRES_USER=buildingos
POSTGRES_PASSWORD=buildingos
POSTGRES_DB=buildingos
POSTGRES_PORT=5433

# Cache
REDIS_PORT=6380

# Object Storage
MINIO_ROOT_USER=buildingos
MINIO_ROOT_PASSWORD=buildingos123
MINIO_API_PORT=9100
MINIO_CONSOLE_PORT=9101

# Application
API_PORT=3010
WEB_PORT=3011
NODE_ENV=production
```

### API (`.env.api`)

```bash
# Automatically injected from .env
DATABASE_URL=postgresql://buildingos:buildingos@postgres:5432/buildingos
REDIS_URL=redis://redis:6379
MINIO_ENDPOINT=minio
MINIO_PORT=9000

# Secrets (change in production!)
JWT_SECRET=your-secret-key-change-in-production

# Logging
LOG_LEVEL=info
```

### Web (`.env.web`)

```bash
# Points to API container
NEXT_PUBLIC_API_URL=http://localhost:3010

NODE_ENV=production
```

## Running Migrations and Seeds

When using `docker-compose.full.yml`, migrations run automatically when the API starts. To seed data:

```bash
# With infrastructure only
npm run infra:up
npm run db:migrate
npm run db:seed
npm run dev

# With full stack (after containers start)
docker compose -f infra/docker/docker-compose.full.yml exec buildingos-api \
  npm run migrate:deploy

docker compose -f infra/docker/docker-compose.full.yml exec buildingos-api \
  npm run seed
```

## Viewing Logs

```bash
# Infrastructure only
docker compose -f infra/docker/docker-compose.yml logs -f

# Full stack
docker compose -f infra/docker/docker-compose.full.yml logs -f

# Single service
docker compose -f infra/docker/docker-compose.full.yml logs -f buildingos-api
docker compose -f infra/docker/docker-compose.full.yml logs -f buildingos-web
```

## Accessing Services Directly

### PostgreSQL

```bash
docker compose -f infra/docker/docker-compose.yml exec postgres psql -U buildingos -d buildingos
```

### Redis CLI

```bash
docker compose -f infra/docker/docker-compose.yml exec redis redis-cli
```

### MinIO Console

Open in browser: http://localhost:9101
- Username: `buildingos`
- Password: `buildingos123`

### API Swagger

Open in browser: http://localhost:3010/api/docs

## Troubleshooting

### Issue: Port Already in Use

**Error**: `Error response from daemon: Ports are not available: exposing port UDP 5433/udp failed: listen udp [::]:5433: bind: address already in use`

**Solutions**:

1. Change port in `.env`:
   ```bash
   POSTGRES_PORT=5434  # Use 5434 instead of 5433
   ```

2. Or kill the process using the port:
   ```bash
   # Find process on port 5433
   lsof -i :5433

   # Kill it
   kill -9 <PID>
   ```

### Issue: Containers Won't Start

**Steps**:

1. Check logs:
   ```bash
   docker compose -f infra/docker/docker-compose.yml logs postgres
   docker compose -f infra/docker/docker-compose.yml logs minio
   ```

2. Verify Docker daemon is running:
   ```bash
   docker ps
   ```

3. Reset everything:
   ```bash
   npm run infra:down
   docker volume prune  # Remove unused volumes
   npm run infra:up
   ```

### Issue: Database Connection Failed

**Steps**:

1. Verify PostgreSQL is healthy:
   ```bash
   docker compose -f infra/docker/docker-compose.yml ps postgres
   # STATUS should say "healthy"
   ```

2. Check credentials in `.env`:
   ```bash
   POSTGRES_USER=buildingos
   POSTGRES_PASSWORD=buildingos
   ```

3. Test connection from host:
   ```bash
   psql postgresql://buildingos:buildingos@localhost:5433/buildingos
   ```

### Issue: MinIO Bucket Not Created

**Steps**:

1. Check createbuckets container logs:
   ```bash
   docker compose -f infra/docker/docker-compose.yml logs createbuckets
   ```

2. Manually create bucket:
   ```bash
   docker compose -f infra/docker/docker-compose.yml exec minio mc alias set myminio http://localhost:9000 buildingos buildingos123
   docker compose -f infra/docker/docker-compose.yml exec minio mc mb myminio/buildingos-local --ignore-existing
   ```

### Issue: Permission Denied (MacOS/Linux)

If you get permission errors, check Docker desktop settings:
- Ensure Docker Desktop is running
- Check File Sharing settings in Docker preferences
- Restart Docker: `open /Applications/Docker.app`

## Coexisting with Other Docker Projects

This setup is designed to coexist with other Docker environments:

- **Isolated network**: All BuildingOS containers run on `buildingos_net`
- **Named volumes**: Use `buildingos_pgdata`, `buildingos_redisdata`, `buildingos_miniodata`
- **Container naming**: All containers prefixed with `buildingos-`
- **Port offsets**: Uses non-standard ports (5433, 6380, 9100)

To avoid conflicts with other projects:

1. Use different `.env` files if running multiple BuildingOS instances
2. Change `POSTGRES_PORT`, `REDIS_PORT`, `MINIO_API_PORT` in `.env`
3. Networks are isolated automatically

## Production Considerations

### Before Deploying to Production:

1. **Change secrets**:
   ```bash
   # Generate new JWT_SECRET
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

   # Update .env.api
   JWT_SECRET=<generated-value>
   ```

2. **Set strong credentials**:
   ```bash
   POSTGRES_PASSWORD=<strong-password>
   MINIO_ROOT_PASSWORD=<strong-password>
   ```

3. **Configure logging**:
   ```bash
   LOG_LEVEL=warn  # Reduce noise in production
   SENTRY_DSN=<your-sentry-dsn>
   ```

4. **Enable SSL/TLS**:
   - Use a reverse proxy (nginx, Traefik)
   - Set `MINIO_USE_SSL=true` if accessible externally

5. **Backup strategy**:
   - Configure volume backups
   - Set up automated database backups
   - See `RUNBOOK.md` for backup procedures

6. **Resource limits** (update docker-compose):
   ```yaml
   services:
     postgres:
       deploy:
         resources:
           limits:
             cpus: "1"
             memory: 1G
   ```

## Development Workflow

### Recommended Setup

```bash
# Terminal 1: Start infrastructure
npm run infra:up

# Terminal 2: Run development servers
npm run dev

# Terminal 3: View logs
npm run infra:logs
```

### Debugging

For API debugging:

```bash
# Start with debug flag
docker compose -f infra/docker/docker-compose.full.yml up buildingos-api --build

# Then attach debugger to localhost:9229
```

## Performance Tips

1. **Use named volumes**: Already configured, ensures performance
2. **Limit log output**:
   ```bash
   docker compose -f infra/docker/docker-compose.yml logs --tail=100
   ```
3. **Disable healthchecks in dev** (edit docker-compose.yml):
   ```yaml
   postgres:
     # Temporarily comment out for faster iteration
     # healthcheck:
   ```

## See Also

- `QUICK_START.md` — Application quick start guide
- `RUNBOOK.md` — Operations and troubleshooting playbook
- `DEPLOYMENT.md` — Full production deployment guide
- `.env.example` files — Configuration templates
