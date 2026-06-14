/**
 * Health Check Service
 * Verifies critical dependencies are operational
 */

import { Injectable } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { PrismaService } from '../prisma/prisma.service';
import { MinioService } from '../storage/minio.service';
import { EmailService } from '../email/email.service';

export interface HealthStatus {
  status: 'healthy' | 'unhealthy';
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
  ) {}

  /**
   * Check all critical dependencies
   */
  async getHealth(): Promise<HealthStatus> {
    const checks = {
      database: await this.checkDatabase(),
      storage: await this.checkStorage(),
      email: await this.checkEmail(),
    };

    const isHealthy =
      checks.database.status === 'up' &&
      (checks.storage.status === 'up' || checks.storage.status === 'not_configured') &&
      (checks.email.status === 'up' || checks.email.status === 'not_configured');

    return {
      status: isHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      checks,
    };
  }

  /**
   * Check database connectivity
   */
  private async checkDatabase(): Promise<any> {
    const startTime = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const latency = Date.now() - startTime;
      return { status: 'up', latency };
    } catch (error) {
      return {
        status: 'down',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Check S3/MinIO storage connectivity
   */
  private async checkStorage(): Promise<any> {
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
  private async checkEmail(): Promise<any> {
    return this.emailService.checkHealth();
  }
}
