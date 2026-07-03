export interface HealthDatabaseCheckDto {
  readonly status: 'up' | 'down';
  readonly latency?: number;
  readonly error?: string;
}

export interface HealthStorageCheckDto {
  readonly status: 'up' | 'down' | 'not_configured';
  readonly latency?: number;
  readonly error?: string;
}

export interface HealthEmailCheckDto {
  readonly status: 'up' | 'down' | 'not_configured';
  readonly provider: string;
  readonly error?: string;
}

export interface HealthChecksDto {
  readonly database: HealthDatabaseCheckDto;
  readonly storage: HealthStorageCheckDto;
  readonly email: HealthEmailCheckDto;
}

export class HealthLivenessResponseDto {
  readonly status = 'ok' as const;

  constructor(readonly timestamp: string) {}
}

export class HealthReadinessResponseDto {
  constructor(
    readonly status: 'healthy' | 'degraded' | 'unhealthy',
    readonly timestamp: string,
    readonly checks: HealthChecksDto,
  ) {}
}
