import { mapYoryiToCanonical } from './yoryi-bridge.mapper';

describe('yoryi bridge mapper', () => {
  it('maps payload without top-level toolName', () => {
    const result = mapYoryiToCanonical({
      answer: 'ok',
      answerSource: 'live_data',
      responseType: 'summary',
      actions: [],
    });

    expect(result).not.toBeNull();
    expect(result?.answer).toBe('ok');
    expect(result?.metadata.gatewayOutcome).toBe('success');
  });

  it('extracts intentCode from provenance', () => {
    const result = mapYoryiToCanonical({
      answer: 'ok',
      answerSource: 'live_data',
      provenance: {
        sources: [{
          metadata: {
            intentCode: 'GET_UNIT_DEBT',
            traceId: 'trace-1',
            resolvedLevel: 'P0',
            fallbackPath: 'none',
            gatewayOutcome: 'success',
            latencyMsTotal: 25,
            latencyMsRouting: 10,
            p0EnforcementEnabled: true,
            p3Enabled: false,
          },
        }],
      },
      actions: [],
    });

    expect(result?.metadata.intentCode).toBe('GET_UNIT_DEBT');
    expect(result?.metadata.traceId).toBe('trace-1');
    expect(result?.metadata.resolvedLevel).toBe('P0');
    expect(result?.metadata.latencyMsTotal).toBe(25);
    expect(result?.metadata.p0EnforcementEnabled).toBe(true);
  });

  it('returns null on invalid payload', () => {
    const result = mapYoryiToCanonical({ answerSource: 'live_data' });
    expect(result).toBeNull();
  });

  it('normalizes legacy response types to contract enum', () => {
    const metricResult = mapYoryiToCanonical({
      answer: 'deuda',
      answerSource: 'live_data',
      responseType: 'metric',
      actions: [],
    });
    expect(metricResult?.responseType).toBe('exact');

    const answerResult = mapYoryiToCanonical({
      answer: 'ok',
      answerSource: 'live_data',
      responseType: 'answer',
      actions: [],
    });
    expect(answerResult?.responseType).toBe('summary');
  });
});
