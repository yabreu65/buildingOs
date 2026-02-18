import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { ValidationPipe, Logger } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { ConfigService } from "./config/config.service";
import { RateLimitMiddleware } from "./security/rate-limit.middleware";

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
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    })
  );

  // =========================================================
  // Security: Response Headers
  // =========================================================
  app.use((req, res, next) => {
    // Prevent MIME type sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Prevent clickjacking
    res.setHeader('X-Frame-Options', 'DENY');

    // Referrer policy
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // Disable client-side caching for sensitive data
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    // Remove X-Powered-By header
    res.removeHeader('X-Powered-By');

    next();
  });

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

  logger.log(`========================================`);
  logger.log(`🚀 BuildingOS API Started`);
  logger.log(`📍 Environment: ${config.nodeEnv}`);
  logger.log(`🔌 Port: ${port}`);
  logger.log(`🌐 CORS Origins: ${corsOrigins.join(', ')}`);
  logger.log(`🔒 Security: Rate limiting enabled`);
  logger.log(`========================================`);
}

bootstrap().catch((error) => {
  console.error('Fatal error during bootstrap:', error);
  process.exit(1);
});
