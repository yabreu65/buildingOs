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
            familyChosen: 'TOP_N',
            fallbackPath: 'none',
            gatewayOutcome: 'success',
            missingEntities: [],
            defaultsApplied: ['period'],
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
    expect(result?.metadata).not.toHaveProperty('resolvedPath');
    expect(result?.metadata.familyChosen).toBe('TOP_N');
    expect(result?.metadata.defaultsApplied).toEqual(['period']);
    expect(result?.metadata.latencyMsTotal).toBe(25);
    expect(result?.metadata.p0EnforcementEnabled).toBe(true);
  });

  it('falls back to root metadata when provenance metadata is absent', () => {
    const result = mapYoryiToCanonical({
      answer: 'ok',
      answerSource: 'live_data',
      metadata: {
        traceId: 'trace-root',
        resolvedLevel: 'P1',
        gatewayOutcome: 'missing_entities',
        missingEntities: ['buildingId'],
      },
      actions: [],
    });

    expect(result?.metadata.traceId).toBe('trace-root');
    expect(result?.metadata).not.toHaveProperty('resolvedPath');
    expect(result?.metadata.gatewayOutcome).toBe('missing_entities');
    expect(result?.metadata.missingEntities).toEqual(['buildingId']);
  });

  it('uses only provenance.sources[0].metadata before falling back to root metadata', () => {
    const result = mapYoryiToCanonical({
      answer: 'ok',
      answerSource: 'live_data',
      metadata: {
        traceId: 'trace-root',
        gatewayOutcome: 'missing_entities',
        missingEntities: ['period'],
      },
      provenance: {
        sources: [
          { name: 'first-source-without-metadata' } as any,
          {
            metadata: {
              traceId: 'trace-second',
              gatewayOutcome: 'success',
              missingEntities: [],
            },
          },
        ],
      },
      actions: [],
    });

    expect(result?.metadata.traceId).toBe('trace-root');
    expect(result?.metadata.gatewayOutcome).toBe('missing_entities');
    expect(result?.metadata.missingEntities).toEqual(['period']);
  });

  it('does not require debug-only matcher fields', () => {
    const result = mapYoryiToCanonical({
      answer: 'ok',
      answerSource: 'live_data',
      metadata: {
        traceId: 'trace-no-debug',
        gatewayOutcome: 'success',
      },
      actions: [],
    });

    expect(result).not.toBeNull();
    expect(result?.metadata).not.toHaveProperty('matchedUtterance');
    expect(result?.metadata).not.toHaveProperty('topCandidates');
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

  it('accepts snapshot answerSource from the engine without rewriting it', () => {
    const result = mapYoryiToCanonical({
      answer: 'Snapshot financiero',
      answerSource: 'snapshot',
      responseType: 'summary',
      actions: [],
      provenance: {
        sources: [{ metadata: { resolvedLevel: 'P2', gatewayOutcome: 'success' } }],
      },
    });

    expect(result).not.toBeNull();
    expect(result?.answerSource).toBe('snapshot');
    expect(result?.metadata.resolvedLevel).toBe('P2');
  });
});
