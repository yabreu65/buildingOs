# =============================================================================
# BuildingOS API — Multi-stage Production Dockerfile
# =============================================================================
# Build context: repository root (monorepo)
# Path: apps/api/Dockerfile
# =============================================================================

# ---- Stage 1: Builder ----
FROM node:20-alpine AS builder

# Install openssl so prisma generate detects the correct binary target
RUN apk add --no-cache openssl

WORKDIR /app

# Copy root package files for workspace resolution
COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY packages ./packages

# Install all dependencies (dev + prod)
RUN npm ci

# Build shared workspace packages first
RUN npm run build -w packages/contracts && npm run build -w packages/permissions

# Copy Prisma schema and generate client
COPY apps/api/prisma ./apps/api/prisma
RUN cd apps/api && npx prisma generate

# Copy API source code
COPY apps/api ./apps/api

# Build NestJS application
RUN npm run build -w apps/api

# ---- Stage 2: Production Dependencies ----
FROM node:20-alpine AS prod-deps

# Install openssl so prisma generate detects the correct binary target
RUN apk add --no-cache openssl

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

# ---- Stage 3: Dev Tools (migrate, seed) ----
# Uses builder which has all deps (dev + prod) including ts-node
FROM builder AS dev-tools

# ---- Stage 4: Runtime ----
FROM node:20-alpine AS runtime

WORKDIR /app

# Install curl and openssl for healthchecks and Prisma engine
RUN apk add --no-cache curl openssl

# Run the API as a dedicated non-root user
RUN addgroup -S -g 1001 appgroup \
  && adduser -S -u 1001 -G appgroup appuser

# Copy production node_modules from prod-deps stage
COPY --from=prod-deps --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=prod-deps --chown=appuser:appgroup /app/apps/api/node_modules ./apps/api/node_modules

# Copy package files for runtime resolution
COPY --chown=appuser:appgroup package*.json ./
COPY --chown=appuser:appgroup apps/api/package*.json ./apps/api/
COPY --chown=appuser:appgroup packages ./packages

# Copy Prisma schema (needed for migrations)
COPY --chown=appuser:appgroup apps/api/prisma ./apps/api/prisma

# Copy compiled contracts from builder (workspace dependency)
COPY --from=builder --chown=appuser:appgroup /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=builder --chown=appuser:appgroup /app/packages/permissions/dist ./packages/permissions/dist

# Copy compiled application from builder
COPY --from=builder --chown=appuser:appgroup /app/apps/api/dist ./apps/api/dist

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Drop privileges before starting the app
USER appuser

# Start application
CMD ["node", "apps/api/dist/main"]
