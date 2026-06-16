# =============================================================================
# BuildingOS API — Multi-stage Production Dockerfile
# =============================================================================
# Build context: repository root (monorepo)
# Path: apps/api/Dockerfile
# =============================================================================

# ---- Stage 1: Builder ----
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root package files for workspace resolution
COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY packages ./packages

# Install all dependencies (dev + prod)
RUN npm ci

# Build shared workspace packages first
RUN npm run build -w packages/contracts

# Copy Prisma schema and generate client
COPY apps/api/prisma ./apps/api/prisma
RUN cd apps/api && npx prisma generate

# Copy API source code
COPY apps/api ./apps/api

# Build NestJS application
RUN npm run build -w apps/api

# ---- Stage 2: Production Dependencies ----
FROM node:20-alpine AS prod-deps

WORKDIR /app

# Copy root package files
COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY packages ./packages

# Install production dependencies only
RUN npm ci --only=production

# Copy Prisma schema and regenerate client
COPY apps/api/prisma ./apps/api/prisma
# Install prisma CLI temporarily to generate client
RUN cd apps/api && npm install prisma@5.22.0 && npx prisma generate && npm uninstall prisma

# ---- Stage 3: Runtime ----
FROM node:20-alpine

WORKDIR /app

# Install curl and openssl for healthchecks and Prisma engine
RUN apk add --no-cache curl openssl

# Copy production node_modules from prod-deps stage
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/api/node_modules ./apps/api/node_modules

# Copy package files for runtime resolution
COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY packages ./packages

# Copy Prisma schema (needed for migrations)
COPY apps/api/prisma ./apps/api/prisma

# Copy compiled application from builder
COPY --from=builder /app/apps/api/dist ./apps/api/dist

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start application
CMD ["node", "apps/api/dist/main"]