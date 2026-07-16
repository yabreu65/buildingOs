import { ConflictException } from '@nestjs/common';
import { AuditAction, ImportJobStatus, MemberStatus, Prisma, Role, UnitOccupantRole } from '@prisma/client';
import { createHash } from 'crypto';
import { AuditService } from '../../../audit/audit.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { MinioService } from '../../../storage/minio.service';
import { OnboardingImportNormalizerService } from './onboarding-import-normalizer.service';
import { OnboardingImportConfirmationService } from './onboarding-import-confirmation.service';
import type {
  ConfirmOnboardingImportSummary,
  ImportPreviewSummary,
  ParsedWorkbookData,
} from '../types/onboarding-import.types';

function createSheetStats() {
  return {
    total: 0,
    new: 0,
    reusable: 0,
    conflict: 0,
    invalid: 0,
  };
}

function createPreviewSummary(): ImportPreviewSummary {
  return {
    buildings: createSheetStats(),
    units: createSheetStats(),
    people: createSheetStats(),
    relations: createSheetStats(),
    openingBalances: createSheetStats(),
    blockingIssues: 0,
    warnings: 0,
  };
}

function createConfirmationSummary(): ConfirmOnboardingImportSummary {
  return {
    buildingsCreated: 0,
    buildingsReused: 0,
    unitCategoriesCreated: 0,
    unitCategoriesReused: 0,
    unitsCreated: 0,
    unitsReused: 0,
    peopleCreated: 0,
    peopleReused: 0,
    relationsCreated: 0,
    relationsReused: 0,
    chargesCreated: 0,
    chargesReused: 0,
  };
}

function createParsedWorkbookData(): ParsedWorkbookData {
  return {
    buildings: [
      {
        sheet: 'Edificios',
        rowNumber: 2,
        raw: {
          codigo: 'a',
          nombre: 'Torre A',
          direccion: 'Av. Principal 123',
        },
        normalized: {
          codigo: 'A',
          nombre: 'Torre A',
          direccion: 'Av. Principal 123',
        },
      },
    ],
    units: [
      {
        sheet: 'Unidades',
        rowNumber: 2,
        raw: {
          edificio_codigo: 'a',
          codigo: '101',
          etiqueta: '101',
          tipo: 'APARTAMENTO',
          m2: 80,
          facturacion: true,
          categoria_nombre: 'Premium',
          coeficiente: 1.5,
        },
        normalized: {
          edificioCodigo: 'A',
          codigo: '101',
          etiqueta: '101',
          tipo: 'APARTAMENTO',
          m2: 80,
          facturacion: true,
          categoriaNombre: 'Premium',
          coeficiente: 1.5,
        },
      },
    ],
    people: [
      {
        sheet: 'Personas',
        rowNumber: 2,
        raw: {
          persona_codigo: 'p-1',
          nombre: 'Residente Uno',
          email: 'resident@example.com',
          telefono: '555-0101',
          documento: 'V-12345678',
        },
        normalized: {
          personaCodigo: 'P-1',
          nombre: 'Residente Uno',
          email: 'resident@example.com',
          telefono: '555-0101',
          documento: 'V-12345678',
        },
      },
    ],
    relations: [
      {
        sheet: 'Relaciones_Unidad',
        rowNumber: 2,
        raw: {
          persona_codigo: 'p-1',
          edificio_codigo: 'a',
          unidad_codigo: '101',
          rol: 'RESIDENT',
          principal: true,
          fecha_inicio: '2026-01-01',
        },
        normalized: {
          personaCodigo: 'P-1',
          edificioCodigo: 'A',
          unidadCodigo: '101',
          rol: 'RESIDENT',
          principal: true,
          startDate: '2026-01-01',
        },
      },
    ],
    openingBalances: [
      {
        sheet: 'Saldos_Iniciales',
        rowNumber: 2,
        raw: {
          edificio_codigo: 'a',
          unidad_codigo: '101',
          periodo: '2026-01',
          concepto: 'Initial charge',
          monto: 1500,
          moneda: 'ARS',
          vencimiento: '2026-01-15',
          tipo: 'DEBITO',
        },
        normalized: {
          edificioCodigo: 'A',
          unidadCodigo: '101',
          period: '2026-01',
          concept: 'Initial charge',
          amountMinor: 1500,
          currency: 'ARS',
          dueDate: '2026-01-15',
          kind: 'DEBITO',
        },
      },
    ],
  };
}

function createPayload(importId: string, tenantId: string, fileHash: string) {
  const data = createParsedWorkbookData();
  const payload = {
    importId,
    tenantId,
    type: 'INITIAL_ONBOARDING',
    schemaVersion: 'v1',
    fileHash,
    fileName: 'onboarding.xlsx',
    summary: createPreviewSummary(),
    issues: [],
    data,
  };

  return {
    payload,
    serialized: JSON.stringify(payload),
  };
}

function createCurrentJob(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'import-1',
    tenantId: 'tenant-1',
    type: 'INITIAL_ONBOARDING',
    status: ImportJobStatus.READY,
    schemaVersion: 'v1',
    previewVersion: 1,
    fileName: 'onboarding.xlsx',
    fileSize: 1234,
    fileMimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    fileHash: 'file-hash',
    previewHash: 'preview-hash',
    originalObjectKey: 'imports/import-1/original.xlsx',
    normalizedObjectKey: 'imports/import-1/normalized.json',
    summary: createPreviewSummary(),
    counts: createPreviewSummary(),
    canConfirm: true,
    expiresAt: new Date('2030-01-01T00:00:00.000Z'),
    confirmingAt: null,
    confirmingLockExpiresAt: null,
    confirmingByMembershipId: null,
    confirmedAt: null,
    confirmedByMembershipId: null,
    confirmationSummary: null,
    confirmationResult: null,
    errorCode: null,
    errorMessage: null,
    createdByMembershipId: 'membership-1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    issues: [],
    ...overrides,
  };
}

function createTransactionMocks() {
  return {
    importJob: {
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    building: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'building-1' }),
    },
    unitCategory: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'category-1' }),
    },
    unit: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'unit-1' }),
      update: jest.fn().mockResolvedValue({ id: 'unit-1' }),
    },
    externalEntityReference: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({}),
    },
    tenantMember: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'member-1' }),
      update: jest.fn().mockResolvedValue({ id: 'member-1' }),
    },
    user: {
      findMany: jest.fn().mockResolvedValue([{ id: 'user-1', email: 'resident@example.com', name: 'Residente Uno' }]),
    },
    unitOccupant: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'occupant-1' }),
    },
    charge: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'charge-1' }),
    },
  };
}

function createPrismaKnownError(code: string, target: string[]): Prisma.PrismaClientKnownRequestError {
  const error = new Error(`Prisma ${code}`);
  Object.assign(error, { code, meta: { target } });
  Object.setPrototypeOf(error, Prisma.PrismaClientKnownRequestError.prototype);
  return error as Prisma.PrismaClientKnownRequestError;
}

describe('OnboardingImportConfirmationService', () => {
  const auditService = {
    createLog: jest.fn().mockResolvedValue(undefined),
    createLogRequired: jest.fn().mockResolvedValue(undefined),
  } as unknown as Pick<AuditService, 'createLog' | 'createLogRequired'>;
  const prisma = {
    importJob: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  } as unknown as PrismaService;
  const minio = {
    getObjectBuffer: jest.fn(),
  } as unknown as Pick<MinioService, 'getObjectBuffer'>;
  const normalizer = {
    normalizeText: jest.fn((value: unknown) => (typeof value === 'string' ? value.trim() : null)),
  } as unknown as OnboardingImportNormalizerService;

  let service: OnboardingImportConfirmationService;

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.importJob.findFirst as jest.Mock).mockReset();
    (prisma.importJob.updateMany as jest.Mock).mockReset();
    (prisma.$transaction as jest.Mock).mockReset();
    service = new OnboardingImportConfirmationService(
      prisma,
      minio as MinioService,
      auditService as AuditService,
      normalizer,
    );
  });

  it('confirms a ready import transactionally and persists the confirmation result', async () => {
    const currentJob = createCurrentJob();
    const { payload, serialized } = createPayload(currentJob.id, currentJob.tenantId, currentJob.fileHash);
    const previewHash = createHash('sha256').update(serialized, 'utf8').digest('hex');
    currentJob.previewHash = previewHash;

    const confirmedJob = {
      ...currentJob,
      status: ImportJobStatus.CONFIRMING,
      confirmingLockExpiresAt: new Date('2030-01-01T00:05:00.000Z'),
    };

    (prisma.importJob.findFirst as jest.Mock)
      .mockResolvedValueOnce(currentJob)
      .mockResolvedValueOnce(confirmedJob);
    (prisma.importJob.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (minio.getObjectBuffer as jest.Mock).mockResolvedValue(Buffer.from(serialized, 'utf8'));

    const tx = createTransactionMocks();
    (tx.importJob.findFirst as jest.Mock).mockResolvedValue(confirmedJob);
    (prisma.$transaction as jest.Mock).mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));

    const result = await service.confirmImport({
      tenantId: currentJob.tenantId,
      tenantCurrency: 'ARS',
      userId: 'user-admin',
      membershipId: 'membership-1',
      roles: [Role.TENANT_ADMIN],
      isSuperAdmin: false,
      importId: currentJob.id,
      expectedPreviewVersion: 1,
    });

    expect(result).toMatchObject({
      importId: currentJob.id,
      status: 'CONFIRMED',
      summary: {
        buildingsCreated: 1,
        unitCategoriesCreated: 1,
        unitsCreated: 1,
        peopleCreated: 1,
        relationsCreated: 1,
        chargesCreated: 1,
      },
    });
    expect(result.confirmedAt).toEqual(expect.any(String));

    expect(prisma.importJob.updateMany).toHaveBeenCalledWith({
      where: {
        id: currentJob.id,
        tenantId: currentJob.tenantId,
        status: ImportJobStatus.READY,
        canConfirm: true,
        confirmedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      data: {
        status: ImportJobStatus.CONFIRMING,
        confirmingAt: expect.any(Date),
        confirmingLockExpiresAt: expect.any(Date),
        confirmingByMembershipId: 'membership-1',
      },
    });
    expect(tx.importJob.update).toHaveBeenCalledWith({
      where: { id: currentJob.id },
      data: expect.objectContaining({
        status: ImportJobStatus.CONFIRMED,
        confirmedByMembershipId: 'membership-1',
        confirmingAt: null,
        confirmingLockExpiresAt: null,
        confirmingByMembershipId: null,
        canConfirm: false,
      }),
    });
    expect(tx.building.create).toHaveBeenCalledWith({
      data: {
        tenantId: currentJob.tenantId,
        alias: 'A',
        name: 'Torre A',
        address: 'Av. Principal 123',
      },
    });
    expect(tx.unitCategory.create).toHaveBeenCalledWith({
      data: {
        tenantId: currentJob.tenantId,
        buildingId: 'building-1',
        name: 'Premium',
        minM2: 80,
        maxM2: 80.01,
        coefficient: 1.5,
        active: true,
      },
    });
    expect(tx.tenantMember.create).toHaveBeenCalledWith({
      data: {
        tenantId: currentJob.tenantId,
        name: 'Residente Uno',
        email: 'resident@example.com',
        phone: '555-0101',
        role: Role.RESIDENT,
        status: MemberStatus.ACTIVE,
        userId: 'user-1',
      },
    });
    expect(tx.unitOccupant.create).toHaveBeenCalledWith({
      data: {
        tenantId: currentJob.tenantId,
        unitId: 'unit-1',
        memberId: 'member-1',
        role: UnitOccupantRole.RESIDENT,
        isPrimary: true,
        startDate: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    expect(tx.charge.create).toHaveBeenCalledWith({
      data: {
        tenantId: currentJob.tenantId,
        buildingId: 'building-1',
        unitId: 'unit-1',
        period: '2026-01',
        type: expect.any(String),
        concept: 'Initial charge',
        amount: 1500,
        currency: 'ARS',
        dueDate: new Date('2026-01-15T00:00:00.000Z'),
        status: expect.any(String),
        createdByMembershipId: 'membership-1',
        importJobId: currentJob.id,
      },
    });
    expect(
      (tx.externalEntityReference.upsert as jest.Mock).mock.calls.map(([args]) => args),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          where: {
            tenantId_source_entityType_externalCode: {
              tenantId: currentJob.tenantId,
              source: 'onboarding-import',
              entityType: 'PERSON',
              externalCode: 'P-1',
            },
          },
          update: { entityId: 'member-1' },
          create: {
            tenantId: currentJob.tenantId,
            source: 'onboarding-import',
            entityType: 'PERSON',
            externalCode: 'P-1',
            entityId: 'member-1',
          },
        }),
        expect.objectContaining({
          where: {
            tenantId_source_entityType_externalCode: {
              tenantId: currentJob.tenantId,
              source: 'onboarding-import',
              entityType: 'PERSON_DOCUMENT',
              externalCode: 'V-12345678',
            },
          },
          update: { entityId: 'member-1' },
          create: {
            tenantId: currentJob.tenantId,
            source: 'onboarding-import',
            entityType: 'PERSON_DOCUMENT',
            externalCode: 'V-12345678',
            entityId: 'member-1',
          },
        }),
      ]),
    );
    expect(auditService.createLogRequired).toHaveBeenCalledTimes(2);
    expect(auditService.createLogRequired).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ action: AuditAction.IMPORT_CONFIRM_STARTED }),
      tx,
    );
    expect(auditService.createLogRequired).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ action: AuditAction.IMPORT_CONFIRMED }),
      tx,
    );
  });

  it('loads members referenced only by document refs when confirming people', async () => {
    const currentJob = createCurrentJob();
    const { payload } = createPayload(currentJob.id, currentJob.tenantId, currentJob.fileHash);
    payload.data.people[0].normalized.email = null;
    payload.data.people[0].normalized.telefono = null;
    payload.data.people[0].raw.email = '';
    payload.data.people[0].raw.telefono = '';
    const serialized = JSON.stringify(payload);
    const previewHash = createHash('sha256').update(serialized, 'utf8').digest('hex');
    currentJob.previewHash = previewHash;

    const confirmingJob = {
      ...currentJob,
      status: ImportJobStatus.CONFIRMING,
      confirmingLockExpiresAt: new Date('2030-01-01T00:05:00.000Z'),
    };

    (prisma.importJob.findFirst as jest.Mock)
      .mockResolvedValueOnce(currentJob)
      .mockResolvedValueOnce(confirmingJob);
    (prisma.importJob.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (minio.getObjectBuffer as jest.Mock).mockResolvedValue(Buffer.from(serialized, 'utf8'));

    const tx = createTransactionMocks();
    (tx.externalEntityReference.findMany as jest.Mock).mockResolvedValue([
      {
        entityType: 'PERSON_DOCUMENT',
        externalCode: 'V-12345678',
        entityId: 'member-1',
      },
    ]);
    (tx.tenantMember.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'member-1',
        tenantId: currentJob.tenantId,
        userId: null,
        name: 'Residente Uno',
        email: null,
        phone: null,
        role: Role.RESIDENT,
        status: MemberStatus.ACTIVE,
      },
    ]);
    (tx.user.findMany as jest.Mock).mockResolvedValue([]);
    (tx.importJob.findFirst as jest.Mock).mockResolvedValue(confirmingJob);
    (prisma.$transaction as jest.Mock).mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));

    const result = await service.confirmImport({
      tenantId: currentJob.tenantId,
      tenantCurrency: 'ARS',
      userId: 'user-admin',
      membershipId: 'membership-1',
      roles: [Role.TENANT_ADMIN],
      isSuperAdmin: false,
      importId: currentJob.id,
      expectedPreviewVersion: 1,
    });

    expect(result.summary.peopleReused).toBe(1);
    expect(tx.tenantMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              id: {
                in: ['member-1'],
              },
            }),
          ]),
        }),
      }),
    );
    expect(tx.externalEntityReference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId_source_entityType_externalCode: {
            tenantId: currentJob.tenantId,
            source: 'onboarding-import',
            entityType: 'PERSON_DOCUMENT',
            externalCode: 'V-12345678',
          },
        },
        update: { entityId: 'member-1' },
        create: {
          tenantId: currentJob.tenantId,
          source: 'onboarding-import',
          entityType: 'PERSON_DOCUMENT',
          externalCode: 'V-12345678',
          entityId: 'member-1',
        },
      }),
    );
  });

  it('rejects a document ref that belongs to another member before updating the candidate', async () => {
    const currentJob = createCurrentJob();
    const { serialized } = createPayload(currentJob.id, currentJob.tenantId, currentJob.fileHash);
    const previewHash = createHash('sha256').update(serialized, 'utf8').digest('hex');
    currentJob.previewHash = previewHash;

    const confirmingJob = {
      ...currentJob,
      status: ImportJobStatus.CONFIRMING,
      confirmingLockExpiresAt: new Date('2030-01-01T00:05:00.000Z'),
    };

    (prisma.importJob.findFirst as jest.Mock)
      .mockResolvedValueOnce(currentJob)
      .mockResolvedValueOnce(confirmingJob);
    (prisma.importJob.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (minio.getObjectBuffer as jest.Mock).mockResolvedValue(Buffer.from(serialized, 'utf8'));

    const tx = createTransactionMocks();
    (tx.externalEntityReference.findMany as jest.Mock).mockResolvedValue([
      {
        entityType: 'PERSON',
        externalCode: 'P-1',
        entityId: 'member-1',
      },
      {
        entityType: 'PERSON_DOCUMENT',
        externalCode: 'V-12345678',
        entityId: 'member-2',
      },
    ]);
    (tx.tenantMember.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'member-1',
        tenantId: currentJob.tenantId,
        userId: 'user-1',
        name: 'Residente Uno',
        email: 'resident@example.com',
        phone: '555-0101',
        role: Role.RESIDENT,
        status: MemberStatus.ACTIVE,
      },
      {
        id: 'member-2',
        tenantId: currentJob.tenantId,
        userId: null,
        name: 'Otra Persona',
        email: null,
        phone: null,
        role: Role.RESIDENT,
        status: MemberStatus.ACTIVE,
      },
    ]);
    (tx.user.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'user-1',
        email: 'resident@example.com',
        name: 'Residente Uno',
      },
    ]);
    (tx.importJob.findFirst as jest.Mock).mockResolvedValue(confirmingJob);
    (prisma.$transaction as jest.Mock).mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));

    await expect(service.confirmImport({
      tenantId: currentJob.tenantId,
      tenantCurrency: 'ARS',
      userId: 'user-admin',
      membershipId: 'membership-1',
      roles: [Role.TENANT_ADMIN],
      isSuperAdmin: false,
      importId: currentJob.id,
      expectedPreviewVersion: 1,
    })).rejects.toThrow('document en el tenant');

    expect(tx.tenantMember.update).not.toHaveBeenCalled();
    expect(
      (tx.externalEntityReference.upsert as jest.Mock).mock.calls.some(([args]) => (
        args?.where?.tenantId_source_entityType_externalCode?.entityType === 'PERSON_DOCUMENT'
      )),
    ).toBe(false);
  });

  it('returns the stored result when the import was already confirmed', async () => {
    const currentJob = {
      ...createCurrentJob(),
      status: ImportJobStatus.CONFIRMED,
      confirmedAt: new Date('2030-01-01T00:00:00.000Z'),
      confirmedByMembershipId: 'membership-1',
      confirmationResult: {
        importId: 'import-1',
        status: 'CONFIRMED',
        confirmedAt: '2030-01-01T00:00:00.000Z',
        summary: createConfirmationSummary(),
      },
    };

    (prisma.importJob.findFirst as jest.Mock).mockResolvedValue(currentJob);

    const result = await service.confirmImport({
      tenantId: currentJob.tenantId,
      tenantCurrency: 'ARS',
      userId: 'user-admin',
      membershipId: 'membership-1',
      roles: [Role.TENANT_ADMIN],
      isSuperAdmin: false,
      importId: currentJob.id,
    });

    expect(result).toEqual({
      importId: currentJob.id,
      status: 'CONFIRMED',
      confirmedAt: '2030-01-01T00:00:00.000Z',
      summary: createConfirmationSummary(),
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(auditService.createLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.IMPORT_RECONFIRM_ATTEMPT }),
    );
  });

  it('translates a post-preview P2002 into a sanitized conflict and preserves rollback', async () => {
    const currentJob = createCurrentJob();
    const { serialized } = createPayload(currentJob.id, currentJob.tenantId, currentJob.fileHash);
    const previewHash = createHash('sha256').update(serialized, 'utf8').digest('hex');
    currentJob.previewHash = previewHash;

    const confirmingJob = {
      ...currentJob,
      status: ImportJobStatus.CONFIRMING,
      confirmingLockExpiresAt: new Date('2030-01-01T00:05:00.000Z'),
    };

    (prisma.importJob.findFirst as jest.Mock)
      .mockResolvedValueOnce(currentJob)
      .mockResolvedValueOnce(confirmingJob);
    (prisma.importJob.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (minio.getObjectBuffer as jest.Mock).mockResolvedValue(Buffer.from(serialized, 'utf8'));

    const tx = createTransactionMocks();
    const uniqueError = new Error('Unique constraint failed on the fields: (`tenantId`,`phone`)');
    Object.assign(uniqueError, { code: 'P2002', meta: { target: ['tenantId', 'phone'] } });
    Object.setPrototypeOf(uniqueError, Prisma.PrismaClientKnownRequestError.prototype);
    (tx.tenantMember.create as jest.Mock).mockRejectedValueOnce(uniqueError);
    (tx.importJob.findFirst as jest.Mock).mockResolvedValue(confirmingJob);
    (prisma.$transaction as jest.Mock).mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));

    await expect(service.confirmImport({
      tenantId: currentJob.tenantId,
      tenantCurrency: 'ARS',
      userId: 'user-admin',
      membershipId: 'membership-1',
      roles: [Role.TENANT_ADMIN],
      isSuperAdmin: false,
      importId: currentJob.id,
      expectedPreviewVersion: 1,
    })).rejects.toThrow(ConflictException);

    expect(tx.importJob.update).not.toHaveBeenCalled();
    expect(prisma.importJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: currentJob.id, tenantId: currentJob.tenantId }),
        data: expect.objectContaining({
          status: ImportJobStatus.FAILED,
          confirmingAt: null,
          confirmingLockExpiresAt: null,
          confirmingByMembershipId: null,
          canConfirm: false,
        }),
      }),
    );
    expect(auditService.createLogRequired).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.IMPORT_CONFIRM_STARTED }),
      tx,
    );
    expect(auditService.createLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.IMPORT_CONFIRM_FAILED }),
    );
  });

  it('sanitizes unknown P2002 targets without exposing constraint details', async () => {
    const currentJob = createCurrentJob();
    const { serialized } = createPayload(currentJob.id, currentJob.tenantId, currentJob.fileHash);
    const previewHash = createHash('sha256').update(serialized, 'utf8').digest('hex');
    currentJob.previewHash = previewHash;

    const confirmingJob = {
      ...currentJob,
      status: ImportJobStatus.CONFIRMING,
      confirmingLockExpiresAt: new Date('2030-01-01T00:05:00.000Z'),
    };

    (prisma.importJob.findFirst as jest.Mock)
      .mockResolvedValueOnce(currentJob)
      .mockResolvedValueOnce(confirmingJob);
    (prisma.importJob.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (minio.getObjectBuffer as jest.Mock).mockResolvedValue(Buffer.from(serialized, 'utf8'));

    const tx = createTransactionMocks();
    (tx.importJob.findFirst as jest.Mock).mockResolvedValue(confirmingJob);
    (tx.tenantMember.create as jest.Mock).mockRejectedValueOnce(createPrismaKnownError('P2002', ['tenantId', 'email', 'status']));
    (prisma.$transaction as jest.Mock).mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));

    await expect(service.confirmImport({
      tenantId: currentJob.tenantId,
      tenantCurrency: 'ARS',
      userId: 'user-admin',
      membershipId: 'membership-1',
      roles: [Role.TENANT_ADMIN],
      isSuperAdmin: false,
      importId: currentJob.id,
      expectedPreviewVersion: 1,
    })).rejects.toThrow('Error de base de datos durante la confirmación');

    expect(tx.importJob.update).not.toHaveBeenCalled();
    expect(auditService.createLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.IMPORT_CONFIRM_FAILED }),
    );
  });

  it('sanitizes Prisma errors that are not P2002', async () => {
    const currentJob = createCurrentJob();
    const { serialized } = createPayload(currentJob.id, currentJob.tenantId, currentJob.fileHash);
    const previewHash = createHash('sha256').update(serialized, 'utf8').digest('hex');
    currentJob.previewHash = previewHash;

    const confirmingJob = {
      ...currentJob,
      status: ImportJobStatus.CONFIRMING,
      confirmingLockExpiresAt: new Date('2030-01-01T00:05:00.000Z'),
    };

    (prisma.importJob.findFirst as jest.Mock)
      .mockResolvedValueOnce(currentJob)
      .mockResolvedValueOnce(confirmingJob);
    (prisma.importJob.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (minio.getObjectBuffer as jest.Mock).mockResolvedValue(Buffer.from(serialized, 'utf8'));

    const tx = createTransactionMocks();
    const prismaError = new Error('Prisma failed');
    Object.assign(prismaError, { code: 'P2025' });
    Object.setPrototypeOf(prismaError, Prisma.PrismaClientKnownRequestError.prototype);
    (tx.tenantMember.create as jest.Mock).mockRejectedValueOnce(prismaError);
    (tx.importJob.findFirst as jest.Mock).mockResolvedValue(confirmingJob);
    (prisma.$transaction as jest.Mock).mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));

    await expect(service.confirmImport({
      tenantId: currentJob.tenantId,
      tenantCurrency: 'ARS',
      userId: 'user-admin',
      membershipId: 'membership-1',
      roles: [Role.TENANT_ADMIN],
      isSuperAdmin: false,
      importId: currentJob.id,
      expectedPreviewVersion: 1,
    })).rejects.toThrow('Error de base de datos durante la confirmación');

    expect(tx.importJob.update).not.toHaveBeenCalled();
  });

  it('propagates non-Prisma errors without converting them into conflicts', async () => {
    const currentJob = createCurrentJob();
    const { serialized } = createPayload(currentJob.id, currentJob.tenantId, currentJob.fileHash);
    const previewHash = createHash('sha256').update(serialized, 'utf8').digest('hex');
    currentJob.previewHash = previewHash;

    const confirmingJob = {
      ...currentJob,
      status: ImportJobStatus.CONFIRMING,
      confirmingLockExpiresAt: new Date('2030-01-01T00:05:00.000Z'),
    };

    (prisma.importJob.findFirst as jest.Mock)
      .mockResolvedValueOnce(currentJob)
      .mockResolvedValueOnce(confirmingJob);
    (prisma.importJob.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (minio.getObjectBuffer as jest.Mock).mockResolvedValue(Buffer.from(serialized, 'utf8'));

    const tx = createTransactionMocks();
    (tx.importJob.findFirst as jest.Mock).mockResolvedValue(confirmingJob);
    (tx.tenantMember.create as jest.Mock).mockRejectedValueOnce(new Error('unexpected failure'));
    (prisma.$transaction as jest.Mock).mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));

    await expect(service.confirmImport({
      tenantId: currentJob.tenantId,
      tenantCurrency: 'ARS',
      userId: 'user-admin',
      membershipId: 'membership-1',
      roles: [Role.TENANT_ADMIN],
      isSuperAdmin: false,
      importId: currentJob.id,
      expectedPreviewVersion: 1,
    })).rejects.toThrow('unexpected failure');
  });

  it('rejects a stale preview version before any write', async () => {
    const currentJob = createCurrentJob();
    (prisma.importJob.findFirst as jest.Mock).mockResolvedValue(currentJob);

    await expect(service.confirmImport({
      tenantId: currentJob.tenantId,
      tenantCurrency: 'ARS',
      userId: 'user-admin',
      membershipId: 'membership-1',
      roles: [Role.TENANT_ADMIN],
      isSuperAdmin: false,
      importId: currentJob.id,
      expectedPreviewVersion: 2,
    })).rejects.toThrow('La vista previa quedó desactualizada; genere una nueva confirmación');

    expect(minio.getObjectBuffer).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
