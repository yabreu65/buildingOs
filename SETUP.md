# Setup (cómo convertir este scaffold en un proyecto ejecutable)

Este repo está pensado para **npm workspaces**.

## 1) Inicializar repo y workspaces
En la raíz:
```bash
npm install
```

## 2) Crear/instalar Front (Next.js)
Dentro de `apps/web` (si preferís regenerarlo con create-next-app):
```bash
cd apps/web
npx create-next-app@latest . --ts --eslint --app --src-dir --no-tailwind
```
Luego agregar Tailwind + shadcn/ui + TanStack Query + RHF + Zod según el plan.

## 3) Crear/instalar Back (NestJS)
Dentro de `apps/api`:
```bash
cd apps/api
npx @nestjs/cli new . --package-manager npm
```
Luego instalar Prisma + Swagger + Redis/BullMQ.

## 4) Infra local
```bash
cd infra/docker
docker compose up -d
```

## 5) Próximo paso recomendado
- Implementar Auth + TenantContext + RBAC en `apps/api`
- Crear rutas base en `apps/web` bajo `(tenant)/[tenantId]/...`
- Compartir contratos en `packages/contracts`
