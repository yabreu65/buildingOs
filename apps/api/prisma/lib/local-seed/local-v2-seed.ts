export const LOCAL_V2_PASSWORD = 'local-v2-only';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const ALLOWED_DATABASES = new Set(['buildingos_local_v2_test', 'buildingos']);
const ALLOWED_NODE_ENVS = new Set(['', 'development', 'test']);
const DANGEROUS_TARGET = /staging|prod|production/i;
const REPLACEMENT_CONFIRMATION = 'REPLACE buildingos WITH LOCAL_V2';
const SEED_DATE = '2026-04-01';

type TenantTypeValue = 'ADMINISTRADORA' | 'EDIFICIO_AUTOGESTION';
type RoleValue = 'SUPER_ADMIN' | 'TENANT_OWNER' | 'TENANT_ADMIN' | 'OPERATOR' | 'RESIDENT';
type ChargeStatusValue = 'PENDING' | 'PARTIAL' | 'PAID';
type PaymentStatusValue = 'APPROVED' | 'RECONCILED';
type PaymentAuditActionValue = 'SUBMITTED' | 'APPROVED' | 'RECONCILED' | 'RECEIPT_GENERATED';
type CurrencyCode = 'ARS' | 'USD' | 'VES' | 'COP';

export interface LocalV2Environment {
  readonly [key: string]: string | undefined;
  readonly LOCAL_V2_SEED?: string;
  readonly LOCAL_V2_REPLACE_CONFIRMATION?: string;
  readonly NODE_ENV?: string;
  readonly DATABASE_URL?: string;
}

export interface LocalV2Target {
  readonly database: 'buildingos_local_v2_test' | 'buildingos';
  readonly host: 'localhost' | '127.0.0.1' | '::1';
}

export interface ConnectionIdentity {
  readonly database: string;
  readonly address: string | null;
}

export interface LocalV2ConnectionClient {
  readConnectionIdentity(): Promise<ConnectionIdentity>;
}

interface UnitDefinition {
  readonly code: string;
  readonly occupancyStatus: 'OCCUPIED' | 'VACANT';
}

interface BuildingDefinition {
  readonly key: string;
  readonly name: string;
  readonly alias: string;
  readonly units: readonly UnitDefinition[];
}

interface UserDefinition {
  readonly name: string;
  readonly email: string;
  readonly password: typeof LOCAL_V2_PASSWORD;
  readonly roles: readonly RoleValue[];
  readonly createTenantMember: boolean;
  readonly tenantMemberRole?: RoleValue;
  readonly unitCodes: readonly string[];
}

interface ChargeDefinition {
  readonly semanticKey: string;
  readonly unitCode: string;
  readonly period: string;
  readonly concept: string;
  readonly amount: number;
  readonly currency: CurrencyCode;
  readonly status: ChargeStatusValue;
  readonly dueDate: string;
}

interface AllocationDefinition {
  readonly chargeSemanticKey: string;
  readonly amount: number;
  readonly paymentOriginalAmountMinor?: number;
}

interface PaymentDefinition {
  readonly semanticKey: string;
  readonly unitCode: string;
  readonly amount: number;
  readonly currency: CurrencyCode;
  readonly status: PaymentStatusValue;
  readonly method: 'TRANSFER';
  readonly paidAt: string;
  readonly reference: string;
  readonly submittedByEmail: string;
  readonly reviewedByEmail: string;
  readonly receiptEvidence: {
    readonly receiptNumber: string;
    readonly receiptStatus: 'READY';
    readonly receiptGeneratedAt: string;
  };
  readonly functionalAmountMinor?: number;
  readonly functionalCurrencyCode?: CurrencyCode;
  readonly exchangeRateSemanticKey?: string;
  readonly exchangeRateValue?: string;
  readonly exchangeRateDirection?: 'IDENTITY' | 'DIRECT';
  readonly allocations: readonly AllocationDefinition[];
}

interface ExchangeRateDefinition {
  readonly semanticKey: string;
  readonly baseCurrency: 'VES' | 'COP';
  readonly quoteCurrency: 'USD';
  readonly rate: string;
  readonly effectiveAt: typeof SEED_DATE;
  readonly source: string;
}

interface AdjustmentDefinition {
  readonly semanticKey: string;
  readonly buildingAlias: string;
  readonly sourceInvoiceDate: string;
  readonly sourcePeriod: string;
  readonly targetPeriod: string;
  readonly amountMinor: number;
  readonly currencyCode: CurrencyCode;
  readonly reason: string;
  readonly status: 'VALIDATED';
  readonly createdByEmail: string;
  readonly validatedByEmail: string;
  readonly functionalAmountMinor: number;
  readonly functionalCurrencyCode: CurrencyCode;
  readonly exchangeRateSemanticKey?: string;
  readonly exchangeRateValue: string;
  readonly exchangeRateDirection: 'IDENTITY' | 'DIRECT';
}

interface TicketDefinition {
  readonly semanticKey: string;
  readonly buildingAlias: string;
  readonly unitCode?: string;
  readonly createdByEmail: string;
  readonly assignedToEmail?: string;
  readonly title: string;
  readonly description: string;
  readonly category: 'MAINTENANCE' | 'BILLING' | 'OTHER';
  readonly priority: 'LOW' | 'MEDIUM' | 'HIGH';
  readonly status: 'OPEN' | 'CLOSED';
  readonly closedAt?: string;
}

interface CommunicationDefinition {
  readonly semanticKey: string;
  readonly buildingAlias?: string;
  readonly title: string;
  readonly body: string;
  readonly channel: 'IN_APP';
  readonly status: 'SENT';
  readonly createdByEmail: string;
  readonly sentAt: string;
  readonly recipientEmails: readonly string[];
}

interface TenantDefinition {
  readonly key: string;
  readonly type: TenantTypeValue;
  readonly name: string;
  readonly currency: CurrencyCode;
  readonly functionalCurrency: CurrencyCode;
  readonly buildings: readonly BuildingDefinition[];
  readonly users: readonly UserDefinition[];
  readonly charges: readonly ChargeDefinition[];
  readonly payments: readonly PaymentDefinition[];
  readonly exchangeRates: readonly ExchangeRateDefinition[];
  readonly adjustments: readonly AdjustmentDefinition[];
  readonly tickets: readonly TicketDefinition[];
  readonly communications: readonly CommunicationDefinition[];
}

const user = (
  emailLocalPart: string,
  name: string,
  roles: readonly RoleValue[],
  unitCodes: readonly string[] = [],
  createTenantMember = true,
  tenantMemberRole: RoleValue | undefined = roles[0],
): UserDefinition => ({
  name,
  email: `${emailLocalPart}@buildingos.local`,
  password: LOCAL_V2_PASSWORD,
  roles,
  createTenantMember,
  tenantMemberRole,
  unitCodes,
});

const unit = (code: string, occupancyStatus: UnitDefinition['occupancyStatus']): UnitDefinition => ({ code, occupancyStatus });
const key = (value: string): string => `local-v2:${value}`;
const marker = (semanticKey: string, text: string): string => `[${semanticKey}] ${text}`;

const tenant01Charges: readonly ChargeDefinition[] = ['AUTO-101', 'AUTO-102', 'AUTO-103', 'AUTO-104', 'AUTO-105'].map((unitCode, index) => {
  const semanticKey = key(`t01:charge:${unitCode.toLowerCase()}`);
  return {
    semanticKey,
    unitCode,
    period: '2026-04',
    concept: marker(semanticKey, 'Expensas comunes abril 2026'),
    amount: 10000 + index * 1000,
    currency: 'ARS',
    status: index < 2 ? 'PAID' : 'PENDING',
    dueDate: '2026-04-10',
  };
});

const tenant01Payments: readonly PaymentDefinition[] = ['AUTO-101', 'AUTO-102'].map((unitCode, index) => {
  const semanticKey = key(`t01:payment:${unitCode.toLowerCase()}`);
  return {
    semanticKey,
    unitCode,
    amount: 10000 + index * 1000,
    currency: 'ARS',
    status: 'RECONCILED',
    method: 'TRANSFER',
    paidAt: `2026-04-0${5 + index}`,
    reference: marker(semanticKey, `transfer-${unitCode}`),
    submittedByEmail: `resident.auto10${index + 1}@buildingos.local`,
    reviewedByEmail: 'admin.autogestionada@buildingos.local',
    receiptEvidence: {
      receiptNumber: `LOCAL-V2-T01-000${index + 1}`,
      receiptStatus: 'READY',
      receiptGeneratedAt: `2026-04-0${6 + index}`,
    },
    allocations: [{ chargeSemanticKey: key(`t01:charge:${unitCode.toLowerCase()}`), amount: 10000 + index * 1000 }],
  };
});

const tenant03Charges: readonly ChargeDefinition[] = [
  ['rob101', 'ROB-101', 10000, 'USD', 'PAID'],
  ['rob102', 'ROB-102', 12000, 'USD', 'PENDING'],
  ['rob103', 'ROB-103', 13000, 'USD', 'PENDING'],
  ['par101-common', 'PAR-101', 6000, 'USD', 'PAID'],
  ['par101-extra', 'PAR-101', 4000, 'USD', 'PAID'],
  ['par102-common', 'PAR-102', 7000, 'USD', 'PENDING'],
  ['par102-extra', 'PAR-102', 3000, 'USD', 'PENDING'],
  ['par103', 'PAR-103', 9000, 'USD', 'PAID'],
  ['par301', 'PAR-301', 8000, 'USD', 'PENDING'],
  ['pal101-usd', 'PAL-101', 10000, 'USD', 'PAID'],
  ['pal102-ves', 'PAL-102', 400000, 'VES', 'PAID'],
  ['pal103-cop', 'PAL-103', 40000000, 'COP', 'PAID'],
].map(([suffix, unitCode, amount, currency, status]) => {
  const semanticKey = key(`t03:charge:${suffix}`);
  return {
    semanticKey,
    unitCode: String(unitCode),
    period: '2026-04',
    concept: marker(semanticKey, 'Cuota administradora multi abril 2026'),
    amount: Number(amount),
    currency: currency as CurrencyCode,
    status: status as ChargeStatusValue,
    dueDate: '2026-04-10',
  };
});

const tenant03Payments: readonly PaymentDefinition[] = [
  {
    semanticKey: key('t03:payment:rob101'), unitCode: 'ROB-101', amount: 10000, currency: 'USD', status: 'RECONCILED', method: 'TRANSFER', paidAt: '2026-04-05',
    reference: marker(key('t03:payment:rob101'), 'ROB-101 paid'), submittedByEmail: 'resident.robles101@buildingos.local', reviewedByEmail: 'admin.multi@buildingos.local',
    receiptEvidence: { receiptNumber: 'LOCAL-V2-T03-0001', receiptStatus: 'READY', receiptGeneratedAt: '2026-04-06' },
    functionalAmountMinor: 10000, functionalCurrencyCode: 'USD', exchangeRateValue: '1', exchangeRateDirection: 'IDENTITY',
    allocations: [{ chargeSemanticKey: key('t03:charge:rob101'), amount: 10000 }],
  },
  {
    semanticKey: key('t03:payment:par101'), unitCode: 'PAR-101', amount: 10000, currency: 'USD', status: 'RECONCILED', method: 'TRANSFER', paidAt: '2026-04-06',
    reference: marker(key('t03:payment:par101'), 'PAR-101 split allocation'), submittedByEmail: 'resident.parque101@buildingos.local', reviewedByEmail: 'admin.multi@buildingos.local',
    receiptEvidence: { receiptNumber: 'LOCAL-V2-T03-0002', receiptStatus: 'READY', receiptGeneratedAt: '2026-04-07' },
    functionalAmountMinor: 10000, functionalCurrencyCode: 'USD', exchangeRateValue: '1', exchangeRateDirection: 'IDENTITY',
    allocations: [{ chargeSemanticKey: key('t03:charge:par101-common'), amount: 6000 }, { chargeSemanticKey: key('t03:charge:par101-extra'), amount: 4000 }],
  },
  {
    semanticKey: key('t03:payment:par103-full'), unitCode: 'PAR-103', amount: 9000, currency: 'USD', status: 'RECONCILED', method: 'TRANSFER', paidAt: '2026-04-07',
    reference: marker(key('t03:payment:par103-full'), 'PAR-103 full settlement'), submittedByEmail: 'resident.parque103@buildingos.local', reviewedByEmail: 'admin.multi@buildingos.local',
    receiptEvidence: { receiptNumber: 'LOCAL-V2-T03-0003', receiptStatus: 'READY', receiptGeneratedAt: '2026-04-08' },
    functionalAmountMinor: 9000, functionalCurrencyCode: 'USD', exchangeRateValue: '1', exchangeRateDirection: 'IDENTITY',
    allocations: [{ chargeSemanticKey: key('t03:charge:par103'), amount: 9000 }],
  },
  {
    semanticKey: key('t03:payment:pal101-usd'), unitCode: 'PAL-101', amount: 10000, currency: 'USD', status: 'RECONCILED', method: 'TRANSFER', paidAt: '2026-04-08',
    reference: marker(key('t03:payment:pal101-usd'), 'PAL-101 USD identity snapshot'), submittedByEmail: 'resident.palmas101@buildingos.local', reviewedByEmail: 'admin.multi@buildingos.local',
    receiptEvidence: { receiptNumber: 'LOCAL-V2-T03-0004', receiptStatus: 'READY', receiptGeneratedAt: '2026-04-09' },
    functionalAmountMinor: 10000, functionalCurrencyCode: 'USD', exchangeRateValue: '1', exchangeRateDirection: 'IDENTITY',
    allocations: [{ chargeSemanticKey: key('t03:charge:pal101-usd'), amount: 10000, paymentOriginalAmountMinor: 10000 }],
  },
  {
    semanticKey: key('t03:payment:pal102-ves'), unitCode: 'PAL-102', amount: 400000, currency: 'VES', status: 'RECONCILED', method: 'TRANSFER', paidAt: '2026-04-08',
    reference: marker(key('t03:payment:pal102-ves'), 'PAL-102 VES to USD'), submittedByEmail: 'resident.palmas102@buildingos.local', reviewedByEmail: 'admin.multi@buildingos.local',
    receiptEvidence: { receiptNumber: 'LOCAL-V2-T03-0005', receiptStatus: 'READY', receiptGeneratedAt: '2026-04-09' },
    functionalAmountMinor: 10000, functionalCurrencyCode: 'USD', exchangeRateSemanticKey: key('t03:rate:ves-usd'), exchangeRateValue: '0.025', exchangeRateDirection: 'DIRECT',
    allocations: [{ chargeSemanticKey: key('t03:charge:pal102-ves'), amount: 400000, paymentOriginalAmountMinor: 400000 }],
  },
  {
    semanticKey: key('t03:payment:pal103-cop'), unitCode: 'PAL-103', amount: 40000000, currency: 'COP', status: 'RECONCILED', method: 'TRANSFER', paidAt: '2026-04-08',
    reference: marker(key('t03:payment:pal103-cop'), 'PAL-103 COP to USD'), submittedByEmail: 'resident.palmas103@buildingos.local', reviewedByEmail: 'admin.multi@buildingos.local',
    receiptEvidence: { receiptNumber: 'LOCAL-V2-T03-0006', receiptStatus: 'READY', receiptGeneratedAt: '2026-04-09' },
    functionalAmountMinor: 10000, functionalCurrencyCode: 'USD', exchangeRateSemanticKey: key('t03:rate:cop-usd'), exchangeRateValue: '0.00025', exchangeRateDirection: 'DIRECT',
    allocations: [{ chargeSemanticKey: key('t03:charge:pal103-cop'), amount: 40000000, paymentOriginalAmountMinor: 40000000 }],
  },
];

const tenant04Charges: readonly ChargeDefinition[] = [
  ['qa101-paid', 'QA-101', 10000, 'PAID', '2026-04', '2026-04-10'],
  ['qa102-pending', 'QA-102', 8000, 'PENDING', '2026-04', '2026-04-10'],
  ['qa104-delinquent', 'QA-104', 15000, 'PENDING', '2025-12', '2025-12-10'],
  ['qa105-paid', 'QA-105', 10000, 'PAID', '2026-04', '2026-04-10'],
  ['qa106-zero-balance', 'QA-106', 5000, 'PAID', '2026-04', '2026-04-10'],
].map(([suffix, unitCode, amount, status, period, dueDate]) => {
  const semanticKey = key(`t04:charge:${suffix}`);
  return { semanticKey, unitCode: String(unitCode), period: String(period), concept: marker(semanticKey, 'QA finance scenario'), amount: Number(amount), currency: 'ARS', status: status as ChargeStatusValue, dueDate: String(dueDate) };
});

const tenant04Payments: readonly PaymentDefinition[] = [
  ['qa101', 'QA-101', 10000, 'admin-resident.qa@buildingos.local', key('t04:charge:qa101-paid')],
  ['qa105-paid', 'QA-105', 10000, 'resident.partial.qa@buildingos.local', key('t04:charge:qa105-paid')],
  ['qa106-zero-balance', 'QA-106', 5000, 'resident.multiunit.qa@buildingos.local', key('t04:charge:qa106-zero-balance')],
].map(([suffix, unitCode, amount, submittedByEmail, chargeSemanticKey], index) => {
  const semanticKey = key(`t04:payment:${suffix}`);
  return {
    semanticKey, unitCode: String(unitCode), amount: Number(amount), currency: 'ARS', status: 'RECONCILED', method: 'TRANSFER', paidAt: `2026-04-${10 + index}`,
    reference: marker(semanticKey, `QA payment ${unitCode}`), submittedByEmail: String(submittedByEmail), reviewedByEmail: 'owner.qa@buildingos.local',
    receiptEvidence: { receiptNumber: `LOCAL-V2-T04-000${index + 1}`, receiptStatus: 'READY', receiptGeneratedAt: `2026-04-${11 + index}` },
    allocations: [{ chargeSemanticKey: String(chargeSemanticKey), amount: Number(amount) }],
  } as PaymentDefinition;
});

export const LOCAL_V2_SEED_DEFINITION: { readonly tenants: readonly TenantDefinition[] } = {
  tenants: [
    {
      key: 'tenant-01', type: 'EDIFICIO_AUTOGESTION', name: 'LOCAL V2 — AUTOGESTIONADA LOCAL', currency: 'ARS', functionalCurrency: 'ARS',
      buildings: [{ key: 't01:auto', name: 'Autogestionada Local', alias: 'auto', units: [unit('AUTO-101', 'OCCUPIED'), unit('AUTO-102', 'OCCUPIED'), unit('AUTO-103', 'OCCUPIED'), unit('AUTO-104', 'OCCUPIED'), unit('AUTO-105', 'OCCUPIED'), unit('AUTO-106', 'VACANT')] }],
      users: [
        user('owner.autogestionada', 'Owner Autogestionada', ['TENANT_OWNER']),
        user('admin.autogestionada', 'Admin Autogestionada', ['TENANT_ADMIN']),
        ...[1, 2, 3, 4, 5].map((number) => user(`resident.auto10${number}`, `Resident AUTO-10${number}`, ['RESIDENT'], [`AUTO-10${number}`])),
      ],
      charges: tenant01Charges, payments: tenant01Payments, exchangeRates: [], adjustments: [],
      tickets: [{ semanticKey: key('t01:ticket:auto101-open'), buildingAlias: 'auto', unitCode: 'AUTO-101', createdByEmail: 'resident.auto101@buildingos.local', assignedToEmail: 'admin.autogestionada@buildingos.local', title: marker(key('t01:ticket:auto101-open'), 'Pérdida de agua'), description: 'Open local maintenance scenario', category: 'MAINTENANCE', priority: 'MEDIUM', status: 'OPEN' }],
      communications: [{ semanticKey: key('t01:communication:resident-notice'), buildingAlias: 'auto', title: marker(key('t01:communication:resident-notice'), 'Aviso a residentes'), body: 'Local in-app sent communication.', channel: 'IN_APP', status: 'SENT', createdByEmail: 'admin.autogestionada@buildingos.local', sentAt: '2026-04-02', recipientEmails: [1, 2, 3, 4, 5].map((number) => `resident.auto10${number}@buildingos.local`) }],
    },
    {
      key: 'tenant-02', type: 'ADMINISTRADORA', name: 'LOCAL V2 — ADMINISTRADORA PEQUEÑA', currency: 'ARS', functionalCurrency: 'ARS',
      buildings: [
        { key: 't02:norte', name: 'Building Norte', alias: 'norte', units: [unit('NOR-101', 'OCCUPIED'), unit('NOR-102', 'VACANT')] },
        { key: 't02:sur', name: 'Building Sur', alias: 'sur', units: [unit('SUR-101', 'OCCUPIED'), unit('SUR-102', 'VACANT')] },
      ],
      users: [user('owner.small', 'Owner Small', ['TENANT_OWNER']), user('admin.small', 'Admin Small', ['TENANT_ADMIN']), user('resident.norte', 'Resident Norte', ['RESIDENT'], ['NOR-101']), user('resident.sur', 'Resident Sur', ['RESIDENT'], ['SUR-101'])],
      charges: [
        { semanticKey: key('t02:charge:nor101'), unitCode: 'NOR-101', period: '2026-04', concept: marker(key('t02:charge:nor101'), 'Expensas Norte'), amount: 9000, currency: 'ARS', status: 'PAID', dueDate: '2026-04-10' },
        { semanticKey: key('t02:charge:sur101'), unitCode: 'SUR-101', period: '2026-04', concept: marker(key('t02:charge:sur101'), 'Expensas Sur'), amount: 9500, currency: 'ARS', status: 'PENDING', dueDate: '2026-04-10' },
      ],
      payments: [{ semanticKey: key('t02:payment:nor101'), unitCode: 'NOR-101', amount: 9000, currency: 'ARS', status: 'RECONCILED', method: 'TRANSFER', paidAt: '2026-04-05', reference: marker(key('t02:payment:nor101'), 'NOR-101 paid'), submittedByEmail: 'resident.norte@buildingos.local', reviewedByEmail: 'admin.small@buildingos.local', receiptEvidence: { receiptNumber: 'LOCAL-V2-T02-0001', receiptStatus: 'READY', receiptGeneratedAt: '2026-04-06' }, allocations: [{ chargeSemanticKey: key('t02:charge:nor101'), amount: 9000 }] }],
      exchangeRates: [], adjustments: [], tickets: [],
      communications: [{ semanticKey: key('t02:communication:small-notice'), title: marker(key('t02:communication:small-notice'), 'Aviso administradora pequeña'), body: 'Local small administrator notice.', channel: 'IN_APP', status: 'SENT', createdByEmail: 'admin.small@buildingos.local', sentAt: '2026-04-02', recipientEmails: ['resident.norte@buildingos.local', 'resident.sur@buildingos.local'] }],
    },
    {
      key: 'tenant-03', type: 'ADMINISTRADORA', name: 'LOCAL V2 — ADMINISTRADORA MULTI', currency: 'USD', functionalCurrency: 'USD',
      buildings: [
        { key: 't03:robles', name: 'Los Robles', alias: 'robles', units: [unit('ROB-101', 'OCCUPIED'), unit('ROB-102', 'OCCUPIED'), unit('ROB-103', 'OCCUPIED'), unit('ROB-104', 'VACANT')] },
        { key: 't03:parque', name: 'El Parque', alias: 'parque', units: [unit('PAR-101', 'OCCUPIED'), unit('PAR-102', 'OCCUPIED'), unit('PAR-103', 'OCCUPIED'), unit('PAR-301', 'OCCUPIED')] },
        { key: 't03:palmas', name: 'Las Palmas', alias: 'palmas', units: [unit('PAL-101', 'OCCUPIED'), unit('PAL-102', 'OCCUPIED'), unit('PAL-103', 'OCCUPIED')] },
      ],
      users: [
        user('superadmin.local', 'Super Admin Local', ['SUPER_ADMIN'], [], false, undefined), user('owner.multi', 'Owner Multi', ['TENANT_OWNER']), user('admin.multi', 'Admin Multi', ['TENANT_ADMIN']), user('operator.multi', 'Operator Multi', ['OPERATOR']),
        user('resident.robles101', 'Resident ROB-101', ['RESIDENT'], ['ROB-101']), user('resident.robles103', 'Resident ROB-103', ['RESIDENT'], ['ROB-103']), user('resident.multi', 'Resident Multi Property', ['RESIDENT'], ['ROB-102', 'PAR-301']),
        user('resident.parque101', 'Resident PAR-101', ['RESIDENT'], ['PAR-101']), user('resident.parque102', 'Resident PAR-102', ['RESIDENT'], ['PAR-102']), user('resident.parque103', 'Resident PAR-103', ['RESIDENT'], ['PAR-103']),
        user('resident.palmas101', 'Resident PAL-101', ['RESIDENT'], ['PAL-101']), user('resident.palmas102', 'Resident PAL-102', ['RESIDENT'], ['PAL-102']), user('resident.palmas103', 'Resident PAL-103', ['RESIDENT'], ['PAL-103']),
      ],
      charges: tenant03Charges, payments: tenant03Payments,
      exchangeRates: [
        { semanticKey: key('t03:rate:ves-usd'), baseCurrency: 'VES', quoteCurrency: 'USD', rate: '0.025', effectiveAt: SEED_DATE, source: marker(key('t03:rate:ves-usd'), 'local historical rate') },
        { semanticKey: key('t03:rate:cop-usd'), baseCurrency: 'COP', quoteCurrency: 'USD', rate: '0.00025', effectiveAt: SEED_DATE, source: marker(key('t03:rate:cop-usd'), 'local historical rate') },
      ],
      adjustments: [
        { semanticKey: key('t03:adjustment:parque-history'), buildingAlias: 'parque', sourceInvoiceDate: '2026-03-15', sourcePeriod: '2026-03', targetPeriod: '2026-04', amountMinor: 2500, currencyCode: 'USD', reason: marker(key('t03:adjustment:parque-history'), 'Historical Parque adjustment'), status: 'VALIDATED', createdByEmail: 'admin.multi@buildingos.local', validatedByEmail: 'owner.multi@buildingos.local', functionalAmountMinor: 2500, functionalCurrencyCode: 'USD', exchangeRateValue: '1', exchangeRateDirection: 'IDENTITY' },
        { semanticKey: key('t03:adjustment:palmas-ves'), buildingAlias: 'palmas', sourceInvoiceDate: '2026-04-01', sourcePeriod: '2026-04', targetPeriod: '2026-05', amountMinor: 200000, currencyCode: 'VES', reason: marker(key('t03:adjustment:palmas-ves'), 'Valid VES Palmas adjustment'), status: 'VALIDATED', createdByEmail: 'admin.multi@buildingos.local', validatedByEmail: 'owner.multi@buildingos.local', functionalAmountMinor: 5000, functionalCurrencyCode: 'USD', exchangeRateSemanticKey: key('t03:rate:ves-usd'), exchangeRateValue: '0.025', exchangeRateDirection: 'DIRECT' },
      ],
      tickets: [{ semanticKey: key('t03:ticket:robles-closed'), buildingAlias: 'robles', unitCode: 'ROB-103', createdByEmail: 'resident.robles103@buildingos.local', assignedToEmail: 'operator.multi@buildingos.local', title: marker(key('t03:ticket:robles-closed'), 'Repair completed'), description: 'Closed local multi-building scenario', category: 'MAINTENANCE', priority: 'LOW', status: 'CLOSED', closedAt: '2026-04-03' }],
      communications: [{ semanticKey: key('t03:communication:multi-notice'), title: marker(key('t03:communication:multi-notice'), 'Aviso multi-edificio'), body: 'Local multi-building notice.', channel: 'IN_APP', status: 'SENT', createdByEmail: 'admin.multi@buildingos.local', sentAt: '2026-04-02', recipientEmails: ['resident.multi@buildingos.local', 'resident.palmas101@buildingos.local'] }],
    },
    {
      key: 'tenant-04', type: 'ADMINISTRADORA', name: 'LOCAL V2 — QA / EDGE CASES', currency: 'ARS', functionalCurrency: 'ARS',
      buildings: [{ key: 't04:qa', name: 'QA Building', alias: 'qa', units: [unit('QA-101', 'OCCUPIED'), unit('QA-102', 'OCCUPIED'), unit('QA-103', 'VACANT'), unit('QA-104', 'OCCUPIED'), unit('QA-105', 'OCCUPIED'), unit('QA-106', 'OCCUPIED')] }],
      users: [
        user('owner.qa', 'Owner QA', ['TENANT_OWNER']), user('admin-resident.qa', 'Admin Resident QA', ['TENANT_ADMIN', 'RESIDENT'], ['QA-101'], true, 'TENANT_ADMIN'), user('resident.multiunit.qa', 'Resident Multiunit QA', ['RESIDENT'], ['QA-102', 'QA-106']), user('resident.delinquent.qa', 'Resident Delinquent QA', ['RESIDENT'], ['QA-104']), user('resident.partial.qa', 'Resident Partial QA', ['RESIDENT'], ['QA-105']),
      ],
      charges: tenant04Charges, payments: tenant04Payments, exchangeRates: [],
      adjustments: [{ semanticKey: key('t04:adjustment:historical'), buildingAlias: 'qa', sourceInvoiceDate: '2025-11-20', sourcePeriod: '2025-11', targetPeriod: '2026-04', amountMinor: 3000, currencyCode: 'ARS', reason: marker(key('t04:adjustment:historical'), 'Historical QA adjustment'), status: 'VALIDATED', createdByEmail: 'owner.qa@buildingos.local', validatedByEmail: 'owner.qa@buildingos.local', functionalAmountMinor: 3000, functionalCurrencyCode: 'ARS', exchangeRateValue: '1', exchangeRateDirection: 'IDENTITY' }],
      tickets: [
        { semanticKey: key('t04:ticket:open'), buildingAlias: 'qa', unitCode: 'QA-104', createdByEmail: 'resident.delinquent.qa@buildingos.local', assignedToEmail: 'owner.qa@buildingos.local', title: marker(key('t04:ticket:open'), 'Open QA billing issue'), description: 'Open QA edge case', category: 'BILLING', priority: 'HIGH', status: 'OPEN' },
        { semanticKey: key('t04:ticket:closed'), buildingAlias: 'qa', unitCode: 'QA-105', createdByEmail: 'resident.partial.qa@buildingos.local', assignedToEmail: 'owner.qa@buildingos.local', title: marker(key('t04:ticket:closed'), 'Closed QA repair'), description: 'Closed QA edge case', category: 'MAINTENANCE', priority: 'LOW', status: 'CLOSED', closedAt: '2026-04-04' },
      ],
      communications: [{ semanticKey: key('t04:communication:delinquent'), buildingAlias: 'qa', title: marker(key('t04:communication:delinquent'), 'Aviso QA mora'), body: 'Local delinquency edge-case notice.', channel: 'IN_APP', status: 'SENT', createdByEmail: 'owner.qa@buildingos.local', sentAt: '2026-04-02', recipientEmails: ['resident.delinquent.qa@buildingos.local'] }],
    },
  ],
};

export function assertSafeLocalV2SeedEnvironment(environment: LocalV2Environment): LocalV2Target {
  if (environment.LOCAL_V2_SEED !== '1') {
    throw new Error('LOCAL_V2_SEED must be exactly 1');
  }

  const nodeEnv = environment.NODE_ENV?.trim().toLowerCase() ?? '';
  if (!ALLOWED_NODE_ENVS.has(nodeEnv)) {
    throw new Error(`LOCAL V2 seed only allows NODE_ENV=development, test, or empty; received NODE_ENV=${nodeEnv || 'empty'}`);
  }

  const databaseUrl = environment.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL');
  }
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new Error('LOCAL V2 seed requires a postgres or postgresql URL');
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, '')).split('/')[0] ?? '';

  if (DANGEROUS_TARGET.test(host) || DANGEROUS_TARGET.test(database)) {
    throw new Error('LOCAL V2 seed refuses staging, prod, or production targets');
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`LOCAL V2 seed refuses non-local host: ${host}`);
  }
  if (!ALLOWED_DATABASES.has(database)) {
    throw new Error(`LOCAL V2 seed refuses unapproved database: ${database || 'empty'}`);
  }
  if (database === 'buildingos' && environment.LOCAL_V2_REPLACE_CONFIRMATION !== REPLACEMENT_CONFIRMATION) {
    throw new Error(`LOCAL_V2_REPLACE_CONFIRMATION must be exactly "${REPLACEMENT_CONFIRMATION}"`);
  }

      return { database: database as LocalV2Target['database'], host: host as LocalV2Target['host'] };
    }

    /**
     * Runtime check of the server address PostgreSQL reports via inet_server_addr().
     * The URL host must already be loopback (enforced statically); this rejects a
     * REMOTE server that happens to be reachable through a local endpoint (SSH tunnel,
     * proxy). Local infrastructure may legitimately report a private/loopback address
     * (e.g. a Docker bridge IP such as 172.18.0.4/32), so loopback and RFC1918/ULA
     * addresses are accepted while public addresses are refused.
     */
    function isLocalServerAddress(rawAddress: string): boolean {
      const address = rawAddress.toLowerCase().replace(/^\[|\]$/g, '').split('/')[0];
      if (!address) return false;

      const ipv4 = address.split('.');
      if (ipv4.length === 4 && ipv4.every((part) => /^\d{1,3}$/.test(part))) {
        const octets = ipv4.map((part) => Number(part));
        if (octets.some((octet) => octet < 0 || octet > 255)) return false;
        const [first, second] = octets as [number, number];
        if (first === 127) return true; // 127.0.0.0/8 loopback
        if (first === 10) return true; // 10.0.0.0/8 private
        if (first === 172 && second >= 16 && second <= 31) return true; // 172.16.0.0/12 private
        if (first === 192 && second === 168) return true; // 192.168.0.0/16 private
        if (first === 169 && second === 254) return true; // 169.254.0.0/16 link-local
        return false;
      }

      if (address === '::1' || address === '::') return true;
      if (address.startsWith('fc') || address.startsWith('fd')) return true; // fc00::/7 ULA
      if (/^fe[89ab]/.test(address)) return true; // fe80::/10 link-local
      return false;
    }

    export async function assertConnectedLocalV2Target(client: LocalV2ConnectionClient, target: LocalV2Target): Promise<ConnectionIdentity> {
  const identity = await client.readConnectionIdentity();
  if (identity.database !== target.database) {
    throw new Error(`LOCAL V2 seed connected to ${identity.database}, expected ${target.database}`);
  }
  if (!identity.address) {
    throw new Error('LOCAL V2 seed requires a non-null PostgreSQL server address');
  }
  if (!isLocalServerAddress(identity.address)) {
    throw new Error(`LOCAL V2 seed refuses connected non-local server address: ${identity.address}`);
  }
  return identity;
}

type RecordValue = { readonly id: string; readonly [key: string]: unknown };
interface Delegate {
  findFirst(args: { readonly where: Readonly<Record<string, unknown>> }): Promise<RecordValue | null>;
  create(args: { readonly data: Readonly<Record<string, unknown>> }): Promise<RecordValue>;
}

export interface LocalV2WriteClient {
  readonly tenant: Delegate;
  readonly building: Delegate;
  readonly unit: Delegate;
  readonly user: Delegate;
  readonly membership: Delegate;
  readonly membershipRole: Delegate;
  readonly tenantMember: Delegate;
  readonly unitOccupant: Delegate;
  readonly charge: Delegate;
  readonly payment: Delegate;
  readonly paymentAllocation: Delegate;
  readonly paymentAuditLog: Delegate;
  readonly exchangeRate: Delegate;
  readonly expenseLedgerCategory: Delegate;
  readonly adjustment: Delegate;
  readonly ticket: Delegate;
  readonly communication: Delegate;
  readonly communicationTarget: Delegate;
  readonly communicationReceipt: Delegate;
  $transaction<T>(callback: (transaction: LocalV2WriteClient) => Promise<T>): Promise<T>;
}

export interface LocalV2PasswordAdapter {
  readonly passwordHash: string;
  matches(plainText: string, hash: string): Promise<boolean>;
}

export function comparable(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  // Prisma maps Decimal columns to decimal.js instances whose class name is
  // minified in the generated client (constructor.name is not 'Decimal'), so
  // duck-type on toFixed + toString instead of relying on the class name.
  if (
value && typeof value === 'object' &&
typeof (value as { toFixed?: unknown }).toFixed === 'function' &&
typeof (value as { toString?: unknown }).toString === 'function'
  ) {
return (value as { toString(): string }).toString();
  }
  return value;
}

function assertCompatible(existing: RecordValue, expected: Readonly<Record<string, unknown>>, label: string): void {
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (comparable(existing[field]) !== comparable(expectedValue)) {
      throw new Error(`Existing ${label} is incompatible at ${field}`);
    }
  }
}

async function ensureCompatible(
  delegate: Delegate,
  where: Readonly<Record<string, unknown>>,
  data: Readonly<Record<string, unknown>>,
  compatibility: Readonly<Record<string, unknown>>,
  label: string,
): Promise<RecordValue> {
  const existing = await delegate.findFirst({ where });
  if (existing) {
    assertCompatible(existing, compatibility, label);
    return existing;
  }
  return delegate.create({ data });
}

function requiredMapValue<T>(map: ReadonlyMap<string, T>, mapKey: string, label: string): T {
  const value = map.get(mapKey);
  if (!value) throw new Error(`Missing ${label}: ${mapKey}`);
  return value;
}

  const date = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

  /**
   * Seeds the PaymentAuditLog sequence required by the current application contract.
   * SUBMITTED -> APPROVED -> (RECONCILED when reconciled) -> RECEIPT_GENERATED.
   * Timestamps are strictly increasing so the audit trail renders in chronological order.
   */
  async function seedPaymentAuditTrail(
    tx: LocalV2WriteClient,
    tenantId: string,
    paymentId: string,
    paymentSpec: PaymentDefinition,
    submittedByUserId: string,
    reviewedByMembershipId: string,
    approvedByUserId: string,
    paidAt: Date,
  ): Promise<void> {
    const audit = (
      action: PaymentAuditActionValue,
      membershipId: string | null,
      metadata: Readonly<Record<string, unknown>>,
      createdAt: Date,
    ): Readonly<Record<string, unknown>> => ({
      tenantId, paymentId, action, membershipId, reason: null, comment: null, metadata, createdAt,
    });

    await ensureCompatible(
      tx.paymentAuditLog,
      { paymentId, action: 'SUBMITTED' },
      audit('SUBMITTED', null, { amount: paymentSpec.amount, currency: paymentSpec.currency, method: paymentSpec.method, reference: paymentSpec.reference, submittedByUserId }, paidAt),
      { paymentId, action: 'SUBMITTED' },
      `payment audit SUBMITTED ${paymentSpec.semanticKey}`,
    );

    await ensureCompatible(
      tx.paymentAuditLog,
      { paymentId, action: 'APPROVED' },
      audit('APPROVED', reviewedByMembershipId, { amount: paymentSpec.amount, currency: paymentSpec.currency, method: paymentSpec.method, reference: paymentSpec.reference, paidAt: paidAt.toISOString(), approvedByUserId }, new Date(paidAt.getTime() + 1000)),
      { paymentId, action: 'APPROVED' },
      `payment audit APPROVED ${paymentSpec.semanticKey}`,
    );

    if (paymentSpec.status === 'RECONCILED') {
      await ensureCompatible(
        tx.paymentAuditLog,
        { paymentId, action: 'RECONCILED' },
        audit('RECONCILED', null, { status: 'RECONCILED' }, new Date(paidAt.getTime() + 2000)),
        { paymentId, action: 'RECONCILED' },
        `payment audit RECONCILED ${paymentSpec.semanticKey}`,
      );
    }

    await ensureCompatible(
      tx.paymentAuditLog,
      { paymentId, action: 'RECEIPT_GENERATED' },
      audit('RECEIPT_GENERATED', null, { receiptNumber: paymentSpec.receiptEvidence.receiptNumber }, date(paymentSpec.receiptEvidence.receiptGeneratedAt)),
      { paymentId, action: 'RECEIPT_GENERATED' },
      `payment audit RECEIPT_GENERATED ${paymentSpec.semanticKey}`,
    );
  }

/**
 * Applies the declared data without updates or deletes. Existing semantic keys are
 * reused only after compatibility checks; mismatches abort the transaction.
 */
export async function applyLocalV2Seed(
  database: LocalV2WriteClient,
  connection: LocalV2ConnectionClient,
  target: LocalV2Target,
  password: LocalV2PasswordAdapter,
): Promise<void> {
  await assertConnectedLocalV2Target(connection, target);

  await database.$transaction(async (tx) => {
    for (const tenantSpec of LOCAL_V2_SEED_DEFINITION.tenants) {
      const tenant = await ensureCompatible(tx.tenant, { name: tenantSpec.name }, {
        name: tenantSpec.name, type: tenantSpec.type, currency: tenantSpec.currency, functionalCurrency: tenantSpec.functionalCurrency, isDemo: false,
      }, { type: tenantSpec.type, currency: tenantSpec.currency, functionalCurrency: tenantSpec.functionalCurrency, isDemo: false }, `tenant ${tenantSpec.key}`);

      const buildings = new Map<string, RecordValue>();
      const units = new Map<string, RecordValue>();
      for (const buildingSpec of tenantSpec.buildings) {
        const building = await ensureCompatible(tx.building, { tenantId: tenant.id, alias: buildingSpec.alias }, {
          tenantId: tenant.id, name: buildingSpec.name, alias: buildingSpec.alias, deletedAt: null,
        }, { tenantId: tenant.id, name: buildingSpec.name, alias: buildingSpec.alias, deletedAt: null }, `building ${buildingSpec.key}`);
        buildings.set(buildingSpec.alias, building);
        for (const unitSpec of buildingSpec.units) {
          const createdUnit = await ensureCompatible(tx.unit, { buildingId: building.id, code: unitSpec.code }, {
            tenantId: tenant.id, buildingId: building.id, code: unitSpec.code, label: `${buildingSpec.name} — ${unitSpec.code}`, unitType: 'APARTAMENTO', occupancyStatus: unitSpec.occupancyStatus, isBillable: true,
          }, { tenantId: tenant.id, buildingId: building.id, label: `${buildingSpec.name} — ${unitSpec.code}`, unitType: 'APARTAMENTO', occupancyStatus: unitSpec.occupancyStatus, isBillable: true }, `unit ${unitSpec.code}`);
          units.set(unitSpec.code, createdUnit);
          if (unitSpec.occupancyStatus === 'VACANT') {
            const activeOccupant = await tx.unitOccupant.findFirst({ where: { tenantId: tenant.id, unitId: createdUnit.id, endDate: null } });
            if (activeOccupant) {
              throw new Error(`Unit ${unitSpec.code} is declared vacant but has an active occupant`);
            }
          }
        }
      }

      const users = new Map<string, RecordValue>();
      const memberships = new Map<string, RecordValue>();
      const tenantMembers = new Map<string, RecordValue>();
      for (const userSpec of tenantSpec.users) {
        const existingUser = await tx.user.findFirst({ where: { email: userSpec.email } });
        const createdUser = existingUser ?? await tx.user.create({ data: { email: userSpec.email, name: userSpec.name, passwordHash: password.passwordHash } });
        if (existingUser) {
          assertCompatible(existingUser, { name: userSpec.name }, `user ${userSpec.email}`);
          if (typeof existingUser.passwordHash !== 'string' || !(await password.matches(LOCAL_V2_PASSWORD, existingUser.passwordHash))) {
            throw new Error(`Existing user ${userSpec.email} does not use LOCAL_V2_PASSWORD`);
          }
        }
        users.set(userSpec.email, createdUser);

        const membership = await ensureCompatible(tx.membership, { tenantId: tenant.id, userId: createdUser.id }, { tenantId: tenant.id, userId: createdUser.id }, { tenantId: tenant.id, userId: createdUser.id }, `membership ${userSpec.email}`);
        memberships.set(userSpec.email, membership);
        for (const role of userSpec.roles) {
          await ensureCompatible(tx.membershipRole, { tenantId: tenant.id, membershipId: membership.id, role, scopeType: 'TENANT' }, {
            tenantId: tenant.id, membershipId: membership.id, role, scopeType: 'TENANT', scopeBuildingId: null, scopeUnitId: null,
          }, { tenantId: tenant.id, membershipId: membership.id, role, scopeType: 'TENANT', scopeBuildingId: null, scopeUnitId: null }, `role ${userSpec.email}:${role}`);
        }

        if (userSpec.createTenantMember) {
          const memberRole = userSpec.tenantMemberRole;
          if (!memberRole) throw new Error(`Tenant member role missing for ${userSpec.email}`);
          const member = await ensureCompatible(tx.tenantMember, { tenantId: tenant.id, email: userSpec.email }, {
            tenantId: tenant.id, userId: createdUser.id, name: userSpec.name, email: userSpec.email, role: memberRole, status: 'ACTIVE', disabledAt: null,
          }, { tenantId: tenant.id, userId: createdUser.id, name: userSpec.name, email: userSpec.email, role: memberRole, status: 'ACTIVE', disabledAt: null }, `tenant member ${userSpec.email}`);
          tenantMembers.set(userSpec.email, member);
          for (const unitCode of userSpec.unitCodes) {
            const occupiedUnit = requiredMapValue(units, unitCode, 'unit');
            const activeOccupant = await tx.unitOccupant.findFirst({ where: { tenantId: tenant.id, unitId: occupiedUnit.id, endDate: null } });
            if (activeOccupant && activeOccupant.memberId !== member.id) {
              throw new Error(`Unit ${unitCode} has a different active occupant`);
            }
            await ensureCompatible(tx.unitOccupant, { tenantId: tenant.id, unitId: occupiedUnit.id, memberId: member.id }, {
              tenantId: tenant.id, unitId: occupiedUnit.id, memberId: member.id, role: 'RESIDENT', isPrimary: true, startDate: date(SEED_DATE), endDate: null,
            }, { tenantId: tenant.id, unitId: occupiedUnit.id, memberId: member.id, role: 'RESIDENT', isPrimary: true, endDate: null }, `occupancy ${userSpec.email}:${unitCode}`);
          }
        }
      }

      const rates = new Map<string, RecordValue>();
      for (const rateSpec of tenantSpec.exchangeRates) {
        const rate = await ensureCompatible(tx.exchangeRate, { tenantId: tenant.id, baseCurrency: rateSpec.baseCurrency, quoteCurrency: rateSpec.quoteCurrency, effectiveAt: date(rateSpec.effectiveAt) }, {
          tenantId: tenant.id, baseCurrency: rateSpec.baseCurrency, quoteCurrency: rateSpec.quoteCurrency, rate: rateSpec.rate, effectiveAt: date(rateSpec.effectiveAt), source: rateSpec.source, createdByMembershipId: requiredMapValue(memberships, 'admin.multi@buildingos.local', 'rate creator membership').id,
        }, { tenantId: tenant.id, baseCurrency: rateSpec.baseCurrency, quoteCurrency: rateSpec.quoteCurrency, rate: rateSpec.rate, effectiveAt: date(rateSpec.effectiveAt), source: rateSpec.source }, `exchange rate ${rateSpec.semanticKey}`);
        rates.set(rateSpec.semanticKey, rate);
      }

      const charges = new Map<string, RecordValue>();
      for (const chargeSpec of tenantSpec.charges) {
        const chargedUnit = requiredMapValue(units, chargeSpec.unitCode, 'charge unit');
        const buildingSpec = tenantSpec.buildings.find((candidate) => candidate.units.some((candidateUnit) => candidateUnit.code === chargeSpec.unitCode));
        if (!buildingSpec) throw new Error(`Missing building for charge unit ${chargeSpec.unitCode}`);
        const building = requiredMapValue(buildings, buildingSpec.alias, 'charge building');
        const creatorEmail = tenantSpec.users.find((candidate) => candidate.roles.includes('TENANT_ADMIN'))?.email ?? tenantSpec.users.find((candidate) => candidate.roles.includes('TENANT_OWNER'))?.email;
        if (!creatorEmail) throw new Error(`Missing charge creator for ${tenantSpec.key}`);
        const record = await ensureCompatible(tx.charge, { tenantId: tenant.id, concept: chargeSpec.concept }, {
          tenantId: tenant.id, buildingId: building.id, unitId: chargedUnit.id, period: chargeSpec.period, type: 'COMMON_EXPENSE', concept: chargeSpec.concept, amount: chargeSpec.amount, currency: chargeSpec.currency, dueDate: date(chargeSpec.dueDate), status: chargeSpec.status, createdByMembershipId: requiredMapValue(memberships, creatorEmail, 'charge creator membership').id,
        }, { tenantId: tenant.id, buildingId: building.id, unitId: chargedUnit.id, period: chargeSpec.period, concept: chargeSpec.concept, amount: chargeSpec.amount, currency: chargeSpec.currency, dueDate: date(chargeSpec.dueDate), status: chargeSpec.status }, `charge ${chargeSpec.semanticKey}`);
        charges.set(chargeSpec.semanticKey, record);
      }

      for (const paymentSpec of tenantSpec.payments) {
        const paymentUnit = requiredMapValue(units, paymentSpec.unitCode, 'payment unit');
        const buildingSpec = tenantSpec.buildings.find((candidate) => candidate.units.some((candidateUnit) => candidateUnit.code === paymentSpec.unitCode));
        if (!buildingSpec) throw new Error(`Missing building for payment unit ${paymentSpec.unitCode}`);
        const paymentBuilding = requiredMapValue(buildings, buildingSpec.alias, 'payment building');
        const submittedBy = requiredMapValue(users, paymentSpec.submittedByEmail, 'payment submitting user');
        const reviewedBy = requiredMapValue(memberships, paymentSpec.reviewedByEmail, 'payment reviewer membership');
        const approvedBy = requiredMapValue(users, paymentSpec.reviewedByEmail, 'payment approving user');
        const exchangeRate = paymentSpec.exchangeRateSemanticKey ? requiredMapValue(rates, paymentSpec.exchangeRateSemanticKey, 'payment exchange rate') : undefined;
        const paidAt = date(paymentSpec.paidAt);
        const functionalCurrencyCode = paymentSpec.functionalCurrencyCode ?? tenantSpec.functionalCurrency;
        const functionalAmountMinor = paymentSpec.functionalAmountMinor ?? paymentSpec.amount;
        const exchangeRateValue = paymentSpec.exchangeRateValue ?? '1';
        const exchangeRateDirection = paymentSpec.exchangeRateDirection ?? 'IDENTITY';
        const paymentData: Readonly<Record<string, unknown>> = {
          tenantId: tenant.id, buildingId: paymentBuilding.id, unitId: paymentUnit.id, amount: paymentSpec.amount, currency: paymentSpec.currency, method: paymentSpec.method, status: paymentSpec.status, paidAt, reference: paymentSpec.reference, createdByUserId: submittedBy.id, reviewedByMembershipId: reviewedBy.id, reviewedAt: paidAt, approvedByUserId: approvedBy.id, approvedAt: paidAt, receiptNumber: paymentSpec.receiptEvidence.receiptNumber, receiptStatus: paymentSpec.receiptEvidence.receiptStatus, receiptGeneratedAt: date(paymentSpec.receiptEvidence.receiptGeneratedAt), functionalAmountMinor, functionalCurrencyCode, exchangeRateId: exchangeRate?.id, exchangeRateValue, exchangeRateDirection, exchangeRateEffectiveAt: exchangeRate ? date(SEED_DATE) : undefined, conversionDate: paidAt,
        };
        const filteredPaymentData = Object.fromEntries(Object.entries(paymentData).filter(([, value]) => value !== undefined));
        const paymentRecord = await ensureCompatible(tx.payment, { tenantId: tenant.id, reference: paymentSpec.reference }, filteredPaymentData, filteredPaymentData, `payment ${paymentSpec.semanticKey}`);
        for (const allocation of paymentSpec.allocations) {
          const charge = requiredMapValue(charges, allocation.chargeSemanticKey, 'allocation charge');
          const allocationData = { tenantId: tenant.id, paymentId: paymentRecord.id, chargeId: charge.id, amount: allocation.amount, ...(allocation.paymentOriginalAmountMinor === undefined ? {} : { paymentOriginalAmountMinor: allocation.paymentOriginalAmountMinor }) };
          await ensureCompatible(tx.paymentAllocation, { paymentId: paymentRecord.id, chargeId: charge.id }, allocationData, allocationData, `allocation ${paymentSpec.semanticKey}:${allocation.chargeSemanticKey}`);
        }
        await seedPaymentAuditTrail(tx, tenant.id, paymentRecord.id, paymentSpec, submittedBy.id, reviewedBy.id, approvedBy.id, paidAt);
      }

      if (tenantSpec.adjustments.length > 0) {
        const categoryCode = `LOCAL_V2_ADJUSTMENT_${tenantSpec.key.toUpperCase().replace('-', '_')}`;
        const category = await ensureCompatible(tx.expenseLedgerCategory, { tenantId: tenant.id, code: categoryCode }, { tenantId: tenant.id, code: categoryCode, name: `LOCAL V2 adjustments ${tenantSpec.key}`, description: marker(key(`${tenantSpec.key}:category:adjustments`), 'Local adjustment category'), movementType: 'EXPENSE', catalogScope: 'BUILDING', sortOrder: 999, isActive: true }, { tenantId: tenant.id, code: categoryCode, movementType: 'EXPENSE', catalogScope: 'BUILDING', isActive: true }, `adjustment category ${tenantSpec.key}`);
        for (const adjustmentSpec of tenantSpec.adjustments) {
          const adjustmentBuilding = requiredMapValue(buildings, adjustmentSpec.buildingAlias, 'adjustment building');
          const createdBy = requiredMapValue(memberships, adjustmentSpec.createdByEmail, 'adjustment creator membership');
          const validatedBy = requiredMapValue(memberships, adjustmentSpec.validatedByEmail, 'adjustment validator membership');
          const exchangeRate = adjustmentSpec.exchangeRateSemanticKey ? requiredMapValue(rates, adjustmentSpec.exchangeRateSemanticKey, 'adjustment exchange rate') : undefined;
          const adjustmentData: Readonly<Record<string, unknown>> = {
            tenantId: tenant.id, buildingId: adjustmentBuilding.id, sourceInvoiceDate: date(adjustmentSpec.sourceInvoiceDate), sourcePeriod: adjustmentSpec.sourcePeriod, targetPeriod: adjustmentSpec.targetPeriod, categoryId: category.id, amountMinor: adjustmentSpec.amountMinor, currencyCode: adjustmentSpec.currencyCode, reason: adjustmentSpec.reason, status: adjustmentSpec.status, createdByMembershipId: createdBy.id, validatedByMembershipId: validatedBy.id, validatedAt: date(SEED_DATE), functionalAmountMinor: adjustmentSpec.functionalAmountMinor, functionalCurrencyCode: adjustmentSpec.functionalCurrencyCode, exchangeRateId: exchangeRate?.id, exchangeRateValue: adjustmentSpec.exchangeRateValue, exchangeRateDirection: adjustmentSpec.exchangeRateDirection, exchangeRateEffectiveAt: exchangeRate ? date(SEED_DATE) : undefined, conversionDate: date(adjustmentSpec.sourceInvoiceDate),
          };
          const filteredAdjustmentData = Object.fromEntries(Object.entries(adjustmentData).filter(([, value]) => value !== undefined));
          await ensureCompatible(tx.adjustment, { tenantId: tenant.id, reason: adjustmentSpec.reason }, filteredAdjustmentData, filteredAdjustmentData, `adjustment ${adjustmentSpec.semanticKey}`);
        }
      }

      for (const ticketSpec of tenantSpec.tickets) {
        const ticketBuilding = requiredMapValue(buildings, ticketSpec.buildingAlias, 'ticket building');
        const ticketUnit = ticketSpec.unitCode ? requiredMapValue(units, ticketSpec.unitCode, 'ticket unit') : undefined;
        const creator = requiredMapValue(users, ticketSpec.createdByEmail, 'ticket creator user');
        const assigned = ticketSpec.assignedToEmail ? requiredMapValue(memberships, ticketSpec.assignedToEmail, 'ticket assignee membership') : undefined;
        const ticketData = { tenantId: tenant.id, buildingId: ticketBuilding.id, ...(ticketUnit ? { unitId: ticketUnit.id } : {}), createdByUserId: creator.id, ...(assigned ? { assignedToMembershipId: assigned.id } : {}), title: ticketSpec.title, description: ticketSpec.description, category: ticketSpec.category, priority: ticketSpec.priority, status: ticketSpec.status, ...(ticketSpec.closedAt ? { closedAt: date(ticketSpec.closedAt) } : {}) };
        await ensureCompatible(tx.ticket, { tenantId: tenant.id, title: ticketSpec.title }, ticketData, ticketData, `ticket ${ticketSpec.semanticKey}`);
      }

      for (const communicationSpec of tenantSpec.communications) {
        const communicationBuilding = communicationSpec.buildingAlias ? requiredMapValue(buildings, communicationSpec.buildingAlias, 'communication building') : undefined;
        const creator = requiredMapValue(memberships, communicationSpec.createdByEmail, 'communication creator membership');
        const communicationData = { tenantId: tenant.id, ...(communicationBuilding ? { buildingId: communicationBuilding.id } : {}), title: communicationSpec.title, body: communicationSpec.body, channel: communicationSpec.channel, status: communicationSpec.status, priority: 'NORMAL', createdByMembershipId: creator.id, sentAt: date(communicationSpec.sentAt), deletedAt: null };
        const communication = await ensureCompatible(tx.communication, { tenantId: tenant.id, title: communicationSpec.title }, communicationData, communicationData, `communication ${communicationSpec.semanticKey}`);
        await ensureCompatible(tx.communicationTarget, { communicationId: communication.id, targetType: communicationBuilding ? 'BUILDING' : 'ALL_TENANT', targetId: communicationBuilding?.id ?? null }, { tenantId: tenant.id, communicationId: communication.id, targetType: communicationBuilding ? 'BUILDING' : 'ALL_TENANT', targetId: communicationBuilding?.id ?? null }, { tenantId: tenant.id, communicationId: communication.id, targetType: communicationBuilding ? 'BUILDING' : 'ALL_TENANT', targetId: communicationBuilding?.id ?? null }, `communication target ${communicationSpec.semanticKey}`);
        for (const recipientEmail of communicationSpec.recipientEmails) {
          const recipient = requiredMapValue(users, recipientEmail, 'communication recipient user');
          const receiptData = { tenantId: tenant.id, communicationId: communication.id, userId: recipient.id, deliveredAt: date(communicationSpec.sentAt), readAt: null };
          await ensureCompatible(tx.communicationReceipt, { communicationId: communication.id, userId: recipient.id }, receiptData, receiptData, `communication receipt ${communicationSpec.semanticKey}:${recipientEmail}`);
        }
      }
    }
  });
}
