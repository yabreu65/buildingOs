/**
 * Health Check Service
 * Verifies readiness dependencies are operational
 */

import { Injectable } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { PrismaService } from '../prisma/prisma.service';
import { MinioService } from '../storage/minio.service';
import { EmailService } from '../email/email.service';
import { MetricsService } from './metrics.service';

type DatabaseHealthCheck = HealthStatus['checks']['database'];
type StorageHealthCheck = HealthStatus['checks']['storage'];
type EmailHealthCheck = HealthStatus['checks']['email'];

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  checks: {
    database: {
      status: 'up' | 'down';
      latency?: number;
      error?: string;
    };
    storage: {
      status: 'up' | 'down' | 'not_configured';
      latency?: number;
      error?: string;
    };
    email: {
      status: 'up' | 'down' | 'not_configured';
      provider: string;
      error?: string;
    };
  };
}

@Injectable()
export class HealthService {
  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private minioService: MinioService,
    private emailService: EmailService,
    private metricsService: MetricsService,
  ) {}

  /**
   * Check readiness dependencies.
   *
   * Database is always required. Storage and email are required only when they
   * are configured for the current environment.
   */
  async getReadiness(): Promise<HealthStatus> {
    const checks = {
      database: await this.checkDatabase(),
      storage: await this.checkStorage(),
      email: await this.checkEmail(),
    };

    const isHealthy =
      checks.database.status === 'up' &&
      (checks.storage.status === 'up' || checks.storage.status === 'not_configured') &&
      (checks.email.status === 'up' || checks.email.status === 'not_configured');
    const hasOptionalDegradation =
      checks.database.status === 'up' &&
      (checks.storage.status === 'down' || checks.email.status === 'down');

    const readiness: HealthStatus = {
      status: checks.database.status !== 'up'
        ? 'unhealthy'
        : isHealthy
          ? 'healthy'
          : hasOptionalDegradation
            ? 'degraded'
            : 'unhealthy',
      timestamp: new Date().toISOString(),
      checks,
    };

    this.metricsService.recordReadiness(readiness);

    return readiness;
  }

  /**
   * Check database connectivity
   */
  private async checkDatabase(): Promise<DatabaseHealthCheck> {
    const startTime = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const latency = Date.now() - startTime;
      return { status: 'up', latency };
    } catch {
      return {
        status: 'down',
        error:
          'Database readiness check failed while executing SELECT 1. Likely cause: database unavailable or connectivity issue.',
      };
    }
  }

  /**
   * Check S3/MinIO storage connectivity
   */
  private async checkStorage(): Promise<StorageHealthCheck> {
    const config = this.configService.get();

    // Check if storage is configured
    if (!config.s3Endpoint || !config.s3Bucket) {
      return { status: 'not_configured' };
    }

    return this.minioService.checkHealth();
  }

  /**
   * Check email provider configuration
   */
  private async checkEmail(): Promise<EmailHealthCheck> {
    return this.emailService.checkHealth();
  }
}
