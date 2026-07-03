import { Injectable } from '@nestjs/common';
import type { HealthStatus } from './health.service';

interface HttpRequestMetric {
  readonly method: string;
  readonly route: string;
  readonly statusCode: number;
  readonly durationMs: number;
}

interface RequestSeries {
  count: number;
  sumMs: number;
  buckets: Map<number, number>;
}

type DependencyState = HealthStatus['checks']['database']['status'] | 'not_configured';

const DURATION_BUCKETS_MS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

@Injectable()
export class MetricsService {
  private readonly startedAtMs = Date.now();
  private readonly requestCounts = new Map<string, number>();
  private readonly requestSeries = new Map<string, RequestSeries>();
  private lastReadiness: HealthStatus | null = null;

  recordHttpRequest(metric: HttpRequestMetric): void {
    const key = this.buildSeriesKey(metric.method, metric.route, metric.statusCode);
    const series = this.requestSeries.get(key) ?? {
      count: 0,
      sumMs: 0,
      buckets: new Map<number, number>(),
    };

    series.count += 1;
    series.sumMs += metric.durationMs;
    this.requestSeries.set(key, series);

    this.requestCounts.set(key, (this.requestCounts.get(key) ?? 0) + 1);

    for (const bucket of DURATION_BUCKETS_MS) {
      if (metric.durationMs <= bucket) {
        series.buckets.set(bucket, (series.buckets.get(bucket) ?? 0) + 1);
        break;
      }
    }
  }

  recordReadiness(readiness: HealthStatus): void {
    this.lastReadiness = readiness;
  }

  renderPrometheus(): string {
    const lines: string[] = [];

    lines.push('# HELP buildingos_process_uptime_seconds API process uptime in seconds.');
    lines.push('# TYPE buildingos_process_uptime_seconds gauge');
    lines.push(`buildingos_process_uptime_seconds ${(Date.now() - this.startedAtMs) / 1000}`);

    lines.push('# HELP buildingos_http_requests_total Total HTTP requests handled by the API.');
    lines.push('# TYPE buildingos_http_requests_total counter');
    for (const [key, count] of this.requestCounts.entries()) {
      const { method, route, statusCode } = this.parseSeriesKey(key);
      lines.push(
        `buildingos_http_requests_total{method="${this.escapeLabel(method)}",route="${this.escapeLabel(route)}",status_code="${statusCode}"} ${count}`,
      );
    }

    lines.push('# HELP buildingos_http_request_duration_ms HTTP request duration in milliseconds.');
    lines.push('# TYPE buildingos_http_request_duration_ms histogram');
    for (const [key, series] of this.requestSeries.entries()) {
      const { method, route, statusCode } = this.parseSeriesKey(key);
      let cumulative = 0;
      for (const bucket of DURATION_BUCKETS_MS) {
        cumulative += series.buckets.get(bucket) ?? 0;
        lines.push(
          `buildingos_http_request_duration_ms_bucket{method="${this.escapeLabel(method)}",route="${this.escapeLabel(route)}",status_code="${statusCode}",le="${bucket}"} ${cumulative}`,
        );
      }

      lines.push(
        `buildingos_http_request_duration_ms_bucket{method="${this.escapeLabel(method)}",route="${this.escapeLabel(route)}",status_code="${statusCode}",le="+Inf"} ${series.count}`,
      );
      lines.push(
        `buildingos_http_request_duration_ms_sum{method="${this.escapeLabel(method)}",route="${this.escapeLabel(route)}",status_code="${statusCode}"} ${series.sumMs}`,
      );
      lines.push(
        `buildingos_http_request_duration_ms_count{method="${this.escapeLabel(method)}",route="${this.escapeLabel(route)}",status_code="${statusCode}"} ${series.count}`,
      );
    }

    lines.push('# HELP buildingos_readiness_dependency_state Current readiness state per dependency.');
    lines.push('# TYPE buildingos_readiness_dependency_state gauge');
    if (this.lastReadiness) {
      this.renderDependencyState(lines, 'database', this.lastReadiness.checks.database.status);
      this.renderDependencyState(lines, 'storage', this.lastReadiness.checks.storage.status);
      this.renderDependencyState(lines, 'email', this.lastReadiness.checks.email.status);

      lines.push('# HELP buildingos_readiness_overall_status Overall readiness status.');
      lines.push('# TYPE buildingos_readiness_overall_status gauge');
      lines.push(`buildingos_readiness_overall_status{status="${this.lastReadiness.status}"} 1`);
    }

    return `${lines.join('\n')}\n`;
  }

  private renderDependencyState(
    lines: string[],
    dependency: string,
    state: DependencyState,
  ): void {
    const knownStates = ['up', 'down', 'not_configured'] as const;
    for (const knownState of knownStates) {
      lines.push(
        `buildingos_readiness_dependency_state{dependency="${dependency}",state="${knownState}"} ${state === knownState ? 1 : 0}`,
      );
    }
  }

  private buildSeriesKey(method: string, route: string, statusCode: number): string {
    return [method.toUpperCase(), route, statusCode].join('|');
  }

  private parseSeriesKey(key: string): { method: string; route: string; statusCode: number } {
    const [method = 'GET', route = 'unknown', statusCode = '0'] = key.split('|');
    return { method, route, statusCode: Number(statusCode) };
  }

  private escapeLabel(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  }
}
