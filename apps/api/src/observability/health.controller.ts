/**
 * Health Check Controller
 * Exposes /health (liveness), /ready (readiness), and /readyz (alias)
 * Kubernetes-compatible health check probes
 */

import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import {
  HealthLivenessResponseDto,
  HealthReadinessResponseDto,
} from './health.dto';
import { HealthService } from './health.service';

@Controller('')
export class HealthController {
  constructor(private healthService: HealthService) {}

  /**
   * Liveness probe.
   *
   * This endpoint only verifies the process is responding and must stay cheap.
   * It intentionally avoids dependency checks so orchestrators can detect
   * whether the app process itself is alive.
   */
  @Get('health')
  async health(): Promise<HealthLivenessResponseDto> {
    return new HealthLivenessResponseDto(new Date().toISOString());
  }

  /**
   * Readiness probe.
   *
   * This endpoint checks required dependencies before the service receives
   * traffic. Use it for routing gates and deployment readiness checks.
   */
  @Get('ready')
  async readiness(): Promise<HealthReadinessResponseDto> {
    const health = await this.healthService.getReadiness();
    const response = new HealthReadinessResponseDto(
      health.status,
      new Date().toISOString(),
      health.checks,
    );

    if (health.status === 'unhealthy') {
      throw new HttpException(
        response,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return response;
  }

  /**
   * Alternative readiness endpoint.
   *
   * Some orchestrators and probes expect /readyz, so keep it as an alias.
   */
  @Get('readyz')
  async readinessAlt() {
    return this.readiness();
  }
}
