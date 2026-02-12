# BuildingOS

SaaS multi-tenant para administración de edificios.

## Infraestructura

### Requisitos previos
- Docker & Docker Compose
- Node.js 20+
- NPM

### Levantar entorno local

1. **Infraestructura (DB, Redis, MinIO)**
   ```bash
   npm run dev:infra
   ```
   Esto levantará Postgres, Redis y MinIO con healthchecks.
   - Postgres: localhost:5432
   - Redis: localhost:6379
   - MinIO Console: http://localhost:9001 (User: buildingos / Pass: buildingos123)

2. **Configuración de entorno**
   Copia los archivos de ejemplo:
   ```bash
   cp .env.example .env
   cp apps/api/.env.example apps/api/.env
   cp apps/web/.env.example apps/web/.env
   ```

3. **Base de Datos**
   Aplicar migraciones y seed:
   ```bash
   npm run db:migrate
   npm run db:seed
   ```
   
   Ver datos en Prisma Studio:
   ```bash
   npm run db:studio
   ```

4. **Aplicaciones (Web + API)**
   ```bash
   npm run dev
   ```
   - Web: http://localhost:3000
   - API: http://localhost:4000
   - Swagger: http://localhost:4000/api
   - Health: http://localhost:4000/health

## Estructura del Proyecto

- `apps/api`: NestJS + Prisma + PostgreSQL
- `apps/web`: Next.js + React + Tailwind
- `packages/*`: Librerías compartidas
- `infra/docker`: Configuración de Docker Compose

## Testing y Calidad

```bash
npm run lint
npm run typecheck
npm run test
```
