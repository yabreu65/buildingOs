# Stage 1: Builder
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY packages ./packages

# Install dependencies
RUN npm ci

# Copy source code
COPY apps/api ./apps/api

# Build NestJS application
RUN npm run build -w apps/api

# Stage 2: Runtime
FROM node:20-alpine

WORKDIR /app

# Install curl for healthchecks
RUN apk add --no-cache curl

# Copy package files from builder
COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY packages ./packages

# Install production dependencies only
RUN npm ci --only=production

# Copy dist from builder
COPY --from=builder /app/apps/api/dist ./apps/api/dist

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start application
CMD ["node", "apps/api/dist/main"]
