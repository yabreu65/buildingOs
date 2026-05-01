import { OpsMetricsWorker } from './ops-metrics.worker';

describe('OpsMetricsWorker', () => {
  it('classifies schema drift errors as controlled readiness failures', () => {
    const worker = new OpsMetricsWorker({ runMetricsCheck: jest.fn() } as any);

    expect((worker as any).isSchemaDriftError({ code: 'P2022' })).toBe(true);
    expect((worker as any).isSchemaDriftError(new Error('relation "AssistantHandoff" does not exist'))).toBe(true);
    expect((worker as any).isSchemaDriftError(new Error('network down'))).toBe(false);
  });
});
