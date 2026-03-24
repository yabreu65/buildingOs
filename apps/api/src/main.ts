import 'reflect-metadata';

import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { ValidationPipe, Logger } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { ConfigService } from "./config/config.service";
import { RateLimitMiddleware } from "./security/rate-limit.middleware";
import { SentryService } from "./observability/sentry.service";
import helmet from "helmet";

/**
 * Bootstrap the NestJS application with security middleware, validation, and observability.
 * Configures CORS, Helmet security headers, rate limiting, Swagger documentation,
 * and graceful shutdown handlers for Sentry event flushing.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const config = configService.get();
  const logger = new Logger('Bootstrap');

  // =========================================================
  // Security: CORS Configuration
  // =========================================================
  const corsOrigins = [config.webOrigin];
  if (config.nodeEnv === 'development') {
    // Allow additional dev origins
    corsOrigins.push('http://localhost:3000', 'http://localhost:3001');
  }

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || corsOrigins.includes(origin)) {
        callback(null, true);
      } else {
        logger.warn(`[CORS] Blocked request from origin: ${origin}`);
        callback(new Error('CORS policy violation'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Id'],
  });

  // =========================================================
  // Security: Trust Proxy (for load balancer/nginx)
  // =========================================================
  const expressApp = app.getHttpAdapter().getInstance();
  if (config.nodeEnv !== 'development') {
    expressApp.set('trust proxy', 1);
  }

  // =========================================================
  // Security: Helmet Headers
  // =========================================================
  app.use(
    helmet({
      // Content Security Policy - only in prod/staging
      contentSecurityPolicy:
        config.nodeEnv !== 'development'
          ? {
              directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                imgSrc: ["'self'", 'data:', 'https:'],
                connectSrc: ["'self'"],
                fontSrc: ["'self'"],
                objectSrc: ["'none'"],
                mediaSrc: ["'none'"],
                frameSrc: ["'none'"],
              },
            }
          : false,
      // HSTS: only prod
      hsts:
        config.nodeEnv === 'production'
          ? { maxAge: 31536000, includeSubDomains: true }
          : false,
      // Always active headers
      xContentTypeOptions: true,
      xFrameOptions: { action: 'deny' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      permittedCrossDomainPolicies: false,
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      crossOriginResourcePolicy: { policy: 'same-origin' },
    })
  );

  // =========================================================
  // Security: Cache Control for sensitive endpoints
  // =========================================================
  app.use((req: any, res: any, next: any) => {
    // Disable client-side caching for sensitive data
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    next();
  });

  // =========================================================
  // Security: Rate Limiting Middleware
  // =========================================================
  const rateLimitMiddleware = app.get(RateLimitMiddleware);
  app.use(rateLimitMiddleware.use.bind(rateLimitMiddleware));

  // =========================================================
  // Security: Global Validation Pipe
  // =========================================================
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    })
  );

  // =========================================================
  // API Documentation (only in dev)
  // =========================================================
  if (config.nodeEnv === 'development') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle("BuildingOS API")
      .setDescription("BuildingOS API - Development")
      .setVersion("1.0")
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup("api", app, document);
  }

  const port = config.port;
  await app.listen(port);

  // Graceful shutdown: flush Sentry events before exit
  const sentryService = app.get(SentryService);
  process.on('SIGTERM', async () => {
    logger.log('SIGTERM received, flushing Sentry and shutting down...');
    await sentryService.flush(5000);
    await app.close();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    logger.log('SIGINT received, flushing Sentry and shutting down...');
    await sentryService.flush(5000);
    await app.close();
    process.exit(0);
  });

  logger.log(`========================================`);
  logger.log(`🚀 BuildingOS API Started`);
  logger.log(`📍 Environment: ${config.nodeEnv}`);
  logger.log(`🔌 Port: ${port}`);
  logger.log(`🌐 CORS Origins: ${corsOrigins.join(', ')}`);
  logger.log(`🔒 Security: Rate limiting enabled`);
  logger.log(`📊 Observability: Request tracing + Sentry error tracking enabled`);
  logger.log(`========================================`);
}

bootstrap().catch((error: unknown) => {
  console.error('Fatal error during bootstrap:', error);
  process.exit(1);
});
