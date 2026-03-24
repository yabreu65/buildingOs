# Stage 1: Builder
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY apps/web/package*.json ./apps/web/
COPY packages ./packages

# Install dependencies
RUN npm ci

# Copy source code
COPY apps/web ./apps/web

# Build Next.js application
RUN npm run build -w apps/web

# Stage 2: Runtime
FROM node:20-alpine

WORKDIR /app

# Install curl for healthchecks
RUN apk add --no-cache curl

# Copy package files from builder
COPY package*.json ./
COPY apps/web/package*.json ./apps/web/
COPY packages ./packages

# Install production dependencies only
RUN npm ci --only=production

# Copy .next from builder
COPY --from=builder /app/apps/web/.next ./apps/web/.next
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY apps/web/next.config.ts ./apps/web/

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000 || exit 1

# Start application
CMD ["npm", "start", "-w", "apps/web"]
