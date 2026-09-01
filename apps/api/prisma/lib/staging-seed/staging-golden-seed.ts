import { Prisma } from '@prisma/client';

export const STAGING_GOLDEN_MARKER = 'STG-DATA-01:GOLDEN';
export const STAGING_GOLDEN_CONFIRMATION = 'STG-DATA-01';
export const STAGING_GOLDEN_PASSWORD_ENV = 'STAGING_GOLDEN_QA_PASSWORD';
export const STAGING_GOLDEN_TENANTS_ENV = 'STAGING_GOLDEN_TENANTS';

const STAGING_DATABASE = 'buildingos_staging_db';
const STAGING_DATABASE_HOST = 'postgres';
const SEED_DATE = '2026-04-01';

export interface StagingGoldenEnvironment {
  readonly [key: string]: string | undefined;
  readonly STAGING_GOLDEN_SEED?: string;
  readonly STAGING_GOLDEN_CONFIRMATION?: string;
  readonly APP_ENV?: string;
  readonly NODE_ENV?: string;
  readonly DATABASE_URL?: string;
}

export interface StagingGoldenTarget {
  readonly database: typeof STAGING_DATABASE;
  readonly host: typeof STAGING_DATABASE_HOST;
}

export interface ConnectionIdentity {
  readonly database: string;
  readonly address: string | null;
}

export interface StagingGoldenConnectionClient {
  readConnectionIdentity(): Promise<ConnectionIdentity>;
}

interface RecordValue {
  readonly id: string;
  readonly [key: string]: unknown;
}

interface RecordDelegate {
  findFirst(args: { readonly where: Readonly<Record<string, unknown>> }): Promise<RecordValue | null>;
  create(args: { readonly data: Readonly<Record<string, unknown>> }): Promise<RecordValue>;
  update(args: {
    readonly where: Readonly<Record<string, unknown>>;
    readonly data: Readonly<Record<string, unknown>>;
  }): Promise<RecordValue>;
}

export interface StagingGoldenWriteClient {
  readonly tenant: RecordDelegate;
  readonly billingPlan: RecordDelegate;
  readonly subscription: RecordDelegate;
  readonly building: RecordDelegate;
  readonly unit: RecordDelegate;
  readonly user: RecordDelegate;
  readonly membership: RecordDelegate;
  readonly membershipRole: RecordDelegate;
  readonly tenantMember: RecordDelegate;
  readonly unitOccupant: RecordDelegate;
  readonly exchangeRate: RecordDelegate;
  readonly charge: RecordDelegate;
  readonly payment: RecordDelegate;
  readonly paymentAllocation: RecordDelegate;
  readonly paymentAuditLog: RecordDelegate;
  readonly ticket: RecordDelegate;
  $transaction<T>(callback: (transaction: StagingGoldenWriteClient) => Promise<T>): Promise<T>;
}

type TenantTypeValue = 'ADMINISTRADORA' | 'EDIFICIO_AUTOGESTION';
type RoleValue = 'TENANT_OWNER' | 'TENANT_ADMIN' | 'OPERATOR' | 'RESIDENT';
type UnitOccupantRoleValue = 'OWNER' | 'RESIDENT';
type ChargeStatusValue = 'PENDING' | 'PAID';
type CurrencyCode = 'ARS' | 'USD' | 'VES' | 'COP';

interface UnitSpec {
  readonly id: string;
  readonly code: string;
  readonly occupancyStatus: 'OCCUPIED' | 'VACANT';
}

interface BuildingSpec {
  readonly id: string;
  readonly name: string;
  readonly alias: string;
  readonly units: readonly UnitSpec[];
}

interface UserSpec {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly roles: readonly RoleValue[];
  readonly memberRole: RoleValue;
  readonly occupantAssignments: readonly Readonly<{ unitCode: string; role: UnitOccupantRoleValue }>[];
}

interface ChargeSpec {
  readonly id: string;
  readonly unitCode: string;
  readonly period: string;
  readonly amount: number;
  readonly currency: CurrencyCode;
  readonly status: ChargeStatusValue;
}

interface PaymentAllocationSpec {
  readonly chargeId: string;
  readonly amount: number;
}

interface PaymentSpec {
  readonly id: string;
  readonly unitCode: string;
  readonly amount: number;
  readonly currency: CurrencyCode;
  readonly submittedByEmail: string;
  readonly allocations: readonly PaymentAllocationSpec[];
  readonly functionalAmountMinor: number;
  readonly exchangeRateValue: string;
  readonly exchangeRateDirection: 'IDENTITY' | 'DIRECT';
  readonly exchangeRateId?: string;
}

interface ExchangeRateSpec {
  readonly id: string;
  readonly baseCurrency: 'VES' | 'COP';
  readonly rate: string;
}

interface TicketSpec {
  readonly id: string;
  readonly buildingAlias: string;
  readonly unitCode: string;
  readonly createdByEmail: string;
  readonly assignedToEmail: string;
  readonly title: string;
  readonly status: 'OPEN' | 'IN_PROGRESS' | 'CLOSED';
}

interface TenantSpec {
  readonly id: string;
  readonly name: string;
  readonly type: TenantTypeValue;
  readonly currency: CurrencyCode;
  readonly functionalCurrency: CurrencyCode;
  readonly locale: string;
  readonly planId: 'FREE' | 'PRO';
  readonly buildings: readonly BuildingSpec[];
  readonly users: readonly UserSpec[];
  readonly exchangeRates: readonly ExchangeRateSpec[];
  readonly charges: readonly ChargeSpec[];
  readonly payments: readonly PaymentSpec[];
  readonly tickets: readonly TicketSpec[];
}

const marker = (value: string): string => `[${STAGING_GOLDEN_MARKER}:${value}]`;
const date = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

const tenantA: TenantSpec = {
  id: 'stg-golden-tenant-auto',
  name: 'STG QA - Autogestionada',
  type: 'EDIFICIO_AUTOGESTION',
  currency: 'ARS',
  functionalCurrency: 'ARS',
  locale: 'es-AR',
  planId: 'PRO',
  buildings: [{
    id: 'stg-golden-building-auto',
    name: 'STG QA Autogestionada - Principal',
    alias: 'A',
    units: [
      { id: 'stg-golden-unit-auto-101', code: 'A-101', occupancyStatus: 'OCCUPIED' },
      { id: 'stg-golden-unit-auto-102', code: 'A-102', occupancyStatus: 'OCCUPIED' },
      { id: 'stg-golden-unit-auto-103', code: 'A-103', occupancyStatus: 'OCCUPIED' },
      { id: 'stg-golden-unit-auto-104', code: 'A-104', occupancyStatus: 'VACANT' },
    ],
  }],
  users: [
    { id: 'stg-golden-user-auto-owner', name: 'STG QA Autogestionada Owner', email: 'owner.autogestionada@staging.buildingos.local', roles: ['TENANT_OWNER'], memberRole: 'TENANT_ADMIN', occupantAssignments: [{ unitCode: 'A-103', role: 'OWNER' }] },
    { id: 'stg-golden-user-auto-admin', name: 'STG QA Autogestionada Admin', email: 'admin.autogestionada@staging.buildingos.local', roles: ['TENANT_ADMIN'], memberRole: 'TENANT_ADMIN', occupantAssignments: [] },
    { id: 'stg-golden-user-auto-resident-1', name: 'STG QA Autogestionada Resident 1', email: 'resident.auto.1@staging.buildingos.local', roles: ['RESIDENT'], memberRole: 'RESIDENT', occupantAssignments: [{ unitCode: 'A-101', role: 'RESIDENT' }] },
    { id: 'stg-golden-user-auto-resident-2', name: 'STG QA Autogestionada Resident 2', email: 'resident.auto.2@staging.buildingos.local', roles: ['RESIDENT'], memberRole: 'RESIDENT', occupantAssignments: [{ unitCode: 'A-102', role: 'RESIDENT' }] },
  ],
  exchangeRates: [],
  charges: [
    { id: 'stg-golden-charge-auto-101', unitCode: 'A-101', period: '2026-04', amount: 10000, currency: 'ARS', status: 'PAID' },
    { id: 'stg-golden-charge-auto-102', unitCode: 'A-102', period: '2026-04', amount: 12000, currency: 'ARS', status: 'PENDING' },
  ],
  payments: [{
    id: 'stg-golden-payment-auto-101', unitCode: 'A-101', amount: 10000, currency: 'ARS', submittedByEmail: 'resident.auto.1@staging.buildingos.local',
    allocations: [{ chargeId: 'stg-golden-charge-auto-101', amount: 10000 }], functionalAmountMinor: 10000, exchangeRateValue: '1', exchangeRateDirection: 'IDENTITY',
  }],
  tickets: [{ id: 'stg-golden-ticket-auto-open', buildingAlias: 'A', unitCode: 'A-102', createdByEmail: 'resident.auto.2@staging.buildingos.local', assignedToEmail: 'admin.autogestionada@staging.buildingos.local', title: 'Revisión de saldo pendiente', status: 'OPEN' }],
};

const tenantB: TenantSpec = {
  id: 'stg-golden-tenant-multi',
  name: 'STG QA - Administradora Multi',
  type: 'ADMINISTRADORA',
  currency: 'USD',
  functionalCurrency: 'USD',
  locale: 'en-US',
  planId: 'PRO',
  buildings: [
    { id: 'stg-golden-building-multi-1', name: 'STG QA Multi - Building 1', alias: 'B1', units: [{ id: 'stg-golden-unit-multi-101', code: 'B1-101', occupancyStatus: 'OCCUPIED' }, { id: 'stg-golden-unit-multi-102', code: 'B1-102', occupancyStatus: 'VACANT' }, { id: 'stg-golden-unit-multi-103', code: 'B1-103', occupancyStatus: 'OCCUPIED' }] },
    { id: 'stg-golden-building-multi-2', name: 'STG QA Multi - Building 2', alias: 'B2', units: [{ id: 'stg-golden-unit-multi-201', code: 'B2-201', occupancyStatus: 'OCCUPIED' }, { id: 'stg-golden-unit-multi-202', code: 'B2-202', occupancyStatus: 'VACANT' }, { id: 'stg-golden-unit-multi-203', code: 'B2-203', occupancyStatus: 'OCCUPIED' }] },
    { id: 'stg-golden-building-multi-3', name: 'STG QA Multi - Building 3', alias: 'B3', units: [{ id: 'stg-golden-unit-multi-301', code: 'B3-301', occupancyStatus: 'OCCUPIED' }, { id: 'stg-golden-unit-multi-302', code: 'B3-302', occupancyStatus: 'OCCUPIED' }, { id: 'stg-golden-unit-multi-303', code: 'B3-303', occupancyStatus: 'OCCUPIED' }] },
  ],
  users: [
    { id: 'stg-golden-user-multi-owner', name: 'STG QA Multi Owner', email: 'owner.multi@staging.buildingos.local', roles: ['TENANT_OWNER'], memberRole: 'TENANT_ADMIN', occupantAssignments: [] },
    { id: 'stg-golden-user-multi-admin', name: 'STG QA Multi Admin', email: 'admin.multi@staging.buildingos.local', roles: ['TENANT_ADMIN'], memberRole: 'TENANT_ADMIN', occupantAssignments: [] },
    { id: 'stg-golden-user-multi-operator', name: 'STG QA Multi Operator', email: 'operator.multi@staging.buildingos.local', roles: ['OPERATOR'], memberRole: 'OPERATOR', occupantAssignments: [] },
    { id: 'stg-golden-user-multi-resident-context', name: 'STG QA Multi Resident Context', email: 'resident.multi.context@staging.buildingos.local', roles: ['RESIDENT'], memberRole: 'RESIDENT', occupantAssignments: [{ unitCode: 'B1-101', role: 'RESIDENT' }, { unitCode: 'B2-201', role: 'RESIDENT' }] },
    { id: 'stg-golden-user-multi-resident-currency', name: 'STG QA Multi Currency Resident', email: 'resident.multi.currency@staging.buildingos.local', roles: ['RESIDENT'], memberRole: 'RESIDENT', occupantAssignments: [{ unitCode: 'B1-103', role: 'RESIDENT' }, { unitCode: 'B3-301', role: 'RESIDENT' }, { unitCode: 'B3-302', role: 'RESIDENT' }, { unitCode: 'B3-303', role: 'RESIDENT' }] },
  ],
  exchangeRates: [
    { id: 'stg-golden-rate-ves-usd', baseCurrency: 'VES', rate: '0.025' },
    { id: 'stg-golden-rate-cop-usd', baseCurrency: 'COP', rate: '0.00025' },
  ],
  charges: [
    { id: 'stg-golden-charge-multi-b1-101', unitCode: 'B1-101', period: '2026-04', amount: 10000, currency: 'USD', status: 'PAID' },
    { id: 'stg-golden-charge-multi-b2-201-old', unitCode: 'B2-201', period: '2026-02', amount: 6000, currency: 'USD', status: 'PAID' },
    { id: 'stg-golden-charge-multi-b2-201-new', unitCode: 'B2-201', period: '2026-03', amount: 7000, currency: 'USD', status: 'PAID' },
    { id: 'stg-golden-charge-multi-b3-301', unitCode: 'B3-301', period: '2026-04', amount: 10000, currency: 'USD', status: 'PAID' },
    { id: 'stg-golden-charge-multi-b3-302', unitCode: 'B3-302', period: '2026-04', amount: 400000, currency: 'VES', status: 'PAID' },
    { id: 'stg-golden-charge-multi-b3-303', unitCode: 'B3-303', period: '2026-04', amount: 40000000, currency: 'COP', status: 'PAID' },
  ],
  payments: [
    { id: 'stg-golden-payment-multi-b1', unitCode: 'B1-101', amount: 10000, currency: 'USD', submittedByEmail: 'resident.multi.context@staging.buildingos.local', allocations: [{ chargeId: 'stg-golden-charge-multi-b1-101', amount: 10000 }], functionalAmountMinor: 10000, exchangeRateValue: '1', exchangeRateDirection: 'IDENTITY' },
    { id: 'stg-golden-payment-multi-b2-fifo', unitCode: 'B2-201', amount: 13000, currency: 'USD', submittedByEmail: 'resident.multi.context@staging.buildingos.local', allocations: [{ chargeId: 'stg-golden-charge-multi-b2-201-old', amount: 6000 }, { chargeId: 'stg-golden-charge-multi-b2-201-new', amount: 7000 }], functionalAmountMinor: 13000, exchangeRateValue: '1', exchangeRateDirection: 'IDENTITY' },
    { id: 'stg-golden-payment-multi-b3-usd', unitCode: 'B3-301', amount: 10000, currency: 'USD', submittedByEmail: 'resident.multi.currency@staging.buildingos.local', allocations: [{ chargeId: 'stg-golden-charge-multi-b3-301', amount: 10000 }], functionalAmountMinor: 10000, exchangeRateValue: '1', exchangeRateDirection: 'IDENTITY' },
    { id: 'stg-golden-payment-multi-b3-ves', unitCode: 'B3-302', amount: 400000, currency: 'VES', submittedByEmail: 'resident.multi.currency@staging.buildingos.local', allocations: [{ chargeId: 'stg-golden-charge-multi-b3-302', amount: 400000 }], functionalAmountMinor: 10000, exchangeRateValue: '0.025', exchangeRateDirection: 'DIRECT', exchangeRateId: 'stg-golden-rate-ves-usd' },
    { id: 'stg-golden-payment-multi-b3-cop', unitCode: 'B3-303', amount: 40000000, currency: 'COP', submittedByEmail: 'resident.multi.currency@staging.buildingos.local', allocations: [{ chargeId: 'stg-golden-charge-multi-b3-303', amount: 40000000 }], functionalAmountMinor: 10000, exchangeRateValue: '0.00025', exchangeRateDirection: 'DIRECT', exchangeRateId: 'stg-golden-rate-cop-usd' },
  ],
  tickets: [{ id: 'stg-golden-ticket-multi-closed', buildingAlias: 'B1', unitCode: 'B1-103', createdByEmail: 'resident.multi.currency@staging.buildingos.local', assignedToEmail: 'operator.multi@staging.buildingos.local', title: 'Mantenimiento completado', status: 'CLOSED' }],
};

const tenantC: TenantSpec = {
  id: 'stg-golden-tenant-edge',
  name: 'STG QA - Edge Cases',
  type: 'EDIFICIO_AUTOGESTION',
  currency: 'ARS',
  functionalCurrency: 'ARS',
  locale: 'es-AR',
  planId: 'PRO',
  buildings: [{
    id: 'stg-golden-building-edge',
    name: 'STG QA Edge Cases - Principal',
    alias: 'C',
    units: [
      { id: 'stg-golden-unit-edge-101', code: 'C-101', occupancyStatus: 'OCCUPIED' },
      { id: 'stg-golden-unit-edge-102', code: 'C-102', occupancyStatus: 'OCCUPIED' },
      { id: 'stg-golden-unit-edge-103', code: 'C-103', occupancyStatus: 'OCCUPIED' },
      { id: 'stg-golden-unit-edge-104', code: 'C-104', occupancyStatus: 'OCCUPIED' },
      { id: 'stg-golden-unit-edge-105', code: 'C-105', occupancyStatus: 'VACANT' },
    ],
  }],
  users: [
    { id: 'stg-golden-user-edge-owner', name: 'STG QA Edge Owner', email: 'owner.edge@staging.buildingos.local', roles: ['TENANT_OWNER'], memberRole: 'TENANT_ADMIN', occupantAssignments: [] },
    { id: 'stg-golden-user-edge-admin-resident', name: 'STG QA Edge Admin Resident', email: 'admin.resident.edge@staging.buildingos.local', roles: ['TENANT_ADMIN', 'RESIDENT'], memberRole: 'TENANT_ADMIN', occupantAssignments: [{ unitCode: 'C-101', role: 'RESIDENT' }] },
    { id: 'stg-golden-user-edge-multi', name: 'STG QA Edge Multi Unit Resident', email: 'resident.multiunit.edge@staging.buildingos.local', roles: ['RESIDENT'], memberRole: 'RESIDENT', occupantAssignments: [{ unitCode: 'C-102', role: 'RESIDENT' }, { unitCode: 'C-104', role: 'RESIDENT' }] },
    { id: 'stg-golden-user-edge-delinquent', name: 'STG QA Edge Delinquent Resident', email: 'resident.delinquent.edge@staging.buildingos.local', roles: ['RESIDENT'], memberRole: 'RESIDENT', occupantAssignments: [{ unitCode: 'C-103', role: 'RESIDENT' }] },
  ],
  exchangeRates: [],
  charges: [
    { id: 'stg-golden-charge-edge-101', unitCode: 'C-101', period: '2026-04', amount: 5000, currency: 'ARS', status: 'PAID' },
    { id: 'stg-golden-charge-edge-103', unitCode: 'C-103', period: '2025-12', amount: 15000, currency: 'ARS', status: 'PENDING' },
  ],
  payments: [{ id: 'stg-golden-payment-edge-zero', unitCode: 'C-101', amount: 5000, currency: 'ARS', submittedByEmail: 'admin.resident.edge@staging.buildingos.local', allocations: [{ chargeId: 'stg-golden-charge-edge-101', amount: 5000 }], functionalAmountMinor: 5000, exchangeRateValue: '1', exchangeRateDirection: 'IDENTITY' }],
  tickets: [
    { id: 'stg-golden-ticket-edge-open', buildingAlias: 'C', unitCode: 'C-103', createdByEmail: 'resident.delinquent.edge@staging.buildingos.local', assignedToEmail: 'owner.edge@staging.buildingos.local', title: 'Saldo vencido requiere atención', status: 'OPEN' },
    { id: 'stg-golden-ticket-edge-progress', buildingAlias: 'C', unitCode: 'C-102', createdByEmail: 'resident.multiunit.edge@staging.buildingos.local', assignedToEmail: 'owner.edge@staging.buildingos.local', title: 'Seguimiento de mantenimiento', status: 'IN_PROGRESS' },
  ],
};

export const STAGING_GOLDEN_DATASET: readonly TenantSpec[] = [tenantA, tenantB, tenantC];

const STAGING_GOLDEN_ACCEPTANCE_TENANTS = new Set([
  'stg-golden-tenant-auto',
  'stg-golden-tenant-multi',
]);

export function selectStagingGoldenDataset(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): readonly TenantSpec[] {
  const requested = environment[STAGING_GOLDEN_TENANTS_ENV]?.trim();
  if (!requested) return STAGING_GOLDEN_DATASET;

  const tenantIds = requested.split(',').map((value) => value.trim()).filter(Boolean);
  if (tenantIds.length === 0 || new Set(tenantIds).size !== tenantIds.length) {
    throw new Error(`${STAGING_GOLDEN_TENANTS_ENV} must contain unique tenant IDs`);
  }
  if (!tenantIds.every((tenantId) => STAGING_GOLDEN_ACCEPTANCE_TENANTS.has(tenantId))) {
    throw new Error(`${STAGING_GOLDEN_TENANTS_ENV} contains an unauthorized acceptance tenant`);
  }

  const selected = STAGING_GOLDEN_DATASET.filter((tenant) => tenantIds.includes(tenant.id));
  if (selected.length !== tenantIds.length) {
    throw new Error(`${STAGING_GOLDEN_TENANTS_ENV} contains an unknown Golden tenant`);
  }
  return selected;
}

function assertCompatible(existing: RecordValue, expected: Readonly<Record<string, unknown>>, label: string): void {
  const normalize = (value: unknown): unknown => {
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object') {
      const objectValue = value as { toFixed?: unknown; toString?: unknown };
      if (typeof objectValue.toFixed === 'function' && typeof objectValue.toString === 'function') return String(objectValue);
      return Object.keys(value as Record<string, unknown>).sort().reduce<Record<string, unknown>>((result, key) => {
        result[key] = normalize((value as Record<string, unknown>)[key]);
        return result;
      }, {});
    }
    return value;
  };

  for (const [field, value] of Object.entries(expected)) {
    if (JSON.stringify(normalize(existing[field])) !== JSON.stringify(normalize(value))) throw new Error(`Golden ${label} is incompatible at ${field}`);
  }
}

async function ensureRecord(delegate: RecordDelegate, id: string, data: Readonly<Record<string, unknown>>, label: string, mutable = true): Promise<RecordValue> {
  const where = { id, ...(data.tenantId ? { tenantId: data.tenantId } : {}) };
  const existing = await delegate.findFirst({ where });
  if (existing) {
    assertCompatible(existing, { tenantId: data.tenantId, ...(data.name ? { name: data.name } : {}) }, label);
    if (mutable) return delegate.update({ where: { id }, data });
    assertCompatible(existing, data, label);
    return existing;
  }
  try {
    return await delegate.create({ data: { id, ...data } });
  } catch (error: unknown) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
    const concurrentlyCreated = await delegate.findFirst({ where });
    if (!concurrentlyCreated) throw error;
    assertCompatible(concurrentlyCreated, data, label);
    return concurrentlyCreated;
  }
}

async function ensureUser(delegate: RecordDelegate, spec: UserSpec, passwordHash: string): Promise<RecordValue> {
  const data = { id: spec.id, email: spec.email, name: spec.name, passwordHash };
  const existing = await delegate.findFirst({ where: { email: spec.email } });
  if (existing) {
    assertCompatible(existing, { id: spec.id, email: spec.email, name: spec.name }, `user ${spec.email}`);
    return delegate.update({ where: { id: existing.id }, data: { name: spec.name, passwordHash } });
  }
  return delegate.create({ data });
}

function privateStagingAddress(address: string | null): boolean {
  if (!address) return false;
  const normalized = address.replace(/^\[|\]$/g, '').split('/')[0] ?? '';
  const parts = normalized.split('.');
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part))) return normalized.startsWith('fd') || normalized.startsWith('fc');
  const first = Number(parts[0] ?? Number.NaN);
  const second = Number(parts[1] ?? Number.NaN);
  return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}

export function assertSafeStagingGoldenEnvironment(environment: StagingGoldenEnvironment): StagingGoldenTarget {
  if (environment.STAGING_GOLDEN_SEED !== '1') throw new Error('STAGING_GOLDEN_SEED must be exactly 1');
  if (environment.STAGING_GOLDEN_CONFIRMATION !== STAGING_GOLDEN_CONFIRMATION) throw new Error(`STAGING_GOLDEN_CONFIRMATION must be exactly ${STAGING_GOLDEN_CONFIRMATION}`);
  if (environment.APP_ENV?.trim().toLowerCase() !== 'staging') throw new Error('STAGING GOLDEN seed requires APP_ENV=staging');
  const nodeEnv = environment.NODE_ENV?.trim().toLowerCase();
  if (nodeEnv !== 'staging') throw new Error('STAGING GOLDEN seed requires NODE_ENV=staging');
  const rawUrl = environment.DATABASE_URL?.trim();
  if (!rawUrl) throw new Error('DATABASE_URL is required');
  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch { throw new Error('DATABASE_URL must be a valid PostgreSQL URL'); }
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') throw new Error('STAGING GOLDEN seed requires PostgreSQL');
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, '')).split('/')[0] ?? '';
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (database !== STAGING_DATABASE || host !== STAGING_DATABASE_HOST) throw new Error('STAGING GOLDEN seed refuses a non-staging database target');
  if (/prod|production|local|development/i.test(`${host}/${database}`)) throw new Error('STAGING GOLDEN seed refuses production or local targets');
  return { database: STAGING_DATABASE, host: STAGING_DATABASE_HOST };
}

export async function assertConnectedStagingGoldenTarget(client: StagingGoldenConnectionClient, target: StagingGoldenTarget): Promise<ConnectionIdentity> {
  const identity = await client.readConnectionIdentity();
  if (identity.database !== target.database) throw new Error(`STAGING GOLDEN seed connected to ${identity.database}, expected ${target.database}`);
  if (!privateStagingAddress(identity.address)) throw new Error(`STAGING GOLDEN seed refuses non-private PostgreSQL server address: ${identity.address ?? 'null'}`);
  return identity;
}

function findUnit(tenant: TenantSpec, code: string): UnitSpec {
  const unit = tenant.buildings.flatMap((building) => building.units).find((candidate) => candidate.code === code);
  if (!unit) throw new Error(`Golden unit not found: ${tenant.name}/${code}`);
  return unit;
}

function findBuilding(tenant: TenantSpec, alias: string): BuildingSpec {
  const building = tenant.buildings.find((candidate) => candidate.alias === alias);
  if (!building) throw new Error(`Golden building not found: ${tenant.name}/${alias}`);
  return building;
}

export async function applyStagingGoldenSeed(
  database: StagingGoldenWriteClient,
  passwordHash: string,
  dataset: readonly TenantSpec[] = STAGING_GOLDEN_DATASET,
): Promise<void> {
  await database.$transaction(async (tx) => {
    const plans = new Map<string, RecordValue>();
    for (const planId of ['FREE', 'PRO'] as const) {
      const plan = await tx.billingPlan.findFirst({ where: { planId } });
      if (!plan) throw new Error(`Required billing plan is missing: ${planId}`);
      plans.set(planId, plan);
    }

    for (const tenantSpec of dataset) {
      const existingById = await tx.tenant.findFirst({ where: { id: tenantSpec.id } });
      const existingByName = await tx.tenant.findFirst({ where: { name: tenantSpec.name } });
      const tenant = existingById ?? existingByName;
      const tenantData = { name: tenantSpec.name, type: tenantSpec.type, brandName: STAGING_GOLDEN_MARKER, currency: tenantSpec.currency, functionalCurrency: tenantSpec.functionalCurrency, locale: tenantSpec.locale, isDemo: false };
      let tenantRecord: RecordValue;
      if (tenant) {
        assertCompatible(tenant, { name: tenantSpec.name, type: tenantSpec.type, brandName: STAGING_GOLDEN_MARKER, currency: tenantSpec.currency, functionalCurrency: tenantSpec.functionalCurrency, isDemo: false }, `tenant ${tenantSpec.name}`);
        tenantRecord = tenant;
      } else {
        try {
          tenantRecord = await tx.tenant.create({ data: { id: tenantSpec.id, ...tenantData } });
        } catch (error: unknown) {
          if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
          const concurrentlyCreated = await tx.tenant.findFirst({ where: { name: tenantSpec.name } });
          if (!concurrentlyCreated) throw error;
          assertCompatible(concurrentlyCreated, { name: tenantSpec.name, type: tenantSpec.type, brandName: STAGING_GOLDEN_MARKER, currency: tenantSpec.currency, functionalCurrency: tenantSpec.functionalCurrency, isDemo: false }, `tenant ${tenantSpec.name}`);
          tenantRecord = concurrentlyCreated;
        }
      }
      const tenantId = tenantRecord.id;
      const plan = plans.get(tenantSpec.planId);
      if (!plan) throw new Error(`Golden plan lookup failed: ${tenantSpec.planId}`);
      await ensureRecord(tx.subscription, `stg-golden-subscription-${tenantSpec.id}`, { tenantId, planId: plan.id, status: 'ACTIVE', currentPeriodStart: date(SEED_DATE) }, `subscription ${tenantSpec.name}`, false);

      const buildings = new Map<string, RecordValue>();
      const units = new Map<string, RecordValue>();
      for (const buildingSpec of tenantSpec.buildings) {
        const building = await ensureRecord(tx.building, buildingSpec.id, { tenantId, name: buildingSpec.name, alias: buildingSpec.alias, address: marker(`${tenantSpec.id}:address`), deletedAt: null }, `building ${buildingSpec.name}`, false);
        buildings.set(buildingSpec.alias, building);
        for (const unitSpec of buildingSpec.units) {
          const unit = await ensureRecord(tx.unit, unitSpec.id, { tenantId, buildingId: building.id, code: unitSpec.code, label: `${buildingSpec.name} - ${unitSpec.code}`, unitType: 'APARTAMENTO', occupancyStatus: unitSpec.occupancyStatus, isBillable: true }, `unit ${unitSpec.code}`, false);
          if (unitSpec.occupancyStatus === 'VACANT') {
            const activeOccupant = await tx.unitOccupant.findFirst({ where: { tenantId, unitId: unit.id, endDate: null } });
            if (activeOccupant) throw new Error(`Golden unit ${unitSpec.code} is vacant but has an active occupant`);
          }
          units.set(unitSpec.code, unit);
        }
      }

      const memberships = new Map<string, RecordValue>();
      const members = new Map<string, RecordValue>();
      const users = new Map<string, RecordValue>();
      for (const userSpec of tenantSpec.users) {
        const user = await ensureUser(tx.user, userSpec, passwordHash);
        users.set(userSpec.email, user);
        const membership = await ensureRecord(tx.membership, `stg-golden-membership-${tenantSpec.id}-${userSpec.id}`, { tenantId, userId: user.id }, `membership ${userSpec.email}`, false);
        memberships.set(userSpec.email, membership);
        for (const role of userSpec.roles) {
          await ensureRecord(tx.membershipRole, `stg-golden-role-${tenantSpec.id}-${userSpec.id}-${role}`, { tenantId, membershipId: membership.id, role, scopeType: 'TENANT', scopeBuildingId: null, scopeUnitId: null }, `role ${userSpec.email}:${role}`, false);
        }
        const member = await ensureRecord(tx.tenantMember, `stg-golden-member-${tenantSpec.id}-${userSpec.id}`, { tenantId, userId: user.id, name: userSpec.name, email: userSpec.email, role: userSpec.memberRole, status: 'ACTIVE', disabledAt: null }, `member ${userSpec.email}`, false);
        members.set(userSpec.email, member);
        for (const assignment of userSpec.occupantAssignments) {
          const unit = units.get(assignment.unitCode);
          if (!unit) throw new Error(`Golden occupant unit not found: ${assignment.unitCode}`);
          const activeOccupant = await tx.unitOccupant.findFirst({ where: { tenantId, unitId: unit.id, endDate: null } });
          if (activeOccupant && activeOccupant.memberId !== member.id) throw new Error(`Golden unit ${assignment.unitCode} has a different active occupant`);
          await ensureRecord(tx.unitOccupant, `stg-golden-occupant-${tenantSpec.id}-${userSpec.id}-${assignment.unitCode}`, { tenantId, unitId: unit.id, memberId: member.id, role: assignment.role, isPrimary: true, startDate: date(SEED_DATE), endDate: null }, `occupancy ${userSpec.email}:${assignment.unitCode}`, false);
        }
      }

      const rates = new Map<string, RecordValue>();
      for (const rateSpec of tenantSpec.exchangeRates) {
        const admin = memberships.get(tenantSpec.users.find((user) => user.roles.includes('TENANT_ADMIN'))?.email ?? '');
        if (!admin) throw new Error(`Golden exchange-rate creator missing for ${tenantSpec.name}`);
        const rate = await ensureRecord(tx.exchangeRate, rateSpec.id, { tenantId, baseCurrency: rateSpec.baseCurrency, quoteCurrency: 'USD', rate: new Prisma.Decimal(rateSpec.rate), effectiveAt: date(SEED_DATE), source: marker(`${rateSpec.baseCurrency}:USD`), createdByMembershipId: admin.id }, `exchange rate ${rateSpec.id}`, false);
        rates.set(rateSpec.id, rate);
      }

      const charges = new Map<string, RecordValue>();
      for (const chargeSpec of tenantSpec.charges) {
        const unit = findUnit(tenantSpec, chargeSpec.unitCode);
        const buildingSpec = tenantSpec.buildings.find((candidate) => candidate.units.some((candidateUnit) => candidateUnit.code === unit.code));
        if (!buildingSpec) throw new Error(`Golden charge building missing: ${chargeSpec.id}`);
        const adminEmail = tenantSpec.users.find((user) => user.roles.includes('TENANT_ADMIN'))?.email ?? tenantSpec.users[0]?.email;
        const adminMembership = memberships.get(adminEmail ?? '');
        if (!adminMembership) throw new Error(`Golden charge creator missing: ${chargeSpec.id}`);
        const charge = await ensureRecord(tx.charge, chargeSpec.id, { tenantId, buildingId: buildings.get(buildingSpec.alias)?.id, unitId: units.get(unit.code)?.id, period: chargeSpec.period, type: 'COMMON_EXPENSE', concept: marker(`charge:${chargeSpec.id}`), amount: chargeSpec.amount, currency: chargeSpec.currency, dueDate: date(`${chargeSpec.period}-10`), status: chargeSpec.status, createdByMembershipId: adminMembership.id, liquidationId: null }, `charge ${chargeSpec.id}`, false);
        charges.set(chargeSpec.id, charge);
      }

      for (const paymentSpec of tenantSpec.payments) {
        const unit = units.get(paymentSpec.unitCode);
        const buildingSpec = tenantSpec.buildings.find((candidate) => candidate.units.some((candidateUnit) => candidateUnit.code === paymentSpec.unitCode));
        const submitter = users.get(paymentSpec.submittedByEmail);
        const reviewerEmail = tenantSpec.users.find((user) => user.roles.includes('TENANT_ADMIN'))?.email ?? tenantSpec.users[0]?.email;
        const reviewer = memberships.get(reviewerEmail ?? '');
        const approver = users.get(reviewerEmail ?? '');
        if (!unit || !buildingSpec || !submitter || !reviewer || !approver) throw new Error(`Golden payment references missing records: ${paymentSpec.id}`);
        const rate = paymentSpec.exchangeRateId ? rates.get(paymentSpec.exchangeRateId) : undefined;
        const payment = await ensureRecord(tx.payment, paymentSpec.id, {
          tenantId, buildingId: buildings.get(buildingSpec.alias)?.id, unitId: unit.id, amount: paymentSpec.amount, currency: paymentSpec.currency, method: 'TRANSFER', status: 'RECONCILED', paidAt: date('2026-04-05'), reference: marker(`payment:${paymentSpec.id}`), createdByUserId: submitter.id, reviewedByMembershipId: reviewer.id, reviewedAt: date('2026-04-05'), approvedByUserId: approver.id, approvedAt: date('2026-04-05'), receiptNumber: `STG-DATA-01-${paymentSpec.id}`, receiptStatus: 'READY', receiptGeneratedAt: date('2026-04-06'), functionalAmountMinor: paymentSpec.functionalAmountMinor, functionalCurrencyCode: tenantSpec.functionalCurrency, exchangeRateId: rate?.id ?? null, exchangeRateValue: new Prisma.Decimal(paymentSpec.exchangeRateValue), exchangeRateDirection: paymentSpec.exchangeRateDirection, exchangeRateEffectiveAt: rate ? date(SEED_DATE) : null, conversionDate: date('2026-04-05'),
        }, `payment ${paymentSpec.id}`, false);
        const allocationTotal = paymentSpec.allocations.reduce((sum, allocation) => sum + allocation.amount, 0);
        if (allocationTotal !== paymentSpec.amount) throw new Error(`Golden payment ${paymentSpec.id} does not allocate its full amount`);
        for (const allocationSpec of paymentSpec.allocations) {
          const charge = charges.get(allocationSpec.chargeId);
          if (!charge) throw new Error(`Golden allocation charge missing: ${allocationSpec.chargeId}`);
          await ensureRecord(tx.paymentAllocation, `stg-golden-allocation-${paymentSpec.id}-${allocationSpec.chargeId}`, { tenantId, paymentId: payment.id, chargeId: charge.id, amount: allocationSpec.amount, paymentOriginalAmountMinor: allocationSpec.amount }, `allocation ${paymentSpec.id}:${allocationSpec.chargeId}`, false);
        }
        const auditActions = ['SUBMITTED', 'APPROVED', 'RECONCILED', 'RECEIPT_GENERATED'] as const;
        for (const [index, action] of auditActions.entries()) {
          await ensureRecord(tx.paymentAuditLog, `stg-golden-audit-${paymentSpec.id}-${action.toLowerCase()}`, { tenantId, paymentId: payment.id, action, membershipId: action === 'APPROVED' ? reviewer.id : null, metadata: { marker: STAGING_GOLDEN_MARKER }, createdAt: new Date(date('2026-04-05').getTime() + index * 1000) }, `payment audit ${paymentSpec.id}:${action}`, false);
        }
      }

      for (const ticketSpec of tenantSpec.tickets) {
        const building = buildings.get(ticketSpec.buildingAlias);
        const unit = units.get(ticketSpec.unitCode);
        const creator = users.get(ticketSpec.createdByEmail);
        const assignee = memberships.get(ticketSpec.assignedToEmail);
        if (!building || !unit || !creator || !assignee) throw new Error(`Golden ticket references missing records: ${ticketSpec.id}`);
        await ensureRecord(tx.ticket, ticketSpec.id, { tenantId, buildingId: building.id, unitId: unit.id, createdByUserId: creator.id, assignedToMembershipId: assignee.id, title: marker(`ticket:${ticketSpec.id}`), description: 'Fictitious STG-DATA-01 acceptance ticket', category: 'MAINTENANCE', priority: ticketSpec.status === 'OPEN' ? 'HIGH' : 'LOW', status: ticketSpec.status, closedAt: ticketSpec.status === 'CLOSED' ? date('2026-04-07') : null }, `ticket ${ticketSpec.id}`, false);
      }
    }
  });
}
