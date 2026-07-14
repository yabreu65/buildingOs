/**
 * BuildingOS Pilot Data Pack Seed
 *
 * Adds functional demo data on top of an existing pilot base tenant.
 * Intended for staging / controlled pilot environments only.
 *
 * Usage:
 *   npm run seed:pilot:data-pack -- --tenantId <TENANT_ID> --buildingId <BUILDING_ID>
 *   npm run seed:pilot:data-pack -- --tenantId <TENANT_ID> --buildingId <BUILDING_ID> --manifestPath /tmp/buildingos-pilot-manifest.json
 *   NODE_ENV=staging npm run seed:pilot:data-pack:staging -- --tenantId <TENANT_ID> --buildingId <BUILDING_ID>
 */

import { Prisma, PrismaClient, Role, ScopeType, MemberStatus, MovementScope, MovementType, CatalogScope, ExpensePeriodStatus, ExpenseStatus, PaymentStatus, PaymentMethod, ReceiptStatus, TicketCategory, TicketPriority, TicketStatus, CommunicationChannel, CommunicationStatus, CommunicationPriority, CommunicationTargetType, DocumentCategory, DocumentVisibility, UnitOccupantRole } from '@prisma/client';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as Minio from 'minio';
import {
  buildSeedExpenseSnapshotItem,
  ensureSeedPublishedLiquidation,
} from './lib/seed-liquidation-workflow';

interface CliOptions {
  tenantId: string;
  buildingId: string;
  manifestPath: string;
}

interface CountBucket {
  created: number;
  reused: number;
}

interface SeedCounters {
  tenantMembers: CountBucket;
  membershipRoles: CountBucket;
  unitOccupants: CountBucket;
  categories: CountBucket;
  vendors: CountBucket;
  expensePeriods: CountBucket;
  expenses: CountBucket;
  liquidations: CountBucket;
  charges: CountBucket;
  payments: CountBucket;
  paymentAllocations: CountBucket;
  files: CountBucket;
  documents: CountBucket;
  tickets: CountBucket;
  communications: CountBucket;
  communicationTargets: CountBucket;
}

interface SeedCounterSummary {
  tenantMembers: number;
  membershipRoles: number;
  unitOccupants: number;
  categories: number;
  vendors: number;
  expensePeriods: number;
  expenses: number;
  liquidations: number;
  charges: number;
  payments: number;
  paymentAllocations: number;
  files: number;
  documents: number;
  tickets: number;
  communications: number;
  communicationTargets: number;
}

interface PilotUserRef {
  userId: string;
  email: string;
  membershipId?: string;
  tenantMemberId?: string;
  unitId?: string;
  unitCode?: string;
  loginCapable: boolean;
}

interface PilotManifestDocument {
  id: string;
  title: string;
  category: DocumentCategory;
  visibility: DocumentVisibility;
  bucket: string;
  objectKey: string;
  buildingId?: string | null;
  unitId?: string | null;
}

interface PilotManifestCommunication {
  id: string;
  title: string;
  targetType: CommunicationTargetType;
}

interface PilotManifestTicket {
  id: string;
  title: string;
  status: TicketStatus;
  unitId?: string | null;
}

interface PilotManifest {
  generatedAt: string;
  tenantId: string;
  buildingId: string;
  unitIds: string[];
  adminUser?: {
    userId: string;
    email: string;
    membershipId: string;
  };
  residentUsers: PilotUserRef[];
  residentMembers: Array<{
    memberId: string;
    email: string;
    unitId: string;
    unitCode: string;
    userId?: string | null;
  }>;
  counts: {
    created: SeedCounterSummary;
    reused: SeedCounterSummary;
  };
  documents: PilotManifestDocument[];
  communications: PilotManifestCommunication[];
  tickets: PilotManifestTicket[];
  finance: {
    period: string;
    chargePeriod: string;
    liquidationId: string;
    expensePeriodId: string;
    chargeIds: string[];
    paymentIds: string[];
  };
}

interface ExpenseCategorySeedSpec {
  code: string;
  name: string;
  description: string;
  sortOrder: number;
}

interface ExpenseDataSeedSpec extends ExpenseCategorySeedSpec {
  amountMinor: number;
  invoiceOffsetDays: number;
}

interface DocumentSeedSpec {
  title: string;
  category: DocumentCategory;
  visibility: DocumentVisibility;
  objectKey: string;
  body: string;
  buildingId?: string;
  unitId?: string;
}

interface TicketSeedSpec {
  title: string;
  description: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  buildingId: string;
  unitId?: string;
  createdByUserId: string;
  assignedToMembershipId?: string;
}

interface CommunicationSeedSpec {
  title: string;
  body: string;
  channel: CommunicationChannel;
  status: CommunicationStatus;
  priority: CommunicationPriority;
  buildingId?: string;
  targetType: CommunicationTargetType;
  targetId?: string | null;
}

type DbClient = PrismaClient | Prisma.TransactionClient;

const prisma = new PrismaClient();
const DEFAULT_MANIFEST_PATH = '/tmp/buildingos-pilot-data-pack-manifest.json';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function normalizeRequiredText(name: string, value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${name} is required`);
  }

  return normalized;
}

function validateSeedIdentifier(name: string, value: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
    throw new Error(`${name} must contain only letters, numbers, underscores, or hyphens`);
  }

  return value;
}

function validateManifestPath(value: string): string {
  if (/[\0\r\n]/.test(value)) {
    throw new Error('manifestPath cannot contain control characters');
  }

  return value;
}

function parseArgs(argv: string[]): CliOptions {
  let tenantId: string | undefined;
  let buildingId: string | undefined;
  let manifestPath = DEFAULT_MANIFEST_PATH;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const nextArg = argv[i + 1];
    if (arg === '--tenantId' && nextArg) {
      tenantId = nextArg;
      i += 1;
      continue;
    }
    if (arg === '--buildingId' && nextArg) {
      buildingId = nextArg;
      i += 1;
      continue;
    }
    if (arg === '--manifestPath' && nextArg) {
      manifestPath = nextArg;
      i += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printHelpAndExit();
    }
  }

  if (!tenantId || !buildingId) {
    throw new Error('Missing required args: --tenantId and --buildingId');
  }

  return {
    tenantId: validateSeedIdentifier('tenantId', normalizeRequiredText('tenantId', tenantId)),
    buildingId: validateSeedIdentifier('buildingId', normalizeRequiredText('buildingId', buildingId)),
    manifestPath: validateManifestPath(normalizeRequiredText('manifestPath', manifestPath)),
  };
}

function printHelpAndExit(): never {
  console.log(`Usage:
  npm run seed:pilot:data-pack -- --tenantId <TENANT_ID> --buildingId <BUILDING_ID> [--manifestPath <PATH>]

Required:
  --tenantId      Existing pilot tenant id
  --buildingId    Existing pilot building id

Optional:
  --manifestPath  Where to write the JSON manifest (default: ${DEFAULT_MANIFEST_PATH})
`);
  process.exit(0);
}

function ensureAllowedEnvironment(): void {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const appEnv = process.env.APP_ENV ?? nodeEnv;

  if (appEnv === 'production') {
    throw new Error('Pilot data pack cannot run when APP_ENV=production');
  }

  if (nodeEnv !== 'staging' && nodeEnv !== 'development') {
    throw new Error(`Pilot data pack only allowed in development or staging. Current NODE_ENV=${nodeEnv}`);
  }
}

function ensureNotProductionDatabase(): void {
  const databaseUrl = requireEnv('DATABASE_URL');
  const lowerUrl = databaseUrl.toLowerCase();

  if (lowerUrl.includes('buildingos_db')) {
    throw new Error('Refusing to run pilot data pack against production database buildingos_db');
  }

  if (lowerUrl.includes('buildingos-prod')) {
    throw new Error('Refusing to run pilot data pack against a production-looking database');
  }
}

function describeSeedError(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const meta = error.meta ? `; meta=${JSON.stringify(error.meta)}` : '';
    return `Prisma ${error.code}${meta}: ${error.message}`;
  }

  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  return String(error);
}

function buildSeedId(prefix: string, ...parts: Array<string | number>): string {
  const normalizedParts = parts
    .map((part) =>
      String(part)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, ''),
    )
    .filter((part) => part.length > 0);

  return [prefix, ...normalizedParts].join('-');
}

function isUniqueConstraintError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

async function runSeedStep<T>(operation: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error: unknown) {
    throw new Error(`Pilot data pack failed during ${operation}. Likely cause: ${describeSeedError(error)}`);
  }
}

function summarizeCounts(counts: SeedCounters, bucket: keyof CountBucket): SeedCounterSummary {
  return {
    tenantMembers: counts.tenantMembers[bucket],
    membershipRoles: counts.membershipRoles[bucket],
    unitOccupants: counts.unitOccupants[bucket],
    categories: counts.categories[bucket],
    vendors: counts.vendors[bucket],
    expensePeriods: counts.expensePeriods[bucket],
    expenses: counts.expenses[bucket],
    liquidations: counts.liquidations[bucket],
    charges: counts.charges[bucket],
    payments: counts.payments[bucket],
    paymentAllocations: counts.paymentAllocations[bucket],
    files: counts.files[bucket],
    documents: counts.documents[bucket],
    tickets: counts.tickets[bucket],
    communications: counts.communications[bucket],
    communicationTargets: counts.communicationTargets[bucket],
  };
}

function ensureConfigForStorage(): { endpoint: URL; bucket: string; accessKey: string; secretKey: string; region: string } {
  const endpoint = new URL(normalizeRequiredText('S3_ENDPOINT', requireEnv('S3_ENDPOINT')));
  return {
    endpoint,
    bucket: normalizeRequiredText('S3_BUCKET', requireEnv('S3_BUCKET')),
    accessKey: normalizeRequiredText('S3_ACCESS_KEY', requireEnv('S3_ACCESS_KEY')),
    secretKey: normalizeRequiredText('S3_SECRET_KEY', requireEnv('S3_SECRET_KEY')),
    region: normalizeRequiredText('S3_REGION', process.env.S3_REGION || 'us-east-1'),
  };
}

function createMinioClient(storage: { endpoint: URL; accessKey: string; secretKey: string }): Minio.Client {
  return new Minio.Client({
    endPoint: storage.endpoint.hostname,
    port: Number(storage.endpoint.port || (storage.endpoint.protocol === 'https:' ? 443 : 80)),
    useSSL: storage.endpoint.protocol === 'https:',
    accessKey: storage.accessKey,
    secretKey: storage.secretKey,
  });
}

function periodFor(date: Date): string {
  return date.toISOString().slice(0, 7);
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date.getTime());
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

function startOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 12, 0, 0));
}

function addDaysUtc(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

async function ensureBucket(client: Minio.Client, bucket: string, region: string): Promise<void> {
  const exists = await client.bucketExists(bucket);
  if (!exists) {
    await client.makeBucket(bucket, region);
  }
}

async function uploadTextObject(client: Minio.Client, bucket: string, objectKey: string, body: string): Promise<void> {
  const buffer = Buffer.from(body, 'utf8');
  await client.putObject(bucket, objectKey, buffer, buffer.length, {
    'Content-Type': 'text/plain; charset=utf-8',
  });
}

async function writeManifest(manifestPath: string, manifest: PilotManifest): Promise<void> {
  const resolvedPath = path.isAbsolute(manifestPath) ? manifestPath : path.resolve(process.cwd(), manifestPath);
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
  await fs.writeFile(resolvedPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`Manifest written to ${resolvedPath}`);
}

async function ensureMembershipRole(
  db: DbClient,
  tenantId: string,
  membershipId: string,
  role: Role,
): Promise<{ id: string; created: boolean }> {
  const existing = await db.membershipRole.findFirst({
    where: {
      tenantId,
      membershipId,
      role,
      scopeType: ScopeType.TENANT,
    },
  });

  if (existing) {
    return { id: existing.id, created: false };
  }

  const created = await db.membershipRole.create({
    data: {
      tenantId,
      membershipId,
      role,
      scopeType: ScopeType.TENANT,
    },
  });

  return { id: created.id, created: true };
}

async function ensureTenantMember(
  db: DbClient,
  tenantId: string,
  spec: {
    name: string;
    email: string;
    role: Role;
    status: MemberStatus;
    userId?: string;
  },
): Promise<{ memberId: string; created: boolean }> {
  const existing = await db.tenantMember.findFirst({
    where: {
      tenantId,
      email: spec.email,
    },
  });

  if (existing) {
    await db.tenantMember.update({
      where: { id: existing.id },
      data: {
        name: spec.name,
        role: spec.role,
        status: spec.status,
        userId: spec.userId ?? existing.userId,
      },
    });

    return { memberId: existing.id, created: false };
  }

  const created = await db.tenantMember.create({
    data: {
      tenantId,
      name: spec.name,
      email: spec.email,
      role: spec.role,
      status: spec.status,
      userId: spec.userId,
    },
  });

  return { memberId: created.id, created: true };
}

async function ensureUnitOccupant(
  db: DbClient,
  tenantId: string,
  unitId: string,
  memberId: string,
  isPrimary: boolean,
): Promise<{ id: string; created: boolean }> {
  const existing = await db.unitOccupant.findFirst({
    where: {
      tenantId,
      unitId,
      memberId,
    },
  });

  if (existing) {
    await db.unitOccupant.update({
      where: { id: existing.id },
      data: {
        isPrimary,
        endDate: null,
        role: UnitOccupantRole.RESIDENT,
      },
    });

    return { id: existing.id, created: false };
  }

  const created = await db.unitOccupant.create({
    data: {
      tenantId,
      unitId,
      memberId,
      role: UnitOccupantRole.RESIDENT,
      isPrimary,
    },
  });

  return { id: created.id, created: true };
}

async function ensureExpenseLedgerCategory(
  db: DbClient,
  tenantId: string,
  spec: ExpenseCategorySeedSpec,
): Promise<{ id: string; created: boolean }> {
  const existing = await db.expenseLedgerCategory.findFirst({
    where: {
      tenantId,
      code: spec.code,
    },
  });

  if (existing) {
    await db.expenseLedgerCategory.update({
      where: { id: existing.id },
      data: {
        name: spec.name,
        description: spec.description,
        movementType: MovementType.EXPENSE,
        catalogScope: CatalogScope.BUILDING,
        sortOrder: spec.sortOrder,
        isActive: true,
      },
    });

    return { id: existing.id, created: false };
  }

  const created = await db.expenseLedgerCategory.create({
    data: {
      tenantId,
      code: spec.code,
      name: spec.name,
      description: spec.description,
      movementType: MovementType.EXPENSE,
      catalogScope: CatalogScope.BUILDING,
      sortOrder: spec.sortOrder,
      isActive: true,
    },
  });

  return { id: created.id, created: true };
}

async function ensureVendor(
  db: DbClient,
  tenantId: string,
  name: string,
): Promise<{ id: string; created: boolean }> {
  const existing = await db.vendor.findFirst({
    where: {
      tenantId,
      name,
    },
  });

  if (existing) {
    return { id: existing.id, created: false };
  }

  const created = await db.vendor.create({
    data: {
      tenantId,
      name,
    },
  });

  return { id: created.id, created: true };
}

async function ensureExpensePeriod(
  db: DbClient,
  tenantId: string,
  buildingId: string,
  year: number,
  month: number,
  dueDate: Date,
  concept: string,
  totalToAllocate: bigint,
  currency: string,
): Promise<{ id: string; created: boolean }> {
  const id = buildSeedId('pilot-expense-period', tenantId, buildingId, year, month);

  try {
    const created = await db.expensePeriod.create({
      data: {
        id,
        tenantId,
        buildingId,
        year,
        month,
        totalToAllocate,
        currency,
        dueDate,
        concept,
        status: ExpensePeriodStatus.PUBLISHED,
        publishedAt: new Date(),
      },
    });

    return { id: created.id, created: true };
  } catch (error: unknown) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }

    const existing = await db.expensePeriod.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new Error(`Pilot data pack failed during expense period reuse. Likely cause: ${describeSeedError(error)}`);
    }

    return { id: existing.id, created: false };
  }
}

async function ensureExpense(
  db: DbClient,
  tenantId: string,
  buildingId: string,
  period: string,
  seedIndex: number,
  categoryId: string,
  vendorId: string,
  spec: ExpenseDataSeedSpec,
  ownerMembershipId: string,
  invoiceDate: Date,
): Promise<{ id: string; created: boolean }> {
  const id = buildSeedId('pilot-expense', tenantId, buildingId, period, seedIndex);

  try {
    const created = await db.expense.create({
      data: {
        id,
        tenantId,
        buildingId,
        period,
        liquidationPeriod: period,
        categoryId,
        vendorId,
        scopeType: MovementScope.BUILDING,
        amountMinor: spec.amountMinor,
        currencyCode: 'ARS',
        invoiceDate,
        description: spec.description,
        status: ExpenseStatus.VALIDATED,
        createdByMembershipId: ownerMembershipId,
        validatedByMembershipId: ownerMembershipId,
        validatedAt: new Date(),
      },
    });

    return { id: created.id, created: true };
  } catch (error: unknown) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }

    const existing = await db.expense.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new Error(`Pilot data pack failed during expense reuse. Likely cause: ${describeSeedError(error)}`);
    }

    return { id: existing.id, created: false };
  }
}

async function ensureLiquidation(
  db: PrismaClient,
  tenantId: string,
  buildingId: string,
  period: string,
  chargePeriod: string,
  ownerMembershipId: string,
  totalAmountMinor: number,
  expenseSnapshot: Prisma.InputJsonArray,
  unitRecords: Array<{ id: string; code: string; label: string | null }>,
): Promise<{ id: string; created: boolean }> {
  const result = await ensureSeedPublishedLiquidation({
    prisma: db,
    tenantId,
    buildingId,
    membershipId: ownerMembershipId,
    period,
    chargePeriod,
    baseCurrency: 'ARS',
    totalAmountMinor,
    totalsByCurrency: { ARS: totalAmountMinor },
    expenseSnapshot,
    units: unitRecords,
    dueDate: new Date(`${chargePeriod}-15T00:00:00.000Z`),
    notificationPolicy: 'disabled',
  });

  return { id: result.id, created: result.created };
}

async function ensurePayment(
  db: DbClient,
  params: {
    tenantId: string;
    buildingId: string;
    unitId: string;
    amount: number;
    method: PaymentMethod;
    status: PaymentStatus;
    createdByUserId: string;
    reviewedByMembershipId: string;
    approvedByUserId: string;
    reference: string;
    paidAt: Date;
    transferDate: Date;
    sourceBank: string;
    sourceAccount: string;
    sourceHolder: string;
    destinationAccount: string;
    chargeId: string;
    receiptNumber: string;
  },
): Promise<{ id: string; created: boolean }> {
  const id = buildSeedId('pilot-payment', params.tenantId, params.reference);

  try {
    const created = await db.payment.create({
      data: {
        id,
        tenantId: params.tenantId,
        buildingId: params.buildingId,
        unitId: params.unitId,
        amount: params.amount,
        method: params.method,
        status: params.status,
        createdByUserId: params.createdByUserId,
        reviewedByMembershipId: params.reviewedByMembershipId,
        approvedByUserId: params.approvedByUserId,
        approvedAt: params.paidAt,
        paidAt: params.paidAt,
        transferDate: params.transferDate,
        sourceBank: params.sourceBank,
        sourceAccount: params.sourceAccount,
        sourceHolder: params.sourceHolder,
        destinationAccount: params.destinationAccount,
        receiptStatus: ReceiptStatus.PENDING,
        receiptNumber: params.receiptNumber,
      },
    });

    return { id: created.id, created: true };
  } catch (error: unknown) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }

    const existing = await db.payment.findFirst({
      where: { id, tenantId: params.tenantId },
    });

    if (!existing) {
      throw new Error(`Pilot data pack failed during payment reuse. Likely cause: ${describeSeedError(error)}`);
    }

    return { id: existing.id, created: false };
  }
}

async function ensurePaymentAllocation(
  db: DbClient,
  tenantId: string,
  paymentId: string,
  chargeId: string,
  amount: number,
): Promise<{ id: string; created: boolean }> {
  const id = buildSeedId('pilot-payment-allocation', tenantId, paymentId, chargeId);

  try {
    const created = await db.paymentAllocation.create({
      data: {
        id,
        tenantId,
        paymentId,
        chargeId,
        amount,
      },
    });

    return { id: created.id, created: true };
  } catch (error: unknown) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }

    const existing = await db.paymentAllocation.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new Error(`Pilot data pack failed during payment allocation reuse. Likely cause: ${describeSeedError(error)}`);
    }

    return { id: existing.id, created: false };
  }
}

async function ensureDocument(
  db: DbClient,
  tenantId: string,
  ownerMembershipId: string,
  storage: { bucket: string; objectKey: string },
  spec: DocumentSeedSpec,
): Promise<{ id: string; created: boolean; fileId: string }> {
  const fileBuffer = Buffer.from(spec.body, 'utf8');
  const existingFile = await db.file.findFirst({
    where: {
      tenantId,
      bucket: storage.bucket,
      objectKey: storage.objectKey,
    },
  });

  let fileId: string;
  let createdFile = false;

  if (existingFile) {
    const updated = await db.file.update({
      where: { id: existingFile.id },
      data: {
        originalName: path.basename(storage.objectKey),
        mimeType: 'text/plain; charset=utf-8',
        size: fileBuffer.length,
        checksum: null,
        createdByMembershipId: ownerMembershipId,
      },
    });
    fileId = updated.id;
  } else {
    const created = await db.file.create({
      data: {
        tenantId,
        bucket: storage.bucket,
        objectKey: storage.objectKey,
        originalName: path.basename(storage.objectKey),
        mimeType: 'text/plain; charset=utf-8',
        size: fileBuffer.length,
        checksum: null,
        createdByMembershipId: ownerMembershipId,
      },
    });
    fileId = created.id;
    createdFile = true;
  }

  const existingDocument = await db.document.findFirst({
    where: {
      tenantId,
      fileId,
    },
  });

  if (existingDocument) {
    const updated = await db.document.update({
      where: { id: existingDocument.id },
      data: {
        tenantId,
        title: spec.title,
        category: spec.category,
        visibility: spec.visibility,
        buildingId: spec.buildingId,
        unitId: spec.unitId,
        createdByMembershipId: ownerMembershipId,
      },
    });

    return { id: updated.id, created: false, fileId };
  }

  const created = await db.document.create({
    data: {
      tenantId,
      fileId,
      title: spec.title,
      category: spec.category,
      visibility: spec.visibility,
      buildingId: spec.buildingId,
      unitId: spec.unitId,
      createdByMembershipId: ownerMembershipId,
    },
  });

  return { id: created.id, created: createdFile, fileId };
}

async function ensureTicket(
  db: DbClient,
  tenantId: string,
  seedIndex: number,
  spec: TicketSeedSpec,
): Promise<{ id: string; created: boolean }> {
  const id = buildSeedId('pilot-ticket', tenantId, spec.buildingId, seedIndex);
  const data = {
    id,
    tenantId,
    buildingId: spec.buildingId,
    unitId: spec.unitId,
    createdByUserId: spec.createdByUserId,
    assignedToMembershipId: spec.assignedToMembershipId,
    title: spec.title,
    description: spec.description,
    category: spec.category,
    priority: spec.priority,
    status: spec.status,
    aiSuggestedCategory: false,
    aiCategorySuggestion: null,
    closedAt: spec.status === TicketStatus.RESOLVED ? new Date() : null,
  };

  try {
    const created = await db.ticket.create({ data });
    return { id: created.id, created: true };
  } catch (error: unknown) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }

    const existing = await db.ticket.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new Error(`Pilot data pack failed during ticket reuse. Likely cause: ${describeSeedError(error)}`);
    }

    return { id: existing.id, created: false };
  }
}

async function ensureCommunication(
  db: DbClient,
  tenantId: string,
  ownerMembershipId: string,
  seedIndex: number,
  spec: CommunicationSeedSpec,
): Promise<{ id: string; created: boolean }> {
  const id = buildSeedId('pilot-communication', tenantId, spec.buildingId ?? 'tenant', seedIndex);
  const payload = {
    id,
    tenantId,
    buildingId: spec.buildingId,
    title: spec.title,
    body: spec.body,
    channel: spec.channel,
    status: spec.status,
    priority: spec.priority,
    createdByMembershipId: ownerMembershipId,
    scheduledAt: spec.status === CommunicationStatus.SENT ? new Date() : null,
    sentAt: spec.status === CommunicationStatus.SENT ? new Date() : null,
  };

  try {
    const created = await db.communication.create({
      data: payload,
    });

    await db.communicationTarget.deleteMany({
      where: {
        tenantId,
        communicationId: created.id,
      },
    });

    await db.communicationTarget.create({
      data: {
        tenantId,
        communicationId: created.id,
        targetType: spec.targetType,
        targetId: spec.targetId ?? null,
      },
    });

    return { id: created.id, created: true };
  } catch (error: unknown) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }

    const existing = await db.communication.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new Error(`Pilot data pack failed during communication reuse. Likely cause: ${describeSeedError(error)}`);
    }

    await db.communicationTarget.deleteMany({
      where: {
        tenantId,
        communicationId: existing.id,
      },
    });

    await db.communicationTarget.create({
      data: {
        tenantId,
        communicationId: existing.id,
        targetType: spec.targetType,
        targetId: spec.targetId ?? null,
      },
    });

    return { id: existing.id, created: false };
  }
}

async function loadPilotDataPack() {
  ensureAllowedEnvironment();
  ensureNotProductionDatabase();

  const options = parseArgs(process.argv.slice(2));
  const storage = ensureConfigForStorage();
  const minioClient = createMinioClient(storage);
  await ensureBucket(minioClient, storage.bucket, storage.region);

  const now = new Date();
  const currentPeriod = periodFor(now);
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;
  const nextMonthDate = addMonths(now, 1);
  const chargePeriod = periodFor(nextMonthDate);
  const dueDate = addDaysUtc(startOfUtcMonth(nextMonthDate), 9);

  const counts: SeedCounters = {
    tenantMembers: { created: 0, reused: 0 },
    membershipRoles: { created: 0, reused: 0 },
    unitOccupants: { created: 0, reused: 0 },
    categories: { created: 0, reused: 0 },
    vendors: { created: 0, reused: 0 },
    expensePeriods: { created: 0, reused: 0 },
    expenses: { created: 0, reused: 0 },
    liquidations: { created: 0, reused: 0 },
    charges: { created: 0, reused: 0 },
    payments: { created: 0, reused: 0 },
    paymentAllocations: { created: 0, reused: 0 },
    files: { created: 0, reused: 0 },
    documents: { created: 0, reused: 0 },
    tickets: { created: 0, reused: 0 },
    communications: { created: 0, reused: 0 },
    communicationTargets: { created: 0, reused: 0 },
  };

  const baseData = await runSeedStep('pilot base lookup', async () => {
    const tenant = await prisma.tenant.findUnique({
      where: { id: options.tenantId },
    });

    if (!tenant) {
      throw new Error(`Tenant not found: ${options.tenantId}. Run the pilot base seed first.`);
    }

    const building = await prisma.building.findFirst({
      where: {
        id: options.buildingId,
        tenantId: options.tenantId,
      },
    });

    if (!building) {
      throw new Error(`Building not found for tenant ${options.tenantId}: ${options.buildingId}`);
    }

    const ownerEmail = `owner-${options.tenantId.slice(0, 8)}@pilot.buildingos.local`;
    const residentEmail = `resident-${options.tenantId.slice(0, 8)}@pilot.buildingos.local`;
    const resident2Email = `resident-2-${options.tenantId.slice(0, 8)}@pilot.buildingos.local`;
    const resident3Email = `resident-3-${options.tenantId.slice(0, 8)}@pilot.buildingos.local`;
    const ownerUser = await prisma.user.findUnique({ where: { email: ownerEmail } });
    const residentUser = await prisma.user.findUnique({ where: { email: residentEmail } });

    if (!ownerUser || !residentUser) {
      throw new Error('Pilot base users not found. Run the pilot base seed before the data pack.');
    }

    const ownerMembership = await prisma.membership.findFirst({
      where: {
        tenantId: options.tenantId,
        userId: ownerUser.id,
      },
    });
    const residentMembership = await prisma.membership.findFirst({
      where: {
        tenantId: options.tenantId,
        userId: residentUser.id,
      },
    });

    if (!ownerMembership || !residentMembership) {
      throw new Error('Pilot base memberships not found. Run the pilot base seed before the data pack.');
    }

    const unitRecords = await prisma.unit.findMany({
      where: {
        tenantId: options.tenantId,
        buildingId: options.buildingId,
      },
      orderBy: {
        code: 'asc',
      },
    });

    if (unitRecords.length < 3) {
      throw new Error(`Pilot data pack expects at least 3 units, found ${unitRecords.length}`);
    }

    return {
      tenant,
      building,
      ownerEmail,
      residentEmail,
      resident2Email,
      resident3Email,
      ownerUser,
      residentUser,
      ownerMembership,
      residentMembership,
      unitRecords,
    };
  });

  const {
    tenant,
    building,
    ownerEmail,
    residentEmail,
    resident2Email,
    resident3Email,
    ownerUser,
    residentUser,
    ownerMembership,
    residentMembership,
    unitRecords,
  } = baseData;

  const residentMember1 = await ensureTenantMember(prisma, options.tenantId, {
    name: `Residente ${unitRecords[0]!.code}`,
    email: residentEmail,
    role: Role.RESIDENT,
    status: MemberStatus.ACTIVE,
    userId: residentUser.id,
  });
  counts.tenantMembers[residentMember1.created ? 'created' : 'reused'] += 1;

  const residentMember2 = await ensureTenantMember(prisma, options.tenantId, {
    name: `Residente ${unitRecords[1]!.code}`,
    email: resident2Email,
    role: Role.RESIDENT,
    status: MemberStatus.ACTIVE,
  });
  counts.tenantMembers[residentMember2.created ? 'created' : 'reused'] += 1;

  const residentMember3 = await ensureTenantMember(prisma, options.tenantId, {
    name: `Residente ${unitRecords[2]!.code}`,
    email: resident3Email,
    role: Role.RESIDENT,
    status: MemberStatus.ACTIVE,
  });
  counts.tenantMembers[residentMember3.created ? 'created' : 'reused'] += 1;

  const roleAssignments = [
    await ensureMembershipRole(prisma, options.tenantId, ownerMembership.id, Role.TENANT_OWNER),
    await ensureMembershipRole(prisma, options.tenantId, ownerMembership.id, Role.TENANT_ADMIN),
    await ensureMembershipRole(prisma, options.tenantId, residentMembership.id, Role.RESIDENT),
  ];
  roleAssignments.forEach((assignment) => {
    counts.membershipRoles[assignment.created ? 'created' : 'reused'] += 1;
  });

  const occupantAssignments = [
    await ensureUnitOccupant(prisma, options.tenantId, unitRecords[0]!.id, residentMember1.memberId, true),
    await ensureUnitOccupant(prisma, options.tenantId, unitRecords[1]!.id, residentMember2.memberId, true),
    await ensureUnitOccupant(prisma, options.tenantId, unitRecords[2]!.id, residentMember3.memberId, true),
  ];
  occupantAssignments.forEach((assignment) => {
    counts.unitOccupants[assignment.created ? 'created' : 'reused'] += 1;
  });

  const expenseCategories: ExpenseCategorySeedSpec[] = [
    {
      code: 'PILOT_ELECTRICITY',
      name: 'Electricidad piloto',
      description: 'Consumo eléctrico ficticio del piloto controlado',
      sortOrder: 10,
    },
    {
      code: 'PILOT_WATER',
      name: 'Agua piloto',
      description: 'Consumo de agua ficticio del piloto controlado',
      sortOrder: 20,
    },
    {
      code: 'PILOT_MAINTENANCE',
      name: 'Mantenimiento piloto',
      description: 'Gastos de mantenimiento ficticios del piloto controlado',
      sortOrder: 30,
    },
  ];

  const categoryResults = await Promise.all(
    expenseCategories.map((category) => ensureExpenseLedgerCategory(prisma, options.tenantId, category)),
  );
  categoryResults.forEach((result) => {
    counts.categories[result.created ? 'created' : 'reused'] += 1;
  });

  const vendorResult = await ensureVendor(prisma, options.tenantId, 'Servicios Integrales Piloto');
  counts.vendors[vendorResult.created ? 'created' : 'reused'] += 1;

  const expenseSpecs: ExpenseDataSeedSpec[] = [
    {
      code: 'PILOT_ELECTRICITY',
      name: 'Electricidad piloto',
      description: `PILOT DATA PACK - Electricidad ${currentPeriod}`,
      amountMinor: 50000,
      invoiceOffsetDays: 5,
      sortOrder: 10,
    },
    {
      code: 'PILOT_WATER',
      name: 'Agua piloto',
      description: `PILOT DATA PACK - Agua ${currentPeriod}`,
      amountMinor: 50000,
      invoiceOffsetDays: 12,
      sortOrder: 20,
    },
    {
      code: 'PILOT_MAINTENANCE',
      name: 'Mantenimiento piloto',
      description: `PILOT DATA PACK - Mantenimiento ${currentPeriod}`,
      amountMinor: 50000,
      invoiceOffsetDays: 18,
      sortOrder: 30,
    },
  ];

  const financeResult = await runSeedStep('finance seeding', async () => {
    const expensePeriodResult = await ensureExpensePeriod(
      prisma,
      options.tenantId,
      options.buildingId,
      currentYear,
      currentMonth,
      dueDate,
      `Expensas piloto ${currentPeriod}`,
      150000n,
      'ARS',
    );
    counts.expensePeriods[expensePeriodResult.created ? 'created' : 'reused'] += 1;

    const expenseResults: Array<{ id: string; created: boolean }> = [];
    for (const [index, spec] of expenseSpecs.entries()) {
      const categoryId = categoryResults[index]?.id;
      if (!categoryId) {
        throw new Error(`Expense category not found for code ${spec.code}`);
      }
      const invoiceDate = addDaysUtc(startOfUtcMonth(now), spec.invoiceOffsetDays);
      const result = await ensureExpense(
        prisma,
        options.tenantId,
        options.buildingId,
        currentPeriod,
        index,
        categoryId,
        vendorResult.id,
        spec,
        ownerMembership.id,
        invoiceDate,
      );
      counts.expenses[result.created ? 'created' : 'reused'] += 1;
      expenseResults.push(result);
    }

    const totalAmountMinor = expenseSpecs.reduce((sum, spec) => sum + spec.amountMinor, 0);
    const expenseSnapshot = expenseResults.map((expenseResult, index) => {
      const spec = expenseSpecs[index]!;
      const invoiceDate = addDaysUtc(startOfUtcMonth(now), spec.invoiceOffsetDays);

      return buildSeedExpenseSnapshotItem({
        expenseId: expenseResult.id,
        categoryName: spec.name,
        vendorName: 'Servicios Integrales Piloto',
        amountMinor: spec.amountMinor,
        currencyCode: 'ARS',
        invoiceDate,
        description: spec.description,
      });
    });

    const liquidationResult = await ensureLiquidation(
      prisma,
      options.tenantId,
      options.buildingId,
      currentPeriod,
      chargePeriod,
      ownerMembership.id,
      totalAmountMinor,
      expenseSnapshot,
      unitRecords,
    );
    counts.liquidations[liquidationResult.created ? 'created' : 'reused'] += 1;
    const publishedCharges = await prisma.charge.findMany({
      where: {
        tenantId: options.tenantId,
        buildingId: options.buildingId,
        liquidationId: liquidationResult.id,
        period: currentPeriod,
      },
      orderBy: { unitId: 'asc' },
      select: {
        id: true,
        unitId: true,
        amount: true,
        period: true,
      },
    });
    counts.charges[liquidationResult.created ? 'created' : 'reused'] += publishedCharges.length;
    const chargeResults = publishedCharges.map((charge) => ({
      id: charge.id,
      created: liquidationResult.created,
      amount: charge.amount,
      unitId: charge.unitId,
      period: charge.period,
    }));

    const paymentSpecs: Array<{
      reference: string;
      unitId: string;
      amount: number;
      chargeId: string;
    }> = [
      {
        reference: 'PILOT-PAGO-001',
        unitId: unitRecords[0]!.id,
        amount: chargeResults[0]!.amount,
        chargeId: chargeResults[0]!.id,
      },
      {
        reference: 'PILOT-PAGO-002',
        unitId: unitRecords[1]!.id,
        amount: chargeResults[1]!.amount,
        chargeId: chargeResults[1]!.id,
      },
    ];

    const paymentResults: Array<{ id: string; created: boolean; chargeId: string; amount: number }> = [];
    for (const paymentSpec of paymentSpecs) {
      const payment = await ensurePayment(prisma, {
        tenantId: options.tenantId,
        buildingId: options.buildingId,
        unitId: paymentSpec.unitId,
        amount: paymentSpec.amount,
        method: PaymentMethod.TRANSFER,
        status: PaymentStatus.APPROVED,
        createdByUserId: residentUser.id,
        reviewedByMembershipId: ownerMembership.id,
        approvedByUserId: ownerUser.id,
        reference: paymentSpec.reference,
        paidAt: now,
        transferDate: now,
        sourceBank: 'Banco piloto',
        sourceAccount: '0000000000',
        sourceHolder: 'Residente piloto',
        destinationAccount: '1111111111',
        chargeId: paymentSpec.chargeId,
        receiptNumber: paymentSpec.reference,
      });
      counts.payments[payment.created ? 'created' : 'reused'] += 1;
      paymentResults.push({
        ...payment,
        chargeId: paymentSpec.chargeId,
        amount: paymentSpec.amount,
      });
    }

    for (const paymentResult of paymentResults) {
      const allocation = await ensurePaymentAllocation(
        prisma,
        options.tenantId,
        paymentResult.id,
        paymentResult.chargeId,
        paymentResult.amount,
      );
      counts.paymentAllocations[allocation.created ? 'created' : 'reused'] += 1;
    }

    return {
      expensePeriodResult,
      expenseResults,
      liquidationResult,
      chargeResults,
      paymentResults,
    };
  });

  const documentSpecs: DocumentSeedSpec[] = [
    {
      title: 'Reglamento general del piloto',
      category: DocumentCategory.RULES,
      visibility: DocumentVisibility.TENANT_ADMINS,
      objectKey: `pilot-data-pack/${options.tenantId}/documents/reglamento-general.txt`,
      body: [
        'BuildingOS Pilot Document',
        'Reglamento general del piloto controlado.',
        'Documento ficticio para validar descargas y permisos.',
      ].join('\n'),
      buildingId: options.buildingId,
    },
    {
      title: 'Presupuesto mensual del piloto',
      category: DocumentCategory.BUDGET,
      visibility: DocumentVisibility.TENANT_ADMINS,
      objectKey: `pilot-data-pack/${options.tenantId}/documents/presupuesto-mensual.txt`,
      body: [
        'BuildingOS Pilot Document',
        `Periodo: ${currentPeriod}`,
        'Presupuesto ficticio para validar documentos del edificio.',
      ].join('\n'),
      buildingId: options.buildingId,
    },
    {
      title: 'Guía del residente del piloto',
      category: DocumentCategory.OTHER,
      visibility: DocumentVisibility.RESIDENTS,
      objectKey: `pilot-data-pack/${options.tenantId}/documents/guia-del-residente.txt`,
      body: [
        'BuildingOS Pilot Document',
        'Guía de acceso y navegación del residente.',
        'Visible para residentes desde el primer día.',
      ].join('\n'),
      buildingId: options.buildingId,
      unitId: unitRecords[0]!.id,
    },
  ];

  const documentResults = await runSeedStep('document seeding', async () => prisma.$transaction(async (tx) => {
    const results: Array<{ id: string; created: boolean; fileId: string }> = [];
    for (const spec of documentSpecs) {
      await uploadTextObject(minioClient, storage.bucket, spec.objectKey, spec.body);
      const result = await ensureDocument(
        tx,
        options.tenantId,
        ownerMembership.id,
        {
          bucket: storage.bucket,
          objectKey: spec.objectKey,
        },
        spec,
      );
      counts.files[result.created ? 'created' : 'reused'] += 1;
      counts.documents[result.created ? 'created' : 'reused'] += 1;
      results.push(result);
    }
    return results;
  }));

  const communicationSpecs: CommunicationSeedSpec[] = [
    {
      title: 'Bienvenida al piloto controlado',
      body: [
        'Gracias por participar del piloto privado de BuildingOS.',
        'Usá este entorno para validar módulos, flujos y feedback.',
      ].join('\n'),
      channel: CommunicationChannel.IN_APP,
      status: CommunicationStatus.SENT,
      priority: CommunicationPriority.NORMAL,
      targetType: CommunicationTargetType.ALL_TENANT,
    },
    {
      title: 'Aviso de mantenimiento del edificio',
      body: [
        'Habrá una ventana de mantenimiento simulada para validar comunicaciones.',
        'No requiere acción real de los residentes.',
      ].join('\n'),
      channel: CommunicationChannel.IN_APP,
      status: CommunicationStatus.SENT,
      priority: CommunicationPriority.NORMAL,
      buildingId: options.buildingId,
      targetType: CommunicationTargetType.BUILDING,
      targetId: options.buildingId,
    },
  ];

  const communicationResults = await runSeedStep('communication seeding', async () => prisma.$transaction(async (tx) => {
    const results: Array<{ id: string; created: boolean }> = [];
    for (const [index, spec] of communicationSpecs.entries()) {
      const result = await ensureCommunication(tx, options.tenantId, ownerMembership.id, index, spec);
      counts.communications[result.created ? 'created' : 'reused'] += 1;
      counts.communicationTargets.created += 1;
      results.push(result);
    }
    return results;
  }));

  const ticketSpecs: TicketSeedSpec[] = [
    {
      title: 'PILOT - Fuga de agua en el lobby',
      description: 'Reporte ficticio para validar el flujo de reclamos/resolución.',
      category: TicketCategory.MAINTENANCE,
      priority: TicketPriority.HIGH,
      status: TicketStatus.OPEN,
      buildingId: options.buildingId,
      unitId: unitRecords[0]!.id,
      createdByUserId: residentUser.id,
    },
    {
      title: 'PILOT - Ruido intermitente en ascensor',
      description: 'Segundo reclamo ficticio del piloto controlado.',
      category: TicketCategory.REPAIR,
      priority: TicketPriority.MEDIUM,
      status: TicketStatus.IN_PROGRESS,
      buildingId: options.buildingId,
      unitId: unitRecords[1]!.id,
      createdByUserId: residentUser.id,
      assignedToMembershipId: ownerMembership.id,
    },
    {
      title: 'PILOT - Luz del pasillo reemplazada',
      description: 'Reclamo resuelto para validar estados cerrados.',
      category: TicketCategory.CLEANING,
      priority: TicketPriority.LOW,
      status: TicketStatus.RESOLVED,
      buildingId: options.buildingId,
      unitId: undefined,
      createdByUserId: ownerUser.id,
      assignedToMembershipId: ownerMembership.id,
    },
  ];

  const ticketResults = await runSeedStep('ticket seeding', async () => prisma.$transaction(async (tx) => {
    const results: Array<{ id: string; created: boolean }> = [];
    for (const [index, spec] of ticketSpecs.entries()) {
      const result = await ensureTicket(tx, options.tenantId, index, spec);
      counts.tickets[result.created ? 'created' : 'reused'] += 1;
      results.push(result);
    }
    return results;
  }));

  const manifest: PilotManifest = {
    generatedAt: new Date().toISOString(),
    tenantId: options.tenantId,
    buildingId: options.buildingId,
    unitIds: unitRecords.map((unit) => unit.id),
    adminUser: {
      userId: ownerUser.id,
      email: ownerUser.email,
      membershipId: ownerMembership.id,
    },
    residentUsers: [
      {
        userId: residentUser.id,
        email: residentUser.email,
        membershipId: residentMembership.id,
        tenantMemberId: residentMember1.memberId,
        unitId: unitRecords[0]!.id,
        unitCode: unitRecords[0]!.code,
        loginCapable: true,
      },
    ],
    residentMembers: [
      {
        memberId: residentMember2.memberId,
        email: resident2Email,
        unitId: unitRecords[1]!.id,
        unitCode: unitRecords[1]!.code,
      },
      {
        memberId: residentMember3.memberId,
        email: resident3Email,
        unitId: unitRecords[2]!.id,
        unitCode: unitRecords[2]!.code,
      },
    ],
    counts: {
      created: summarizeCounts(counts, 'created'),
      reused: summarizeCounts(counts, 'reused'),
    },
    documents: documentResults.map((document, index) => ({
      id: document.id,
      title: documentSpecs[index]!.title,
      category: documentSpecs[index]!.category,
      visibility: documentSpecs[index]!.visibility,
      bucket: storage.bucket,
      objectKey: documentSpecs[index]!.objectKey,
      buildingId: documentSpecs[index]!.buildingId,
      unitId: documentSpecs[index]!.unitId,
    })),
    communications: communicationResults.map((communication, index) => ({
      id: communication.id,
      title: communicationSpecs[index]!.title,
      targetType: communicationSpecs[index]!.targetType,
    })),
    tickets: ticketResults.map((ticket, index) => ({
      id: ticket.id,
      title: ticketSpecs[index]!.title,
      status: ticketSpecs[index]!.status,
      unitId: ticketSpecs[index]!.unitId,
    })),
    finance: {
      period: currentPeriod,
      chargePeriod,
      liquidationId: financeResult.liquidationResult.id,
      expensePeriodId: financeResult.expensePeriodResult.id,
      chargeIds: financeResult.chargeResults.map((charge) => charge.id),
      paymentIds: financeResult.paymentResults.map((payment) => payment.id),
    },
  };

  await writeManifest(options.manifestPath, manifest);

  console.log('\nPilot data pack complete.');
  console.log(`Tenant: ${tenant.name} (${tenant.id})`);
  console.log(`Building: ${building.name} (${building.id})`);
  console.log(`Units: ${unitRecords.length}`);
  console.log(`Manifest: ${path.isAbsolute(options.manifestPath) ? options.manifestPath : path.resolve(process.cwd(), options.manifestPath)}`);
  console.log(`Base resident: ${residentUser.email}`);
  console.log(`Additional resident members: ${residentMember2.memberId}, ${residentMember3.memberId}`);
  console.log(`Documents seeded: ${documentResults.length}`);
  console.log(`Tickets should be seeded in the next iteration if needed.`);
}

loadPilotDataPack()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : describeSeedError(error));
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
