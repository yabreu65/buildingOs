# BuildingOS (Monorepo)

SaaS multi-tenant para administración de edificios/condominios.

## Requisitos
- Node.js 20+ (recomendado)
- Docker (para Postgres/Redis/MinIO)

## Arranque rápido (scaffold)
1. Levantar infraestructura:
   ```bash
   cd infra/docker
   docker compose up -d
   ```

2. Instalar dependencias (cuando agregues las deps con npm):
   ```bash
   npm install
   ```

3. Correr apps (cuando estén instaladas):
   ```bash
   npm run dev
   ```

> Nota: Este scaffold incluye la estructura y archivos base. Para generar el proyecto con `create-next-app` y `nest new`, seguí el archivo `SETUP.md`.

# buildingOs
