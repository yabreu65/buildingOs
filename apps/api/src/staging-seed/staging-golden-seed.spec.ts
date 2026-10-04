import { readFileSync } from 'fs';
import { join } from 'path';
import * as bcrypt from 'bcrypt';

import { createAcceptanceSeedHashRecord, requiredPassword, runSeedMode, verifyAcceptanceSeedPasswordHash } from '../../prisma/seed-staging-golden';
import {
  applyStagingGoldenSeed,
  assertConnectedStagingGoldenTarget,
  assertSafeStagingGoldenEnvironment,
  STAGING_GOLDEN_DATASET,
  STAGING_GOLDEN_MARKER,
  StagingGoldenWriteClient,
  isAcceptanceHashHandoffEnabled,
  parseAcceptanceSeedHandoff,
} from '../../prisma/lib/staging-seed/staging-golden-seed';

interface StoredRecord {
  readonly id: string;
  readonly [key: string]: unknown;
}

class FakeDelegate {
  readonly records: StoredRecord[] = [];
  readonly created: StoredRecord[] = [];

  async findFirst({ where }: { readonly where: Readonly<Record<string, unknown>> }): Promise<StoredRecord | null> {
    return this.records.find((record) => Object.entries(where).every(([key, value]) => String(record[key]) === String(value))) ?? null;
  }

  async create({ data }: { readonly data: Readonly<Record<string, unknown>> }): Promise<StoredRecord> {
    const record = { ...data, id: String(data.id) } as StoredRecord;
    this.records.push(record);
    this.created.push(record);
    return record;
  }

  async update({ where, data }: { readonly where: Readonly<Record<string, unknown>>; readonly data: Readonly<Record<string, unknown>> }): Promise<StoredRecord> {
    const record = await this.findFirst({ where });
    if (!record) throw new Error('fake update target missing');
    const updated = { ...record, ...data } as StoredRecord;
    this.records.splice(this.records.indexOf(record), 1, updated);
    return updated;
  }

  async updateMany({ where, data }: { readonly where: Readonly<Record<string, unknown>>; readonly data: Readonly<Record<string, unknown>> }): Promise<{ count: number }> {
    const record = await this.findFirst({ where });
    if (!record) return { count: 0 };
    this.records.splice(this.records.indexOf(record), 1, { ...record, ...data } as StoredRecord);
    return { count: 1 };
  }
}

interface FakeDatabase {
  readonly client: StagingGoldenWriteClient;
  readonly delegates: Readonly<Record<string, FakeDelegate>>;
}

function createFakeDatabase(): FakeDatabase {
  const names = ['tenant', 'billingPlan', 'subscription', 'building', 'unit', 'user', 'membership', 'membershipRole', 'tenantMember', 'unitOccupant', 'expenseLedgerCategory', 'exchangeRate', 'charge', 'payment', 'paymentAllocation', 'paymentAuditLog', 'ticket'];
  const delegates = Object.fromEntries(names.map((name) => [name, new FakeDelegate()])) as Record<string, FakeDelegate>;
  delegates.billingPlan.records.push(
    { id: 'plan-free', planId: 'FREE' },
    { id: 'plan-pro', planId: 'PRO' },
  );
  const client = {
    ...delegates,
    async $transaction<T>(callback: (transaction: StagingGoldenWriteClient) => Promise<T>): Promise<T> {
      return callback(client as unknown as StagingGoldenWriteClient);
    },
  } as unknown as StagingGoldenWriteClient;
  return { client, delegates };
}

const baseEnvironment = {
  APP_ENV: 'staging',
  NODE_ENV: 'staging',
  STAGING_GOLDEN_SEED: '1',
  STAGING_GOLDEN_CONFIRMATION: 'STG-DATA-01',
  DATABASE_URL: 'postgresql://seed:placeholder@postgres:5432/buildingos_staging_db',
};

describe('STG-DATA-01 Golden Dataset safety', () => {
  it('keeps private marker handoff opt-in for acceptance-only seed runs', () => {
    expect(isAcceptanceHashHandoffEnabled({})).toBe(false);
    expect(isAcceptanceHashHandoffEnabled({ FINANCE_ACCEPTANCE_SEED_HASH_HANDOFF: '0' })).toBe(false);
    expect(isAcceptanceHashHandoffEnabled({ FINANCE_ACCEPTANCE_SEED_HASH_HANDOFF: '1' })).toBe(true);
  });

  it('rejects production', () => {
    expect(() => assertSafeStagingGoldenEnvironment({ ...baseEnvironment, APP_ENV: 'production' })).toThrow();
    expect(() => assertSafeStagingGoldenEnvironment({ ...baseEnvironment, NODE_ENV: 'production' })).toThrow();
    expect(() => assertSafeStagingGoldenEnvironment({ ...baseEnvironment, DATABASE_URL: 'postgresql://seed@postgres:5432/buildingos_prod' })).toThrow();
  });

  it('rejects a non-staging database target', () => {
    expect(() => assertSafeStagingGoldenEnvironment({ ...baseEnvironment, DATABASE_URL: 'postgresql://seed@localhost:5432/buildingos_staging_db' })).toThrow();
    expect(() => assertSafeStagingGoldenEnvironment({ ...baseEnvironment, DATABASE_URL: 'postgresql://seed@postgres:5432/other_db' })).toThrow();
  });

  it('requires explicit opt-in and confirmation', () => {
    expect(() => assertSafeStagingGoldenEnvironment({ ...baseEnvironment, STAGING_GOLDEN_SEED: undefined })).toThrow('STAGING_GOLDEN_SEED');
    expect(() => assertSafeStagingGoldenEnvironment({ ...baseEnvironment, STAGING_GOLDEN_CONFIRMATION: 'wrong' })).toThrow('STAGING_GOLDEN_CONFIRMATION');
  });

  it('requires the QA password at the application execution boundary', () => {
    const validPassword = 'x'.repeat(12);
    expect(() => requiredPassword({})).toThrow('STAGING_GOLDEN_QA_PASSWORD');
    expect(() => requiredPassword({ STAGING_GOLDEN_QA_PASSWORD: 'too-short' })).toThrow('STAGING_GOLDEN_QA_PASSWORD');
    expect(requiredPassword({ STAGING_GOLDEN_QA_PASSWORD: validPassword })).toBe(validPassword);
  });

  it('hash-only mode validates staging credentials and exits without invoking the mutating seed', async () => {
    const password = 'acceptance-qa-password';
    const marker = `__FINANCE_ACCEPTANCE_HASH_ONLY_${'a'.repeat(32)}__`;
    const output: string[] = [];
    let seedRuns = 0;

    await runSeedMode(
      'hash-acceptance-seed-password',
      { ...baseEnvironment, STAGING_GOLDEN_QA_PASSWORD: password, FINANCE_ACCEPTANCE_HASH_ONLY_MARKER: marker },
      (record) => output.push(record),
      async () => { seedRuns += 1; },
    );

    expect(seedRuns).toBe(0);
    expect(output).toHaveLength(1);
    expect(output[0]).toMatch(new RegExp(`^${marker}:\\$2[aby]\\$10\\$[./A-Za-z0-9]{53}\\n$`));
    const [, hash] = output[0]!.slice(0, -1).split(':');
    await expect(verifyAcceptanceSeedPasswordHash(hash!, password)).resolves.toBeUndefined();
    await expect(runSeedMode(
      'hash-acceptance-seed-password',
      { ...baseEnvironment, FINANCE_ACCEPTANCE_HASH_ONLY_MARKER: marker },
      () => { throw new Error('must not output a hash'); },
      async () => { seedRuns += 1; },
    )).rejects.toThrow('STAGING_GOLDEN_QA_PASSWORD');
    await expect(runSeedMode(
      'hash-acceptance-seed-password',
      { ...baseEnvironment, APP_ENV: 'production', STAGING_GOLDEN_QA_PASSWORD: password, FINANCE_ACCEPTANCE_HASH_ONLY_MARKER: marker },
      () => { throw new Error('must not output a hash'); },
      async () => { seedRuns += 1; },
    )).rejects.toThrow('APP_ENV=staging');
    await expect(runSeedMode(
      'hash-acceptance-seed-password',
      { ...baseEnvironment, STAGING_GOLDEN_QA_PASSWORD: password, FINANCE_ACCEPTANCE_HASH_ONLY_MARKER: 'invalid-marker' },
      () => { throw new Error('must not output a hash'); },
      async () => { seedRuns += 1; },
    )).rejects.toThrow('marker is missing or invalid');
    expect(seedRuns).toBe(0);
    const ordinaryOutput: string[] = [];
    await runSeedMode(undefined, baseEnvironment, (record) => ordinaryOutput.push(record), async () => { seedRuns += 1; });
    expect(seedRuns).toBe(1);
    expect(ordinaryOutput).toHaveLength(0);
  });

  it('parses acceptance seed handoff and rejects malformed or mismatched bcrypt postimages', async () => {
    const password = 'acceptance-qa-password';
    const passwordHash = await bcrypt.hash(password, 10);
    const passwordHashes = STAGING_GOLDEN_DATASET.flatMap((tenant) => tenant.users.map((user) => ({
      id: user.id,
      email: user.email,
      passwordHash: 'captured-preimage',
    })));
    const serialized = JSON.stringify({ passwordHashes, seedPasswordHash: passwordHash });

    expect(parseAcceptanceSeedHandoff(serialized)).toEqual({ passwordHashes, seedPasswordHash: passwordHash });
    await expect(verifyAcceptanceSeedPasswordHash(passwordHash, password)).resolves.toBeUndefined();
    await expect(verifyAcceptanceSeedPasswordHash(passwordHash, 'different-password')).rejects.toThrow('does not match');
    await expect(verifyAcceptanceSeedPasswordHash('not-a-bcrypt-hash', password)).rejects.toThrow('invalid');
    for (const malformed of ['not-json', '{}', JSON.stringify({ passwordHashes: [], seedPasswordHash: 'not-a-bcrypt-hash' }), JSON.stringify({ passwordHashes: {}, seedPasswordHash: passwordHash })]) {
      expect(() => parseAcceptanceSeedHandoff(malformed)).toThrow('invalid or incomplete');
    }
  });

  it('validates the supplied acceptance hash against stdin and QA password before constructing Prisma', () => {
    const source = readFileSync(join(__dirname, '../../prisma/seed-staging-golden.ts'), 'utf8');
    const stdinRead = source.indexOf('for await (const chunk of process.stdin)');
    const parsedHandoff = source.indexOf('parseAcceptanceSeedHandoff(serializedHandoff)');
    const passwordVerification = source.indexOf('verifyAcceptanceSeedPasswordHash(handoff.seedPasswordHash, password)');
    const prismaConstruction = source.indexOf('const prisma = new PrismaClient()');
    expect(stdinRead).toBeGreaterThanOrEqual(0);
    expect(parsedHandoff).toBeGreaterThan(stdinRead);
    expect(passwordVerification).toBeGreaterThan(parsedHandoff);
    expect(passwordVerification).toBeLessThan(prismaConstruction);
    expect(source).toContain('passwordHash = handoff.seedPasswordHash');
    expect(source).toContain('passwordHash = await bcrypt.hash(password, 10)');
  });

  it('keeps the Golden service profile-gated without requiring its password during Compose interpolation', () => {
    const compose = readFileSync(join(__dirname, '../../../../infra/docker/docker-compose.staging.yml'), 'utf8');
    const service = compose.match(/  api-seed-staging-golden:\n([\s\S]*?)(?=\n  [a-z])/i)?.[1] ?? '';
    expect(service).toContain('profiles: ["seed-staging-golden"]');
    expect(service).toContain('STAGING_GOLDEN_QA_PASSWORD: ${STAGING_GOLDEN_QA_PASSWORD:-}');
    expect(service).not.toContain('STAGING_GOLDEN_QA_PASSWORD:?');
  });

  it('requires the verified PostgreSQL identity to be private staging infrastructure', async () => {
    const target = assertSafeStagingGoldenEnvironment(baseEnvironment);
    await expect(assertConnectedStagingGoldenTarget({ readConnectionIdentity: async () => ({ database: target.database, address: '172.20.0.3' }) }, target)).resolves.toEqual({ database: target.database, address: '172.20.0.3' });
    await expect(assertConnectedStagingGoldenTarget({ readConnectionIdentity: async () => ({ database: 'other', address: '172.20.0.3' }) }, target)).rejects.toThrow();
    await expect(assertConnectedStagingGoldenTarget({ readConnectionIdentity: async () => ({ database: target.database, address: '8.8.8.8' }) }, target)).rejects.toThrow();
  });

  it.each([
    ['10.1.2.3', true],
    ['172.16.0.1', true],
    ['172.31.255.254', true],
    ['172.15.0.1', false],
    ['172.32.0.1', false],
    ['192.168.1.5', true],
    ['8.8.8.8', false],
    ['not-an-address', false],
    [null, false],
  ] as const)('validates staging address %s as private=%s', async (address, accepted) => {
    const target = assertSafeStagingGoldenEnvironment(baseEnvironment);
    const result = assertConnectedStagingGoldenTarget({ readConnectionIdentity: async () => ({ database: target.database, address }) }, target);
    if (accepted) {
      await expect(result).resolves.toMatchObject({ database: target.database, address });
    } else {
      await expect(result).rejects.toThrow();
    }
  });

  it('creates owned Golden records on the first run', async () => {
    const database = createFakeDatabase();
    await applyStagingGoldenSeed(database.client, 'hashed-qa-password');
    expect(database.delegates.tenant.created).toHaveLength(3);
    expect(database.delegates.building.created).toHaveLength(5);
    expect(database.delegates.unit.created).toHaveLength(18);
    expect(database.delegates.tenant.created.every((tenant) => tenant.brandName === STAGING_GOLDEN_MARKER)).toBe(true);
  });

  it('is idempotent on the second run', async () => {
    const database = createFakeDatabase();
    await applyStagingGoldenSeed(database.client, 'hashed-qa-password');
    const counts = Object.fromEntries(Object.entries(database.delegates).map(([name, delegate]) => [name, delegate.created.length]));
    await applyStagingGoldenSeed(database.client, 'hashed-qa-password');
    expect(Object.fromEntries(Object.entries(database.delegates).map(([name, delegate]) => [name, delegate.created.length]))).toEqual(counts);
  });

  it('is idempotent when PostgreSQL returns null for an identity payment rate ID', async () => {
    const database = createFakeDatabase();
    await applyStagingGoldenSeed(database.client, 'hashed-qa-password');
    const payment = database.delegates.payment.records.find((record) => record.id === 'stg-golden-payment-auto-101');
    if (!payment) throw new Error('expected identity payment missing from fake');

    // Fake persistence keeps omitted nullable values as undefined; Prisma/PostgreSQL returns them as null.
    const paymentIndex = database.delegates.payment.records.indexOf(payment);
    database.delegates.payment.records.splice(paymentIndex, 1, { ...payment, exchangeRateId: null });
    const createdPayments = database.delegates.payment.created.length;

    await applyStagingGoldenSeed(database.client, 'hashed-qa-password');

    expect(database.delegates.payment.created).toHaveLength(createdPayments);
    expect(database.delegates.payment.records.filter((record) => record.id === payment.id)).toHaveLength(1);
    expect(database.delegates.payment.records.find((record) => record.id === payment.id)).toMatchObject({ exchangeRateId: null });
  });

  it('preserves unrelated tenants and residents', async () => {
    const database = createFakeDatabase();
    database.delegates.tenant.records.push({ id: 'unrelated-tenant', name: 'Compatibility Tenant', type: 'ADMINISTRADORA' });
    database.delegates.user.records.push({ id: 'unrelated-user', email: 'existing@example.invalid', name: 'Existing User', passwordHash: 'redacted' });
    await applyStagingGoldenSeed(database.client, 'hashed-qa-password');
    expect(database.delegates.tenant.records.find((record) => record.id === 'unrelated-tenant')).toMatchObject({ name: 'Compatibility Tenant' });
    expect(database.delegates.user.records.find((record) => record.id === 'unrelated-user')).toMatchObject({ name: 'Existing User' });
  });

  it('does not create duplicate Golden tenants', async () => {
    const database = createFakeDatabase();
    await applyStagingGoldenSeed(database.client, 'hashed-qa-password');
    await applyStagingGoldenSeed(database.client, 'hashed-qa-password');
    expect(database.delegates.tenant.records.filter((record) => String(record.brandName) === STAGING_GOLDEN_MARKER)).toHaveLength(3);
  });

  it('rejects an unowned same-name tenant instead of adopting it', async () => {
    const database = createFakeDatabase();
    database.delegates.tenant.records.push({ id: 'existing-same-name', name: 'STG QA - Autogestionada', type: 'EDIFICIO_AUTOGESTION' });
    await expect(applyStagingGoldenSeed(database.client, 'hashed-qa-password')).rejects.toThrow('incompatible');
  });

  it('rejects a same-email user with a different stable Golden ID', async () => {
    const database = createFakeDatabase();
    database.delegates.user.records.push({ id: 'unowned-user', email: 'owner.autogestionada@staging.buildingos.local', name: 'STG QA Autogestionada Owner', passwordHash: 'redacted' });
    await expect(applyStagingGoldenSeed(database.client, 'hashed-qa-password')).rejects.toThrow('incompatible');
  });

  it('replaces every captured Golden password hash through the acceptance-mode CAS path', async () => {
    const database = createFakeDatabase();
    const tenantUsers = STAGING_GOLDEN_DATASET.flatMap((tenant) => tenant.users);
    const capturedHash = 'captured-password-hash';
    const generatedSeedHash = 'generated-seed-password-hash';
    database.delegates.user.records.push(...tenantUsers.map((user) => ({
      id: user.id,
      email: user.email,
      name: user.name,
      passwordHash: capturedHash,
    })));
    const baseline = tenantUsers.map((user) => ({ id: user.id, email: user.email, passwordHash: capturedHash }));

    await applyStagingGoldenSeed(database.client, generatedSeedHash, STAGING_GOLDEN_DATASET, baseline);

    expect(database.delegates.user.records.filter((record) => tenantUsers.some((user) => user.id === record.id))).toEqual(
      tenantUsers.map((user) => expect.objectContaining({ id: user.id, email: user.email, passwordHash: generatedSeedHash })),
    );
  });

  it('fails closed when an existing Golden password hash changed after baseline capture', async () => {
    const database = createFakeDatabase();
    const tenantUsers = STAGING_GOLDEN_DATASET[0].users;
    const concurrentHash = 'concurrent-password-hash';
    database.delegates.user.records.push(...tenantUsers.map((user, index) => ({
      id: user.id,
      email: user.email,
      name: user.name,
      passwordHash: index === 0 ? concurrentHash : 'captured-password-hash',
    })));
    const baseline = tenantUsers.map((user) => ({ id: user.id, email: user.email, passwordHash: 'captured-password-hash' }));

    await expect(applyStagingGoldenSeed(database.client, 'generated-seed-hash', STAGING_GOLDEN_DATASET.slice(0, 1), baseline)).rejects.toThrow('pre-seed password baseline changed');
    expect(database.delegates.user.records[0].passwordHash).toBe(concurrentHash);
  });

  it('does not create an existing Golden user missing after baseline capture', async () => {
    const database = createFakeDatabase();
    const tenantUsers = STAGING_GOLDEN_DATASET[0].users;
    database.delegates.user.records.push(...tenantUsers.slice(1).map((user) => ({
      id: user.id,
      email: user.email,
      name: user.name,
      passwordHash: 'captured-password-hash',
    })));
    const baseline = tenantUsers.map((user) => ({ id: user.id, email: user.email, passwordHash: 'captured-password-hash' }));

    await expect(applyStagingGoldenSeed(database.client, 'generated-seed-hash', STAGING_GOLDEN_DATASET.slice(0, 1), baseline)).rejects.toThrow('pre-seed password baseline changed');
    expect(database.delegates.user.records).toHaveLength(3);
  });

  it('repairs a missing owned record without broad cleanup', async () => {
    const database = createFakeDatabase();
    database.delegates.tenant.records.push({ id: 'unrelated-tenant', name: 'Compatibility Tenant', type: 'ADMINISTRADORA' });
    await applyStagingGoldenSeed(database.client, 'hashed-qa-password');
    const missing = database.delegates.unit.records.find((record) => record.id === 'stg-golden-unit-auto-104');
    if (!missing) throw new Error('expected owned unit missing from fake');
    database.delegates.unit.records.splice(database.delegates.unit.records.indexOf(missing), 1);
    await applyStagingGoldenSeed(database.client, 'hashed-qa-password');
    expect(database.delegates.unit.records.some((record) => record.id === missing.id)).toBe(true);
    expect(database.delegates.tenant.records.some((record) => record.id === 'unrelated-tenant')).toBe(true);
  });

  it('contains no broad deletion operation', () => {
    const source = readFileSync(join(__dirname, '../../prisma/lib/staging-seed/staging-golden-seed.ts'), 'utf8');
    expect(source).not.toMatch(/deleteMany|truncate|DROP|executeRawUnsafe/);
  });

  it('contains no partial-payment fixture and every payment allocates its full amount', () => {
    for (const tenant of STAGING_GOLDEN_DATASET) {
      expect(JSON.stringify(tenant)).not.toContain('PARTIAL');
      for (const payment of tenant.payments) expect(payment.allocations.reduce((sum, allocation) => sum + allocation.amount, 0)).toBe(payment.amount);
    }
  });

  it('contains FIFO-compatible complete oldest-first finance data', () => {
    const multi = STAGING_GOLDEN_DATASET.find((tenant) => tenant.name.endsWith('Administradora Multi'));
    if (!multi) throw new Error('multi tenant missing');
    const oldFirst = multi.charges.filter((charge) => charge.unitCode === 'B2-201').sort((left, right) => left.period.localeCompare(right.period));
    expect(multi.payments.find((payment) => payment.id.endsWith('fifo'))?.allocations.map((allocation) => allocation.chargeId)).toEqual(oldFirst.map((charge) => charge.id));
    expect(multi.charges.every((charge) => charge.status === 'PAID' || charge.status === 'PENDING')).toBe(true);
  });

  it('contains correct USD identity and VES/COP conversion snapshots', () => {
    const multi = STAGING_GOLDEN_DATASET.find((tenant) => tenant.name.endsWith('Administradora Multi'));
    expect(multi).toMatchObject({ currency: 'USD', functionalCurrency: 'USD' });
    expect(multi?.exchangeRates.map((rate) => [rate.baseCurrency, rate.rate])).toEqual([['VES', '0.025'], ['COP', '0.00025']]);
    expect(multi?.payments.filter((payment) => payment.currency !== 'USD').map((payment) => [payment.currency, payment.functionalAmountMinor, payment.exchangeRateValue])).toEqual([['VES', 10000, '0.025'], ['COP', 10000, '0.00025']]);
  });

  it('models the mixed-role and multi-unit contexts', () => {
    const edgeMixed = STAGING_GOLDEN_DATASET.find((tenant) => tenant.name.endsWith('Edge Cases'))?.users.find((user) => user.email.includes('admin.resident'));
    const multiContext = STAGING_GOLDEN_DATASET.find((tenant) => tenant.name.endsWith('Administradora Multi'))?.users.find((user) => user.email.includes('context'));
    expect(edgeMixed?.roles).toEqual(['TENANT_ADMIN', 'RESIDENT']);
    expect(edgeMixed?.occupantAssignments).toHaveLength(1);
    expect(multiContext?.occupantAssignments.map((assignment) => assignment.unitCode)).toEqual(['B1-101', 'B2-201']);
  });

  it('keeps vacant units without occupant assignments', () => {
    for (const tenant of STAGING_GOLDEN_DATASET) {
      const occupiedCodes = new Set(tenant.users.flatMap((user) => user.occupantAssignments.map((assignment) => assignment.unitCode)));
      const vacantCodes = tenant.buildings.flatMap((building) => building.units).filter((unit) => unit.occupancyStatus === 'VACANT').map((unit) => unit.code);
      expect(vacantCodes.every((code) => !occupiedCodes.has(code))).toBe(true);
    }
  });
});
