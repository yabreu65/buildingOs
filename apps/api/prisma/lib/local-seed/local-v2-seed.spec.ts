import {
  AdjustmentStatus,
  ChargeStatus,
  CommunicationChannel,
  CommunicationStatus,
  PaymentMethod,
  PaymentAuditAction,
  PaymentStatus,
  ReceiptStatus,
  Role,
  TenantType,
  TicketCategory,
  TicketPriority,
  TicketStatus,
} from '@prisma/client';
import {
  applyLocalV2Seed,
  assertConnectedLocalV2Target,
  assertSafeLocalV2SeedEnvironment,
  comparable,
  LOCAL_V2_PASSWORD,
  LOCAL_V2_SEED_DEFINITION,
  LocalV2WriteClient,
} from './local-v2-seed';

type FindFirstArgs = Parameters<LocalV2WriteClient['unit']['findFirst']>[0];
type RecordValue = Awaited<ReturnType<LocalV2WriteClient['unit']['create']>>;
type FindFirstOverride = (where: FindFirstArgs['where']) => RecordValue | null;

interface CreatedRecord {
  readonly name: string;
  readonly data: Record<string, unknown>;
}

function createWriteClient(overrides: {
  readonly unit?: FindFirstOverride;
  readonly unitOccupant?: FindFirstOverride;
} = {}): LocalV2WriteClient & { readonly createdRecords: readonly CreatedRecord[] } {
  const counters = new Map<string, number>();
  const createdRecords: CreatedRecord[] = [];
  const delegate = (name: string, override?: FindFirstOverride): LocalV2WriteClient['unit'] => ({
    async findFirst({ where }) {
      return override?.(where) ?? null;
    },
    async create({ data }) {
      const next = (counters.get(name) ?? 0) + 1;
      counters.set(name, next);
      const record = { id: `${name}-${next}`, ...data } as RecordValue;
      createdRecords.push({ name, data: record });
      return record;
    },
  });

  let client: LocalV2WriteClient;
  client = {
    tenant: delegate('tenant'),
    building: delegate('building'),
    unit: delegate('unit', overrides.unit),
    user: delegate('user'),
    membership: delegate('membership'),
    membershipRole: delegate('membershipRole'),
    tenantMember: delegate('tenantMember'),
    unitOccupant: delegate('unitOccupant', overrides.unitOccupant),
    charge: delegate('charge'),
    payment: delegate('payment'),
    paymentAllocation: delegate('paymentAllocation'),
    paymentAuditLog: delegate('paymentAuditLog'),
    exchangeRate: delegate('exchangeRate'),
    expenseLedgerCategory: delegate('expenseLedgerCategory'),
    adjustment: delegate('adjustment'),
    ticket: delegate('ticket'),
    communication: delegate('communication'),
    communicationTarget: delegate('communicationTarget'),
    communicationReceipt: delegate('communicationReceipt'),
    async $transaction<T>(callback: (transaction: LocalV2WriteClient) => Promise<T>): Promise<T> {
      return callback(client);
    },
  };
  return Object.assign(client, { createdRecords });
}

const connectedLocalTarget = {
  database: 'buildingos_local_v2_test' as const,
  host: 'localhost' as const,
};

const connection = {
  readConnectionIdentity: jest.fn().mockResolvedValue({ database: connectedLocalTarget.database, address: '127.0.0.1' }),
};

const password = {
  passwordHash: 'test-password-hash',
  matches: jest.fn().mockResolvedValue(true),
};

describe('LOCAL V2 seed safety', () => {
  const baseEnvironment = {
    LOCAL_V2_SEED: '1',
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://local:local-v2-only@localhost:5432/buildingos_local_v2_test',
  };

  it.each([
    ['localhost', 'localhost'],
    ['IPv4 loopback', '127.0.0.1'],
    ['IPv6 loopback', '[::1]'],
  ])('accepts the %s host', (_label, host) => {
    expect(assertSafeLocalV2SeedEnvironment({
      ...baseEnvironment,
      DATABASE_URL: `postgresql://local:local-v2-only@${host}:5432/buildingos_local_v2_test`,
    })).toEqual({ database: 'buildingos_local_v2_test', host: host.replace(/^\[|\]$/g, '') });
  });

  it.each([
    'postgresql://local:local-v2-only@db.example.com:5432/buildingos_local_v2_test',
    'postgresql://local:local-v2-only@staging.local:5432/buildingos_local_v2_test',
    'postgresql://local:local-v2-only@prod.local:5432/buildingos_local_v2_test',
    'postgresql://local:local-v2-only@production.local:5432/buildingos_local_v2_test',
  ])('rejects remote, staging, and production hosts: %s', (databaseUrl) => {
    expect(() => assertSafeLocalV2SeedEnvironment({ ...baseEnvironment, DATABASE_URL: databaseUrl })).toThrow();
  });

  it.each([
    'postgresql://local:local-v2-only@172.18.0.4:5432/buildingos_local_v2_test',
    'postgresql://local:local-v2-only@10.0.0.5:5432/buildingos_local_v2_test',
    'postgresql://local:local-v2-only@192.168.1.5:5432/buildingos_local_v2_test',
  ])('rejects private (non-loopback) database URL host: %s', (databaseUrl) => {
    expect(() => assertSafeLocalV2SeedEnvironment({ ...baseEnvironment, DATABASE_URL: databaseUrl })).toThrow();
  });

  it.each([
    'postgresql://local:local-v2-only@localhost:5432/other',
    'postgresql://local:local-v2-only@localhost:5432/buildingos_staging',
    'postgresql://local:local-v2-only@localhost:5432/buildingos_prod',
    'postgresql://local:local-v2-only@localhost:5432/production',
  ])('rejects an unapproved or dangerous database: %s', (databaseUrl) => {
    expect(() => assertSafeLocalV2SeedEnvironment({ ...baseEnvironment, DATABASE_URL: databaseUrl })).toThrow();
  });

  it('accepts the isolated test database without replacement confirmation', () => {
    expect(assertSafeLocalV2SeedEnvironment(baseEnvironment)).toEqual({
      database: 'buildingos_local_v2_test',
      host: 'localhost',
    });
  });

  it('requires exact replacement confirmation for buildingos', () => {
    const environment = {
      ...baseEnvironment,
      DATABASE_URL: 'postgresql://local:local-v2-only@localhost:5432/buildingos',
    };
    expect(() => assertSafeLocalV2SeedEnvironment(environment)).toThrow('LOCAL_V2_REPLACE_CONFIRMATION');
    expect(assertSafeLocalV2SeedEnvironment({
      ...environment,
      LOCAL_V2_REPLACE_CONFIRMATION: 'REPLACE buildingos WITH LOCAL_V2',
    })).toEqual({ database: 'buildingos', host: 'localhost' });
  });

  it('requires the exact opt-in flag before parsing the target', () => {
    expect(() => assertSafeLocalV2SeedEnvironment({ ...baseEnvironment, LOCAL_V2_SEED: 'yes' })).toThrow('LOCAL_V2_SEED');
  });

  it.each(['production', 'staging', 'preview', 'ci'])('rejects NODE_ENV=%s', (nodeEnv) => {
    expect(() => assertSafeLocalV2SeedEnvironment({ ...baseEnvironment, NODE_ENV: nodeEnv })).toThrow('NODE_ENV');
  });

  it.each([undefined, '', 'development', 'test'])('accepts NODE_ENV=%s', (nodeEnv) => {
    expect(assertSafeLocalV2SeedEnvironment({ ...baseEnvironment, NODE_ENV: nodeEnv })).toEqual({
      database: 'buildingos_local_v2_test',
      host: 'localhost',
    });
  });

  it('rejects invalid URLs and non-PostgreSQL protocols', () => {
    expect(() => assertSafeLocalV2SeedEnvironment({ ...baseEnvironment, DATABASE_URL: 'not-a-url' })).toThrow();
    expect(() => assertSafeLocalV2SeedEnvironment({ ...baseEnvironment, DATABASE_URL: 'mysql://local@localhost/buildingos_local_v2_test' })).toThrow();
  });

  it('checks the connected database and local server address through an abstract client', async () => {
    const target = assertSafeLocalV2SeedEnvironment(baseEnvironment);
    await expect(assertConnectedLocalV2Target({
      readConnectionIdentity: jest.fn().mockResolvedValue({ database: target.database, address: '127.0.0.1' }),
    }, target)).resolves.toEqual({ database: target.database, address: '127.0.0.1' });
    await expect(assertConnectedLocalV2Target({
      readConnectionIdentity: jest.fn().mockResolvedValue({ database: 'other', address: '127.0.0.1' }),
    }, target)).rejects.toThrow('expected');
    await expect(assertConnectedLocalV2Target({
      readConnectionIdentity: jest.fn().mockResolvedValue({ database: target.database, address: null }),
    }, target)).rejects.toThrow('address');
    await expect(assertConnectedLocalV2Target({
      readConnectionIdentity: jest.fn().mockResolvedValue({ database: target.database, address: '8.8.8.8' }),
    }, target)).rejects.toThrow('non-local');
  });

  it.each([
    ['Docker bridge IPv4 with CIDR', '172.18.0.4/32'],
    ['private 10/8', '10.0.0.10'],
    ['private 172.16/12', '172.16.5.1'],
    ['private 192.168/16', '192.168.1.5'],
    ['link-local IPv4', '169.254.1.1'],
    ['IPv6 loopback', '::1'],
    ['IPv6 ULA', 'fd00::1'],
  ])('accepts local private/loopback server address %s', async (_label, address) => {
    const target = assertSafeLocalV2SeedEnvironment(baseEnvironment);
    await expect(assertConnectedLocalV2Target({
      readConnectionIdentity: jest.fn().mockResolvedValue({ database: target.database, address }),
    }, target)).resolves.toEqual({ database: target.database, address });
  });
});

describe('LOCAL V2 seed definition', () => {
  const definition = LOCAL_V2_SEED_DEFINITION;
  const tenants = definition.tenants;
  const buildings = tenants.flatMap((tenant) => tenant.buildings);
  const units = buildings.flatMap((building) => building.units);
  const users = tenants.flatMap((tenant) => tenant.users);
  const memberships = users;
  const roles = users.flatMap((user) => user.roles);
  const tenantMembers = users.filter((user) => user.createTenantMember);
  const occupancies = users.flatMap((user) => user.unitCodes.map((unitCode) => ({ email: user.email, unitCode })));
  const charges = tenants.flatMap((tenant) => tenant.charges);
  const payments = tenants.flatMap((tenant) => tenant.payments);
  const allocations = payments.flatMap((payment) => payment.allocations);
  const adjustments = tenants.flatMap((tenant) => tenant.adjustments);
  const exchangeRates = tenants.flatMap((tenant) => tenant.exchangeRates);
  const tickets = tenants.flatMap((tenant) => tenant.tickets);
  const communications = tenants.flatMap((tenant) => tenant.communications);
  const communicationReceipts = communications.flatMap((communication) => communication.recipientEmails);

  it('uses the centralized local-only password', () => {
    expect(LOCAL_V2_PASSWORD).toBe('local-v2-only');
    expect(users.every((user) => user.password === LOCAL_V2_PASSWORD)).toBe(true);
  });

  it('matches every required entity total', () => {
    expect({
      tenants: tenants.length,
      buildings: buildings.length,
      units: units.length,
      users: users.length,
      memberships: memberships.length,
      membershipRoles: roles.length,
      tenantMembers: tenantMembers.length,
      occupancies: occupancies.length,
      charges: charges.length,
      payments: payments.length,
      paymentAllocations: allocations.length,
      paymentsWithReceiptEvidence: payments.filter((payment) => payment.receiptEvidence).length,
      adjustments: adjustments.length,
      exchangeRates: exchangeRates.length,
      tickets: tickets.length,
      communications: communications.length,
      communicationReceipts: communicationReceipts.length,
    }).toEqual({
      tenants: 4,
      buildings: 7,
      units: 27,
      users: 29,
      memberships: 29,
      membershipRoles: 30,
      tenantMembers: 28,
      occupancies: 22,
      charges: 24,
      payments: 12,
      paymentAllocations: 13,
      paymentsWithReceiptEvidence: 12,
      adjustments: 3,
      exchangeRates: 2,
      tickets: 4,
      communications: 4,
      communicationReceipts: 10,
    });
  });

  it('uses only actual Prisma enum values touched by the seed', () => {
    const enumValues = <T extends string>(values: Readonly<Record<string, T>>): ReadonlySet<T> => new Set(Object.values(values));

    expect(tenants.every((tenant) => enumValues(TenantType).has(tenant.type))).toBe(true);
    expect(users.every((seedUser) => seedUser.roles.every((role) => enumValues(Role).has(role)))).toBe(true);
    expect(charges.every((charge) => enumValues(ChargeStatus).has(charge.status))).toBe(true);
    expect(payments.every((payment) => enumValues(PaymentStatus).has(payment.status))).toBe(true);
    expect(payments.every((payment) => enumValues(PaymentMethod).has(payment.method))).toBe(true);
    expect(payments.every((payment) => enumValues(ReceiptStatus).has(payment.receiptEvidence.receiptStatus))).toBe(true);
    expect(adjustments.every((adjustment) => enumValues(AdjustmentStatus).has(adjustment.status))).toBe(true);
    expect(tickets.every((ticket) => enumValues(TicketCategory).has(ticket.category))).toBe(true);
    expect(tickets.every((ticket) => enumValues(TicketPriority).has(ticket.priority))).toBe(true);
    expect(tickets.every((ticket) => enumValues(TicketStatus).has(ticket.status))).toBe(true);
    expect(communications.every((communication) => enumValues(CommunicationChannel).has(communication.channel))).toBe(true);
    expect(communications.every((communication) => enumValues(CommunicationStatus).has(communication.status))).toBe(true);
  });

  it('uses MAINTENANCE rather than REPAIR for local repair ticket scenarios', () => {
    expect(tickets.map((ticket) => ticket.category)).toEqual(['MAINTENANCE', 'MAINTENANCE', 'BILLING', 'MAINTENANCE']);
  });

  it('keeps all emails, unit codes, and semantic keys unique', () => {
    const semanticKeys = [
      ...charges.map((record) => record.semanticKey),
      ...payments.map((record) => record.semanticKey),
      ...adjustments.map((record) => record.semanticKey),
      ...tickets.map((record) => record.semanticKey),
      ...communications.map((record) => record.semanticKey),
    ];
    expect(new Set(users.map((user) => user.email)).size).toBe(users.length);
    expect(new Set(units.map((unit) => unit.code)).size).toBe(units.length);
    expect(new Set(semanticKeys).size).toBe(semanticKeys.length);
    expect(semanticKeys.every((key) => key.startsWith('local-v2:'))).toBe(true);
  });

  it('models the mixed QA account once with two roles', () => {
    const matches = users.filter((user) => user.email === 'admin-resident.qa@buildingos.local');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.roles).toEqual(['TENANT_ADMIN', 'RESIDENT']);
    expect(matches[0]?.unitCodes).toEqual(['QA-101']);
  });

  it('models the multi-property resident once with two occupied units', () => {
    const matches = users.filter((user) => user.email === 'resident.multi@buildingos.local');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.unitCodes).toEqual(['ROB-102', 'PAR-301']);
  });

  it('keeps vacant units free of occupancies', () => {
    const occupiedCodes = new Set(occupancies.map((occupancy) => occupancy.unitCode));
    const vacantCodes = units.filter((unit) => unit.occupancyStatus === 'VACANT').map((unit) => unit.code);
    expect(vacantCodes).toEqual(expect.arrayContaining(['AUTO-106', 'NOR-102', 'SUR-102', 'ROB-104', 'QA-103']));
    expect(vacantCodes.every((code) => !occupiedCodes.has(code))).toBe(true);
  });

  it('contains ZERO partial seeded allocations (no partial payments)', () => {
    const allocatedByCharge = new Map<string, number>();
    for (const allocation of allocations) {
      allocatedByCharge.set(
        allocation.chargeSemanticKey,
        (allocatedByCharge.get(allocation.chargeSemanticKey) ?? 0) + allocation.amount,
      );
    }

    for (const charge of charges) {
      expect(charge.status).not.toBe('PARTIAL');
      const allocated = allocatedByCharge.get(charge.semanticKey) ?? 0;
      if (allocated > 0) {
        expect(charge.status).toBe('PAID');
        expect(allocated).toBe(charge.amount);
      } else {
        expect(charge.status).toBe('PENDING');
      }
    }
  });

  it('contains ZERO seeded payments leaving a charge partially settled', () => {
    const allocatedByCharge = new Map<string, number>();
    for (const payment of payments) {
      const paymentTotal = payment.allocations.reduce((sum, allocation) => sum + allocation.amount, 0);
      expect(paymentTotal).toBe(payment.amount);
      for (const allocation of payment.allocations) {
        allocatedByCharge.set(
          allocation.chargeSemanticKey,
          (allocatedByCharge.get(allocation.chargeSemanticKey) ?? 0) + allocation.amount,
        );
      }
    }

    for (const charge of charges) {
      const allocated = allocatedByCharge.get(charge.semanticKey) ?? 0;
      if (allocated > 0) {
        expect(allocated).toBe(charge.amount);
      }
    }
  });

  it('every seeded payment corresponds to a production-valid state', () => {
    for (const payment of payments) {
      expect(payment.status).toBe('RECONCILED');
      expect(payment.method).toBe('TRANSFER');
      expect(payment.allocations.length).toBeGreaterThan(0);
      expect(payment.receiptEvidence.receiptStatus).toBe('READY');
    }
  });

  it('every seeded payment settles its charges oldest-first (FIFO)', () => {
    const chargesByUnit = new Map<string, Array<{ charge: (typeof charges)[number]; index: number }>>();
    charges.forEach((charge, index) => {
      const list = chargesByUnit.get(charge.unitCode) ?? [];
      list.push({ charge, index });
      chargesByUnit.set(charge.unitCode, list);
    });

    const canonicalPosition = new Map<string, number>();
    for (const list of chargesByUnit.values()) {
      list.sort((a, b) => {
        const byDueDate = a.charge.dueDate.localeCompare(b.charge.dueDate);
        return byDueDate !== 0 ? byDueDate : a.index - b.index;
      });
      list.forEach((entry, position) => canonicalPosition.set(entry.charge.semanticKey, position));
    }

    for (const payment of payments) {
      const positions = payment.allocations
        .map((allocation) => {
          const position = canonicalPosition.get(allocation.chargeSemanticKey);
          expect(position).toBeDefined();
          return position as number;
        })
        .sort((a, b) => a - b);

      // The allocated charges must be the first N outstanding charges of the unit.
      positions.forEach((position, index) => {
        expect(position).toBe(index);
      });
    }
  });

  it('captures precise USD, VES, and COP currency scenarios and rates', () => {
    const multi = tenants.find((tenant) => tenant.key === 'tenant-03');
    expect(multi).toMatchObject({ currency: 'USD', functionalCurrency: 'USD' });
    expect(multi?.exchangeRates).toEqual([
      expect.objectContaining({ baseCurrency: 'VES', quoteCurrency: 'USD', rate: '0.025', effectiveAt: '2026-04-01' }),
      expect.objectContaining({ baseCurrency: 'COP', quoteCurrency: 'USD', rate: '0.00025', effectiveAt: '2026-04-01' }),
    ]);
    expect(multi?.charges.filter((charge) => charge.unitCode.startsWith('PAL-')).map((charge) => charge.currency)).toEqual(['USD', 'VES', 'COP']);
    const palmasPayments = multi?.payments.filter((payment) => payment.unitCode.startsWith('PAL-')) ?? [];
    expect(palmasPayments.map((payment) => payment.currency)).toEqual(['USD', 'VES', 'COP']);
    expect(palmasPayments.map((payment) => payment.functionalAmountMinor)).toEqual([10000, 10000, 10000]);
    expect(palmasPayments.map((payment) => payment.allocations[0]?.amount)).toEqual([10000, 400000, 40000000]);
    expect(palmasPayments.map((payment) => payment.allocations[0]?.paymentOriginalAmountMinor)).toEqual([10000, 400000, 40000000]);
    expect(multi?.adjustments.some((adjustment) => adjustment.currencyCode === 'VES' && adjustment.functionalCurrencyCode === 'USD')).toBe(true);
  });

  it('contains no remote target or non-local credential in its definitions', () => {
    const serialized = JSON.stringify(definition);
    expect(serialized).not.toMatch(/postgres(?:ql)?:\/\//i);
    expect(serialized).not.toMatch(/staging|production|prod/i);
    expect(new Set(users.map((user) => user.password))).toEqual(new Set([LOCAL_V2_PASSWORD]));
    expect(users.every((user) => user.email.endsWith('@buildingos.local'))).toBe(true);
  });
});

describe('LOCAL V2 seed compatibility checks', () => {
  it.each([
    ['label', 'Unexpected label'],
    ['unitType', 'CASA'],
  ])('rejects an existing unit with an incompatible %s', async (field, incompatibleValue) => {
    const client = createWriteClient({
      unit: (where) => where.code === 'AUTO-101' ? {
        id: 'unit-1',
        tenantId: 'tenant-1',
        buildingId: 'building-1',
        code: 'AUTO-101',
        label: 'Autogestionada Local — AUTO-101',
        unitType: 'APARTAMENTO',
        occupancyStatus: 'OCCUPIED',
        isBillable: true,
        [field]: incompatibleValue,
      } : null,
    });

    await expect(applyLocalV2Seed(client, connection, connectedLocalTarget, password)).rejects.toThrow(`incompatible at ${field}`);
  });

  it('rejects a different active occupant already assigned to an occupied unit', async () => {
    const client = createWriteClient({
      unitOccupant: (where) => where.unitId === 'unit-1' && where.endDate === null && !('memberId' in where) ? {
        id: 'existing-occupancy',
        tenantId: 'tenant-1',
        unitId: 'unit-1',
        memberId: 'different-member',
        role: 'RESIDENT',
        isPrimary: true,
        endDate: null,
      } : null,
    });

    await expect(applyLocalV2Seed(client, connection, connectedLocalTarget, password)).rejects.toThrow('different active occupant');
  });

  it('rejects an active occupant assigned to a unit declared vacant', async () => {
    const client = createWriteClient({
      unitOccupant: (where) => where.unitId === 'unit-6' && where.endDate === null && !('memberId' in where) ? {
        id: 'existing-vacancy-conflict',
        tenantId: 'tenant-1',
        unitId: 'unit-6',
        memberId: 'unexpected-member',
        role: 'RESIDENT',
        isPrimary: true,
        endDate: null,
      } : null,
    });

        await expect(applyLocalV2Seed(client, connection, connectedLocalTarget, password)).rejects.toThrow('declared vacant');
      });

      it('normalizes Decimal-like values for idempotent compatibility checks', () => {
        const decimal = { toFixed: () => '1.00', toString: () => '1' };
        expect(comparable(decimal)).toBe('1');
        expect(comparable('1')).toBe('1');
        expect(comparable(5)).toBe(5);
        expect(comparable(null)).toBe(null);
        expect(comparable(new Date('2026-04-01T00:00:00.000Z'))).toBe('2026-04-01T00:00:00.000Z');
      });
    });

    describe('LOCAL V2 payment audit invariants', () => {
      const auditRecordsFor = (client: ReturnType<typeof createWriteClient>) => client.createdRecords
        .filter((record) => record.name === 'paymentAuditLog')
        .map((record) => record.data);

      it('seeds the exact audit sequence required by the current payment contract', async () => {
        const client = createWriteClient();
        await applyLocalV2Seed(client, connection, connectedLocalTarget, password);

        const byPayment = new Map<string, string[]>();
        for (const audit of auditRecordsFor(client)) {
          const paymentId = String(audit.paymentId);
          const actions = byPayment.get(paymentId) ?? [];
          actions.push(String(audit.action));
          byPayment.set(paymentId, actions);
        }

        const reconciledCount = LOCAL_V2_SEED_DEFINITION.tenants
          .flatMap((tenant) => tenant.payments)
          .filter((payment) => payment.status === 'RECONCILED').length;

        expect(byPayment.size).toBe(12);
        expect(auditRecordsFor(client).length).toBe(12 * 3 + reconciledCount);

        for (const actions of byPayment.values()) {
          expect(actions[0]).toBe('SUBMITTED');
          expect(actions[1]).toBe('APPROVED');
          expect(actions[actions.length - 1]).toBe('RECEIPT_GENERATED');
          expect([3, 4]).toContain(actions.length);
          if (actions.length === 4) expect(actions[2]).toBe('RECONCILED');
        }
      });

      it('uses only the real PaymentAuditAction enum values', async () => {
        const client = createWriteClient();
        await applyLocalV2Seed(client, connection, connectedLocalTarget, password);
        const valid = new Set<string>(Object.values(PaymentAuditAction));
        const actions = auditRecordsFor(client).map((audit) => String(audit.action));
        expect(actions.length).toBeGreaterThan(0);
        expect(actions.every((action) => valid.has(action))).toBe(true);
      });

      it('gives every seeded payment a complete functional snapshot', async () => {
        const client = createWriteClient();
        await applyLocalV2Seed(client, connection, connectedLocalTarget, password);

        const payments = client.createdRecords
          .filter((record) => record.name === 'payment')
          .map((record) => record.data);

        expect(payments.length).toBe(12);
        for (const payment of payments) {
          expect(payment.functionalAmountMinor).toBeDefined();
          expect(payment.functionalCurrencyCode).toBeDefined();
          expect(payment.exchangeRateValue).toBeDefined();
          expect(payment.exchangeRateDirection).toBeDefined();
          expect(['IDENTITY', 'DIRECT', 'INVERSE']).toContain(payment.exchangeRateDirection);
        }
      });
    });
