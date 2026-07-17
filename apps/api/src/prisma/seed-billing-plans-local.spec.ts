import { BillingPlanId } from '@prisma/client';
import { LOCAL_PLANS, synchronizeBillingPlans, validateLocalBillingEnvironment } from '../../prisma/seed-billing-plans-local';

const localUrl = 'postgresql://user:secret@127.0.0.1:5434/buildingos?schema=public';

function inMemoryClient(initial: Array<{ planId: BillingPlanId; maxUsers: number }>) {
  const records = new Map(initial.map((plan) => [plan.planId, { ...plan }]));
  const upsert = jest.fn(async ({ where, create, update }) => {
    const previous = records.get(where.planId);
    records.set(where.planId, { planId: where.planId, maxUsers: Number(update.maxUsers ?? create.maxUsers) });
    return previous;
  });
  const tx = { billingPlan: { upsert, findMany: jest.fn(async () => [...records.values()]) } };
  return { records, upsert, client: { billingPlan: { findMany: jest.fn(async () => [...records.values()]), upsert }, $transaction: jest.fn(async (fn) => fn(tx)) } };
}

describe('local billing plans catalog', () => {
  it.each(['production', 'staging'])('rejects NODE_ENV=%s', (NODE_ENV) => expect(() => validateLocalBillingEnvironment({ NODE_ENV, DATABASE_URL: localUrl })).toThrow());
  it.each(['mysql://x', 'postgresql://x:y@remote.example/buildingos', 'postgresql://x:y@localhost/other', 'postgresql://x:y@localhost/buildingos_staging'])('rejects unsafe URLs', (DATABASE_URL) => expect(() => validateLocalBillingEnvironment({ DATABASE_URL })).toThrow());
  it('accepts local PostgreSQL URLs', () => expect(() => validateLocalBillingEnvironment({ DATABASE_URL: localUrl })).not.toThrow());
  it('does not write during diagnosis', async () => {
    const upsert = jest.fn(); const client = { billingPlan: { findMany: jest.fn().mockResolvedValue([]), upsert }, $transaction: jest.fn() };
    await synchronizeBillingPlans(client as never, false);
    expect(upsert).not.toHaveBeenCalled(); expect(client.$transaction).not.toHaveBeenCalled();
  });
  it('upserts four plans and preserves FREE maxUsers=3', async () => {
    const upsert = jest.fn().mockResolvedValue({}); const tx = { billingPlan: { upsert, findMany: jest.fn() }, $transaction: jest.fn() };
    const client = { billingPlan: { findMany: jest.fn().mockResolvedValue([{ planId: BillingPlanId.FREE, maxUsers: 3 }]), upsert }, $transaction: jest.fn(async (fn) => fn(tx)) };
    await synchronizeBillingPlans(client as never, true);
    expect(upsert).toHaveBeenCalledTimes(4);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { planId: BillingPlanId.PRO }, create: expect.objectContaining({ maxBuildings: 10, maxUnits: 500, maxUsers: 50, maxOccupants: 1000 }) }));
  });
  it('accepts IPv6 local hosts', () => expect(() => validateLocalBillingEnvironment({ DATABASE_URL: 'postgresql://x:y@[::1]:5434/buildingos' })).not.toThrow());
  it('contains the official premium catalogs', () => {
    expect(LOCAL_PLANS.map((plan) => plan.planId)).toEqual([BillingPlanId.FREE, BillingPlanId.BASIC, BillingPlanId.PRO, BillingPlanId.ENTERPRISE]);
    expect(LOCAL_PLANS.find((plan) => plan.planId === BillingPlanId.BASIC)).toMatchObject({ maxUnits: 100, supportLevel: 'EMAIL' });
    expect(LOCAL_PLANS.find((plan) => plan.planId === BillingPlanId.PRO)).toMatchObject({ maxBuildings: 10, maxUnits: 500, maxUsers: 50, maxOccupants: 1000 });
    expect(LOCAL_PLANS.find((plan) => plan.planId === BillingPlanId.ENTERPRISE)).toMatchObject({ maxUnits: 9999, maxOccupants: 99999 });
  });
  it('is idempotent and never duplicates plans', async () => {
    const memory = inMemoryClient([{ planId: BillingPlanId.FREE, maxUsers: 3 }]);
    await synchronizeBillingPlans(memory.client as never, true);
    await synchronizeBillingPlans(memory.client as never, true);
    expect([...memory.records.keys()]).toEqual(expect.arrayContaining([BillingPlanId.FREE, BillingPlanId.BASIC, BillingPlanId.PRO, BillingPlanId.ENTERPRISE]));
    expect(memory.records.size).toBe(4);
    expect(memory.records.get(BillingPlanId.FREE)?.maxUsers).toBe(3);
  });
  it('propagates transaction failures', async () => {
    const failure = new Error('simulated transaction failure');
    const client = { billingPlan: { findMany: jest.fn().mockResolvedValue([]), upsert: jest.fn() }, $transaction: jest.fn().mockRejectedValue(failure) };
    await expect(synchronizeBillingPlans(client as never, true)).rejects.toThrow(failure);
  });
});
