/**
 * Health Check Controller
 * Exposes /health (liveness) and /ready (readiness) endpoints
 * Kubernetes-compatible health check probes
 */

import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { HealthService } from './health.service';

@Controller('')
export class HealthController {
  constructor(private healthService: HealthService) {}

  /**
   * Liveness probe - basic health check
   * Returns 200 OK if API is running
   * Used by orchestrators (Kubernetes, Docker) to restart unhealthy instances
   */
  @Get('health')
  async health() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Readiness probe - checks all critical dependencies
   * Returns 200 OK only if database + storage + email are operational
   * Returns 503 Service Unavailable if any critical dependency is down
   * Used by orchestrators to route traffic only to ready instances
   */
  @Get('ready')
  async readiness() {
    const health = await this.healthService.getHealth();

    if (health.status === 'unhealthy') {
      throw new HttpException(
        {
          status: 'unhealthy',
          timestamp: new Date().toISOString(),
          checks: health.checks,
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      checks: health.checks,
    };
  }

  /**
   * Alternative readiness endpoint (Kubernetes sometimes uses /readyz)
   */
  @Get('readyz')
  async readinessAlt() {
    return this.readiness();
  }
}
