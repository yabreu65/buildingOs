# =============================================================================
# BuildingOS Web — Multi-stage Production Dockerfile
# =============================================================================
# Build context: repository root (monorepo)
# Path: apps/web/Dockerfile
# =============================================================================

# ---- Stage 1: Builder ----
FROM node:20-alpine AS builder

# Next.js build-time environment variables
ARG NEXT_PUBLIC_API_URL
RUN test -n "$NEXT_PUBLIC_API_URL" || (echo "NEXT_PUBLIC_API_URL is required at build time" && exit 1)
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

WORKDIR /app

# Copy root package files for workspace resolution
COPY package*.json ./
COPY apps/web/package*.json ./apps/web/
COPY packages ./packages

# Install all dependencies (dev + prod)
RUN npm ci

# Build shared workspace packages
RUN npm run build -w packages/contracts && npm run build -w packages/permissions

# Copy web source code
COPY apps/web ./apps/web

# Build Next.js application
RUN npm run build -w apps/web

# ---- Stage 2: Runtime ----
FROM node:20-alpine

WORKDIR /app

# Install curl for healthchecks
RUN apk add --no-cache curl

# Run the web app as a dedicated non-root user
RUN addgroup -S -g 1001 appgroup \
  && adduser -S -u 1001 -G appgroup appuser

# Copy root package files
COPY --chown=appuser:appgroup package*.json ./
COPY --chown=appuser:appgroup apps/web/package*.json ./apps/web/
COPY --chown=appuser:appgroup packages ./packages

# Install production dependencies only
RUN npm ci --only=production

# Copy Next.js build output from builder
COPY --from=builder --chown=appuser:appgroup /app/apps/web/.next ./apps/web/.next
COPY --from=builder --chown=appuser:appgroup /app/apps/web/public ./apps/web/public

# Ensure Next.js can write cache files if it needs them at runtime
RUN mkdir -p ./apps/web/.next/cache \
  && chown -R appuser:appgroup ./apps/web/.next

# Copy next.config (must match the build)
COPY --chown=appuser:appgroup apps/web/next.config.mjs ./apps/web/

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3000 || exit 1

# Drop privileges before starting the app
USER appuser

# Start application
CMD ["npm", "start", "-w", "apps/web"]
