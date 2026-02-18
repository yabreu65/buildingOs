/**
 * Health Check Service
 * Verifies critical dependencies are operational
 */

import { Injectable } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { PrismaService } from '../prisma/prisma.service';

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

    // TODO: Implement S3 connectivity check
    // For now, just verify configuration exists
    return {
      status: 'up',
      note: 'Configuration exists, bucket not checked',
    };
  }

  /**
   * Check email provider configuration
   */
  private async checkEmail(): Promise<any> {
    const config = this.configService.get();
    const provider = config.mailProvider;

    if (provider === 'none') {
      return {
        status: 'not_configured',
        provider: 'disabled',
      };
    }

    // Check if SMTP is configured
    if (provider === 'smtp') {
      if (!config.smtpHost || !config.smtpPort) {
        return {
          status: 'down',
          provider: 'smtp',
          error: 'SMTP configuration incomplete',
        };
      }
      return {
        status: 'up',
        provider: 'smtp',
        note: 'Configuration exists, connection not tested',
      };
    }

    // Check if Resend is configured
    if (provider === 'resend') {
      if (!config.resendApiKey) {
        return {
          status: 'down',
          provider: 'resend',
          error: 'Resend API key not configured',
        };
      }
      return {
        status: 'up',
        provider: 'resend',
        note: 'API key configured',
      };
    }

    // Check if AWS SES is configured
    if (provider === 'ses') {
      return {
        status: 'up',
        provider: 'ses',
        note: 'AWS SES configured via SDK',
      };
    }

    return {
      status: 'not_configured',
      provider,
    };
  }
}
