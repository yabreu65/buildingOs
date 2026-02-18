/**
 * Health Check Controller
 * Exposes /health (liveness) and /readyz (readiness) endpoints
 */

import { Controller, Get } from '@nestjs/common';
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
   * Used by orchestrators to route traffic only to ready instances
   */
  @Get('readyz')
  async readiness() {
    return this.healthService.getHealth();
  }
}
