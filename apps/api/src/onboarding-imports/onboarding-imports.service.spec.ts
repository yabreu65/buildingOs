import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { MinioService } from '../storage/minio.service';
import {
  ImportJobStatus,
  type Role,
} from '@prisma/client';
import { OnboardingImportsService } from './onboarding-imports.service';
import { OnboardingImportConfirmationService } from './services/onboarding-import-confirmation.service';
import { OnboardingImportNormalizerService } from './services/onboarding-import-normalizer.service';
import { OnboardingImportParserService } from './services/onboarding-import-parser.service';
import { OnboardingImportTemplateService } from './services/onboarding-import-template.service';
import type { AuthenticatedUser } from '../common/types/request.types';
import type { ImportPreviewSummary, ParsedWorkbookData, UploadableSpreadsheetFile } from './types/onboarding-import.types';

function createSheetStats() {
  return { total: 0, new: 0, reusable: 0, conflict: 0, invalid: 0 };
}

function createSummary(overrides: Partial<ImportPreviewSummary> = {}): ImportPreviewSummary {
  return {
    buildings: createSheetStats(),
    units: createSheetStats(),
    people: createSheetStats(),
    relations: createSheetStats(),
    openingBalances: createSheetStats(),
    blockingIssues: 0,
    warnings: 0,
    ...overrides,
  };
}

function buildUser(roles: Role[]): AuthenticatedUser {
  return {
    id: 'user-1',
    email: 'user@example.com',
    name: 'User',
    memberships: [
      {
        id: 'membership-1',
        tenantId: 'tenant-1',
        roles,
      },
    ],
    roles,
    membershipId: 'membership-1',
    tenantId: 'tenant-1',
  };
}

function createWriteGuards() {
  return {
    create: jest.fn(),
    createMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  };
}

function buildParsedData(currentPeriod: string): ParsedWorkbookData {
  return {
    buildings: [
      {
        sheet: 'Edificios',
        rowNumber: 2,
        raw: { codigo: 'A', nombre: 'Torre A', direccion: 'Av. Principal 123' },
        normalized: { codigo: 'A', nombre: 'Torre A', direccion: 'Av. Principal 123' },
      },
    ],
    units: [
      {
        sheet: 'Unidades',
        rowNumber: 2,
        raw: {
          edificio_codigo: 'A',
          codigo: 'A-01-01',
          etiqueta: 'Apartamento 1',
          tipo: 'APARTAMENTO',
          m2: 72.5,
          facturacion: 'SI',
          categoria_nombre: 'Standard',
          coeficiente: 1,
        },
        normalized: {
          edificioCodigo: 'A',
          codigo: 'A-01-01',
          etiqueta: 'Apartamento 1',
          tipo: 'APARTAMENTO',
          m2: 72.5,
          facturacion: true,
          categoriaNombre: 'Standard',
          coeficiente: 1,
        },
      },
      {
        sheet: 'Unidades',
        rowNumber: 3,
        raw: {
          edificio_codigo: 'A',
          codigo: 'A-01-02',
          etiqueta: 'Apartamento 2',
          tipo: 'APARTAMENTO',
          m2: 64,
          facturacion: 'SI',
          categoria_nombre: 'Standard',
          coeficiente: 1,
        },
        normalized: {
          edificioCodigo: 'A',
          codigo: 'A-01-02',
          etiqueta: 'Apartamento 2',
          tipo: 'APARTAMENTO',
          m2: 64,
          facturacion: true,
          categoriaNombre: 'Standard',
          coeficiente: 1,
        },
      },
    ],
    people: [
      {
        sheet: 'Personas',
        rowNumber: 2,
        raw: {
          persona_codigo: 'P-001',
          nombre: 'Existing Person',
          email: 'existing@buildingos.test',
          telefono: '+58 412 1111111',
          documento: 'V-1',
        },
        normalized: {
          personaCodigo: 'P-001',
          nombre: 'Existing Person',
          email: 'existing@buildingos.test',
          telefono: '+58 412 1111111',
          documento: 'V-1',
        },
      },
      {
        sheet: 'Personas',
        rowNumber: 3,
        raw: {
          persona_codigo: 'P-002',
          nombre: 'New Resident',
          email: 'new@buildingos.test',
          telefono: null,
          documento: null,
        },
        normalized: {
          personaCodigo: 'P-002',
          nombre: 'New Resident',
          email: 'new@buildingos.test',
          telefono: null,
          documento: null,
        },
      },
    ],
    relations: [
      {
        sheet: 'Relaciones_Unidad',
        rowNumber: 2,
        raw: {
          persona_codigo: 'P-001',
          edificio_codigo: 'A',
          unidad_codigo: 'A-01-01',
          rol: 'OWNER',
          principal: 'SI',
          fecha_inicio: '2026-01-01',
        },
        normalized: {
          personaCodigo: 'P-001',
          edificioCodigo: 'A',
          unidadCodigo: 'A-01-01',
          rol: 'OWNER',
          principal: true,
          startDate: '2026-01-01',
        },
      },
      {
        sheet: 'Relaciones_Unidad',
        rowNumber: 3,
        raw: {
          persona_codigo: 'P-002',
          edificio_codigo: 'A',
          unidad_codigo: 'A-01-02',
          rol: 'RESIDENT',
          principal: 'NO',
          fecha_inicio: '2026-01-01',
        },
        normalized: {
          personaCodigo: 'P-002',
          edificioCodigo: 'A',
          unidadCodigo: 'A-01-02',
          rol: 'RESIDENT',
          principal: false,
          startDate: '2026-01-01',
        },
      },
    ],
    openingBalances: [
      {
        sheet: 'Saldos_Iniciales',
        rowNumber: 2,
        raw: {
          edificio_codigo: 'A',
          unidad_codigo: 'A-01-01',
          periodo: currentPeriod,
          concepto: 'Saldo inicial',
          monto: 15000,
          moneda: 'ARS',
          vencimiento: `${currentPeriod}-15`,
          tipo: 'DEBITO',
        },
        normalized: {
          edificioCodigo: 'A',
          unidadCodigo: 'A-01-01',
          period: currentPeriod,
          concept: 'Saldo inicial',
          amountMinor: 15000,
          currency: 'ARS',
          dueDate: `${currentPeriod}-15`,
          kind: 'DEBITO',
        },
      },
      {
        sheet: 'Saldos_Iniciales',
        rowNumber: 3,
        raw: {
          edificio_codigo: 'A',
          unidad_codigo: 'A-01-02',
          periodo: currentPeriod,
          concepto: 'Saldo inicial',
          monto: 7000,
          moneda: 'ARS',
          vencimiento: `${currentPeriod}-15`,
          tipo: 'DEBITO',
        },
        normalized: {
          edificioCodigo: 'A',
          unidadCodigo: 'A-01-02',
          period: currentPeriod,
          concept: 'Saldo inicial',
          amountMinor: 7000,
          currency: 'ARS',
          dueDate: `${currentPeriod}-15`,
          kind: 'DEBITO',
        },
      },
    ],
  };
}

describe('OnboardingImportsService', () => {
  let service: OnboardingImportsService;
  let prisma: {
    tenant: { findUnique: jest.Mock };
    importJob: { findUnique: jest.Mock; upsert: jest.Mock };
    importIssue: { findMany: jest.Mock; count: jest.Mock };
    building: { findMany: jest.Mock };
    unitCategory: { findMany: jest.Mock };
    unit: { findMany: jest.Mock };
    externalEntityReference: { findMany: jest.Mock };
    tenantMember: { findMany: jest.Mock };
    user: { findMany: jest.Mock };
    unitOccupant: { findMany: jest.Mock };
    charge: { findMany: jest.Mock };
    membership: Record<string, jest.Mock>;
    membershipRole: Record<string, jest.Mock>;
    payment: Record<string, jest.Mock>;
    liquidation: Record<string, jest.Mock>;
    expensePeriod: Record<string, jest.Mock>;
    adjustment: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  };
  let minio: { uploadBuffer: jest.Mock; deleteObject: jest.Mock };
  let auditService: { createLog: jest.Mock };
  let confirmationService: { confirmImport: jest.Mock };
  let parserService: { parseWorkbook: jest.Mock };
  let templateService: { createTemplateBuffer: jest.Mock; getTemplateFileName: jest.Mock; getTemplateContentType: jest.Mock };
  let transactionCreate: jest.Mock;
  let transactionIssueCreateMany: jest.Mock;
  let businessWrites: {
    building: ReturnType<typeof createWriteGuards>;
    unitCategory: ReturnType<typeof createWriteGuards>;
    unit: ReturnType<typeof createWriteGuards>;
    externalEntityReference: ReturnType<typeof createWriteGuards>;
    tenantMember: ReturnType<typeof createWriteGuards>;
    user: ReturnType<typeof createWriteGuards>;
    unitOccupant: ReturnType<typeof createWriteGuards>;
    charge: ReturnType<typeof createWriteGuards>;
    membership: ReturnType<typeof createWriteGuards>;
    membershipRole: ReturnType<typeof createWriteGuards>;
    payment: ReturnType<typeof createWriteGuards>;
    liquidation: ReturnType<typeof createWriteGuards>;
    expensePeriod: ReturnType<typeof createWriteGuards>;
    adjustment: ReturnType<typeof createWriteGuards>;
  };

  const tenantId = 'tenant-1';
  const now = new Date();
  const currentPeriod = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

  beforeEach(async () => {
    transactionCreate = jest.fn();
    transactionIssueCreateMany = jest.fn();
    businessWrites = {
      building: createWriteGuards(),
      unitCategory: createWriteGuards(),
      unit: createWriteGuards(),
      externalEntityReference: createWriteGuards(),
      tenantMember: createWriteGuards(),
      user: createWriteGuards(),
      unitOccupant: createWriteGuards(),
      charge: createWriteGuards(),
      membership: createWriteGuards(),
      membershipRole: createWriteGuards(),
      payment: createWriteGuards(),
      liquidation: createWriteGuards(),
      expensePeriod: createWriteGuards(),
      adjustment: createWriteGuards(),
    };

    prisma = {
      tenant: { findUnique: jest.fn() },
      importJob: { findUnique: jest.fn(), upsert: jest.fn() },
      importIssue: { findMany: jest.fn(), count: jest.fn() },
      building: { findMany: jest.fn(), ...businessWrites.building },
      unitCategory: { findMany: jest.fn(), ...businessWrites.unitCategory },
      unit: { findMany: jest.fn(), ...businessWrites.unit },
      externalEntityReference: { findMany: jest.fn(), ...businessWrites.externalEntityReference },
      tenantMember: { findMany: jest.fn(), ...businessWrites.tenantMember },
      user: { findMany: jest.fn(), ...businessWrites.user },
      unitOccupant: { findMany: jest.fn(), ...businessWrites.unitOccupant },
      charge: { findMany: jest.fn(), ...businessWrites.charge },
      membership: { ...businessWrites.membership },
      membershipRole: { ...businessWrites.membershipRole },
      payment: { ...businessWrites.payment },
      liquidation: { ...businessWrites.liquidation },
      expensePeriod: { ...businessWrites.expensePeriod },
      adjustment: { ...businessWrites.adjustment },
      $transaction: jest.fn(async (callback: (tx: { importJob: { create: jest.Mock }; importIssue: { createMany: jest.Mock } }) => Promise<unknown>) => {
        return callback({
          importJob: { create: transactionCreate },
          importIssue: { createMany: transactionIssueCreateMany },
        });
      }),
    };

    minio = {
      uploadBuffer: jest.fn().mockResolvedValue(undefined),
      deleteObject: jest.fn().mockResolvedValue(undefined),
    };

    auditService = {
      createLog: jest.fn().mockResolvedValue(undefined),
    };

    confirmationService = {
      confirmImport: jest.fn(),
    };

    parserService = {
      parseWorkbook: jest.fn(),
    };

    templateService = {
      createTemplateBuffer: jest.fn().mockReturnValue(Buffer.from('template')),
      getTemplateFileName: jest.fn().mockReturnValue('buildingos-importacion-inicial-v1.xlsx'),
      getTemplateContentType: jest.fn().mockReturnValue('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OnboardingImportsService,
        OnboardingImportNormalizerService,
        { provide: PrismaService, useValue: prisma },
        { provide: MinioService, useValue: minio },
        { provide: AuditService, useValue: auditService },
        { provide: OnboardingImportConfirmationService, useValue: confirmationService },
        { provide: OnboardingImportParserService, useValue: parserService },
        { provide: OnboardingImportTemplateService, useValue: templateService },
      ],
    }).compile();

    service = module.get(OnboardingImportsService);
  });

  it('reuses an existing preview when the same file hash already exists', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ id: tenantId, currency: 'ARS' });
    prisma.importJob.findUnique.mockResolvedValue({
      id: 'import-1',
      tenantId,
      type: 'INITIAL_ONBOARDING',
      fileName: 'import.xlsx',
      fileHash: 'hash-1',
      schemaVersion: 'v1',
      status: ImportJobStatus.READY,
      canConfirm: true,
      expiresAt: new Date(Date.now() + 86_400_000),
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      updatedAt: new Date('2026-07-01T00:00:00.000Z'),
      summary: createSummary(),
      counts: createSummary(),
      issues: [{ id: 'issue-1' }],
    });

    const result = await service.previewImport(
      { tenantId, user: buildUser(['TENANT_ADMIN']) },
      {
        buffer: Buffer.from('xlsx-data'),
        originalname: 'import.xlsx',
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: 9,
      } as UploadableSpreadsheetFile,
    );

    expect(result.importId).toBe('import-1');
    expect(minio.uploadBuffer).not.toHaveBeenCalled();
    expect(auditService.createLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'IMPORT_PREVIEW_READY' }),
    );
  });

  it('serves the official template and records the access in audit logs', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ id: tenantId, currency: 'ARS' });

    const result = await service.getTemplate({
      tenantId,
      user: buildUser(['TENANT_ADMIN']),
    });

    expect(result.fileName).toBe('buildingos-importacion-inicial-v1.xlsx');
    expect(result.contentType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(result.buffer.equals(Buffer.from('template'))).toBe(true);
    expect(templateService.createTemplateBuffer).toHaveBeenCalledTimes(1);
    expect(auditService.createLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'IMPORT_FILE_LOADED' }),
    );
  });

  it('persists a ready preview and stores the normalized payload only when approved', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ id: tenantId, currency: 'ARS' });
    prisma.importJob.findUnique.mockResolvedValue(null);
    parserService.parseWorkbook.mockReturnValue({ data: buildParsedData(currentPeriod), issues: [] });
    jest.spyOn(service as any, 'validateWorkbook').mockResolvedValue({
      summary: createSummary(),
      issues: [],
    });

    transactionCreate.mockResolvedValue({
      id: 'import-2',
      tenantId,
      type: 'INITIAL_ONBOARDING',
      fileName: 'import.xlsx',
      fileHash: 'hash-2',
      schemaVersion: 'v1',
      status: ImportJobStatus.READY,
      canConfirm: true,
      expiresAt: new Date('2026-08-01T00:00:00.000Z'),
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      updatedAt: new Date('2026-07-01T00:00:00.000Z'),
      summary: createSummary(),
      counts: createSummary(),
      issues: [{ id: 'issue-1' }],
    });

    const result = await service.previewImport(
      { tenantId, user: buildUser(['TENANT_ADMIN']) },
      {
        buffer: Buffer.from('xlsx-data'),
        originalname: 'import.xlsx',
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: 9,
      } as UploadableSpreadsheetFile,
    );

    expect(result.status).toBe(ImportJobStatus.READY);
    expect(minio.uploadBuffer).toHaveBeenCalledTimes(2);
    expect(transactionCreate).toHaveBeenCalledTimes(1);
    expect(transactionIssueCreateMany).not.toHaveBeenCalled();
    expect(auditService.createLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'IMPORT_PREVIEW_READY' }),
    );
  });

  it('persists a blocked preview without storing the normalized payload', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ id: tenantId, currency: 'ARS' });
    prisma.importJob.findUnique.mockResolvedValue(null);
    parserService.parseWorkbook.mockReturnValue({ data: buildParsedData(currentPeriod), issues: [] });
    jest.spyOn(service as any, 'validateWorkbook').mockResolvedValue({
      summary: createSummary({ blockingIssues: 1 }),
      issues: [{
        sheet: 'Edificios',
        row: 2,
        column: 'codigo',
        code: 'CONFLICT_WITH_DB',
        severity: 'BLOCKER',
        message: 'Conflict',
        receivedValue: 'A',
        normalizedValue: 'A',
      }],
    });

    transactionCreate.mockResolvedValue({
      id: 'import-3',
      tenantId,
      type: 'INITIAL_ONBOARDING',
      fileName: 'import.xlsx',
      fileHash: 'hash-3',
      schemaVersion: 'v1',
      status: ImportJobStatus.BLOCKED,
      canConfirm: false,
      expiresAt: new Date('2026-08-01T00:00:00.000Z'),
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      updatedAt: new Date('2026-07-01T00:00:00.000Z'),
      summary: createSummary({ blockingIssues: 1 }),
      counts: createSummary({ blockingIssues: 1 }),
      issues: [{ id: 'issue-1' }],
    });

    const result = await service.previewImport(
      { tenantId, user: buildUser(['TENANT_ADMIN']) },
      {
        buffer: Buffer.from('xlsx-data'),
        originalname: 'import.xlsx',
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: 9,
      } as UploadableSpreadsheetFile,
    );

    expect(result.status).toBe(ImportJobStatus.BLOCKED);
    expect(minio.uploadBuffer).toHaveBeenCalledTimes(1);
    expect(transactionCreate).toHaveBeenCalledTimes(1);
    expect(auditService.createLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'IMPORT_PREVIEW_BLOCKED' }),
    );
  });

  it('persists a failed preview when parsing breaks and keeps the original file upload best effort', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ id: tenantId, currency: 'ARS' });
    prisma.importJob.findUnique.mockResolvedValue(null);
    parserService.parseWorkbook.mockImplementation(() => {
      throw new BadRequestException('Archivo inválido');
    });
    prisma.importJob.upsert.mockResolvedValue(undefined);

    await expect(
      service.previewImport(
        { tenantId, user: buildUser(['TENANT_ADMIN']) },
        {
          buffer: Buffer.from('xlsx-data'),
          originalname: 'import.xlsx',
          mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          size: 9,
        } as UploadableSpreadsheetFile,
      ),
    ).rejects.toThrow(BadRequestException);

    expect(minio.uploadBuffer).toHaveBeenCalledTimes(1);
    expect(prisma.importJob.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ status: ImportJobStatus.FAILED }),
        create: expect.objectContaining({ status: ImportJobStatus.FAILED }),
      }),
    );
    expect(auditService.createLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'IMPORT_PREVIEW_FAILED' }),
    );
  });

  it('rejects residents before reading or persisting the import', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ id: tenantId, currency: 'ARS' });

    await expect(
      service.previewImport(
        { tenantId, user: buildUser(['RESIDENT']) },
        {
          buffer: Buffer.from('xlsx-data'),
          originalname: 'import.xlsx',
          mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          size: 9,
        } as UploadableSpreadsheetFile,
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(minio.uploadBuffer).not.toHaveBeenCalled();
    expect(prisma.importJob.findUnique).not.toHaveBeenCalled();
  });

  it('rejects users without a membership in the requested tenant before any business write can happen', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ id: tenantId, currency: 'ARS' });
    const foreignTenantUser = {
      ...buildUser(['TENANT_ADMIN']),
      memberships: [
        {
          id: 'membership-foreign',
          tenantId: 'tenant-foreign',
          roles: ['TENANT_ADMIN'] as Role[],
        },
      ],
      tenantId: 'tenant-foreign',
    } satisfies AuthenticatedUser;

    await expect(
      service.previewImport(
        { tenantId, user: foreignTenantUser },
        {
          buffer: Buffer.from('xlsx-data'),
          originalname: 'import.xlsx',
          mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          size: 9,
        } as UploadableSpreadsheetFile,
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(minio.uploadBuffer).not.toHaveBeenCalled();
    expect(prisma.importJob.findUnique).not.toHaveBeenCalled();
    expect(businessWrites.building.create).not.toHaveBeenCalled();
    expect(businessWrites.unit.create).not.toHaveBeenCalled();
    expect(businessWrites.unitCategory.create).not.toHaveBeenCalled();
    expect(businessWrites.tenantMember.create).not.toHaveBeenCalled();
    expect(businessWrites.unitOccupant.create).not.toHaveBeenCalled();
    expect(businessWrites.user.create).not.toHaveBeenCalled();
    expect(businessWrites.membership.create).not.toHaveBeenCalled();
    expect(businessWrites.membershipRole.create).not.toHaveBeenCalled();
    expect(businessWrites.charge.create).not.toHaveBeenCalled();
  });

  it('does not leak import existence across tenants when reading an import', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ id: tenantId, currency: 'ARS' });
    const foreignTenantUser = {
      ...buildUser(['TENANT_ADMIN']),
      memberships: [
        {
          id: 'membership-foreign',
          tenantId: 'tenant-foreign',
          roles: ['TENANT_ADMIN'] as Role[],
        },
      ],
      tenantId: 'tenant-foreign',
    } satisfies AuthenticatedUser;

    await expect(
      service.getImport({
        tenantId,
        user: foreignTenantUser,
        importId: 'import-1',
      }),
    ).rejects.toThrow(ForbiddenException);

    expect(prisma.importJob.findUnique).not.toHaveBeenCalled();
  });

  it('classifies records against PostgreSQL without mutating the parsed workbook', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ id: tenantId, currency: 'ARS' });
    prisma.building.findMany.mockResolvedValue([
      {
        id: 'building-1',
        alias: 'A',
        name: 'Torre A',
        address: 'Av. Principal 123',
        deletedAt: null,
      },
    ]);
    prisma.unitCategory.findMany.mockResolvedValue([
      {
        id: 'category-1',
        buildingId: 'building-1',
        name: 'Standard',
        coefficient: 1,
      },
    ]);
    prisma.unit.findMany.mockResolvedValue([
      {
        id: 'unit-1',
        buildingId: 'building-1',
        code: 'A-01-01',
        label: 'Apartamento 1',
        unitType: 'APARTAMENTO',
        m2: 72.5,
        isBillable: true,
      },
    ]);
    prisma.externalEntityReference.findMany.mockResolvedValue([]);
    prisma.tenantMember.findMany.mockResolvedValue([
      {
        id: 'member-1',
        tenantId,
        name: 'Existing Person',
        email: 'existing@buildingos.test',
        phone: '+58 412 1111111',
        role: 'RESIDENT',
        status: 'ACTIVE',
      },
    ]);
    prisma.user.findMany.mockResolvedValue([
      {
        id: 'user-1',
        email: 'existing@buildingos.test',
        name: 'Existing Person',
      },
    ]);
    prisma.unitOccupant.findMany.mockResolvedValue([
      {
        unitId: 'unit-1',
        memberId: 'member-1',
        role: 'OWNER',
        isPrimary: true,
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        endDate: null,
      },
    ]);
    prisma.charge.findMany.mockResolvedValue([
      {
        buildingId: 'building-1',
        unitId: 'unit-1',
        period: currentPeriod,
        concept: 'Saldo inicial',
        amount: 15000,
        currency: 'ARS',
        status: 'ACTIVE',
      },
    ]);

    const parsedData: ParsedWorkbookData = {
      buildings: [
        {
          sheet: 'Edificios',
          rowNumber: 2,
          raw: {
            codigo: 'A',
            nombre: 'Torre A',
            direccion: 'Av. Principal 123',
          },
          normalized: { codigo: 'A', nombre: 'Torre A', direccion: 'Av. Principal 123' },
        },
      ],
      units: [
        {
          sheet: 'Unidades',
          rowNumber: 2,
          raw: {
            edificio_codigo: 'A',
            codigo: 'A-01-01',
            etiqueta: 'Apartamento 1',
            tipo: 'APARTAMENTO',
            m2: 72.5,
            facturacion: 'SI',
            categoria_nombre: 'Standard',
            coeficiente: 1,
          },
          normalized: {
            edificioCodigo: 'A',
            codigo: 'A-01-01',
            etiqueta: 'Apartamento 1',
            tipo: 'APARTAMENTO',
            m2: 72.5,
            facturacion: true,
            categoriaNombre: 'Other',
            coeficiente: 1,
          },
        },
        {
          sheet: 'Unidades',
          rowNumber: 3,
          raw: {
            edificio_codigo: 'A',
            codigo: 'A-01-02',
            etiqueta: 'Apartamento 2',
            tipo: 'APARTAMENTO',
            m2: 64,
            facturacion: 'SI',
            categoria_nombre: 'Other',
            coeficiente: 1,
          },
          normalized: {
            edificioCodigo: 'A',
            codigo: 'A-01-02',
            etiqueta: 'Apartamento 2',
            tipo: 'APARTAMENTO',
            m2: 64,
            facturacion: true,
            categoriaNombre: 'Standard',
            coeficiente: 1,
          },
        },
        {
          sheet: 'Unidades',
          rowNumber: 4,
          raw: {
            edificio_codigo: 'A',
            codigo: 'A-01-03',
            etiqueta: 'Apartamento 3',
            tipo: 'APARTAMENTO',
            m2: 64,
            facturacion: 'SI',
            categoria_nombre: 'Standard',
            coeficiente: 2,
          },
          normalized: {
            edificioCodigo: 'A',
            codigo: 'A-01-03',
            etiqueta: 'Apartamento 3',
            tipo: 'APARTAMENTO',
            m2: 64,
            facturacion: true,
            categoriaNombre: 'Standard',
            coeficiente: 2,
          },
        },
      ],
      people: [
        {
          sheet: 'Personas',
          rowNumber: 2,
          raw: {
            persona_codigo: 'P-001',
            nombre: 'Existing Person',
            email: 'existing@buildingos.test',
            telefono: '+58 412 1111111',
            documento: 'V-1',
          },
          normalized: {
            personaCodigo: 'P-001',
            nombre: 'Existing Person',
            email: 'existing@buildingos.test',
            telefono: '+58 412 1111111',
            documento: 'V-1',
          },
        },
        {
          sheet: 'Personas',
          rowNumber: 3,
          raw: {
            persona_codigo: 'P-002',
            nombre: 'New Resident',
            email: 'new@buildingos.test',
            telefono: null,
            documento: null,
          },
          normalized: {
            personaCodigo: 'P-002',
            nombre: 'New Resident',
            email: 'new@buildingos.test',
            telefono: null,
            documento: null,
          },
        },
      ],
      relations: [
        {
          sheet: 'Relaciones_Unidad',
          rowNumber: 2,
          raw: {
            persona_codigo: 'P-001',
            edificio_codigo: 'A',
            unidad_codigo: 'A-01-01',
            rol: 'OWNER',
            principal: 'SI',
            fecha_inicio: '2026-01-01',
          },
          normalized: {
            personaCodigo: 'P-001',
            edificioCodigo: 'A',
            unidadCodigo: 'A-01-01',
            rol: 'OWNER',
            principal: true,
            startDate: '2026-01-01',
          },
        },
        {
          sheet: 'Relaciones_Unidad',
          rowNumber: 3,
          raw: {
            persona_codigo: 'P-002',
            edificio_codigo: 'A',
            unidad_codigo: 'A-01-02',
            rol: 'RESIDENT',
            principal: 'NO',
            fecha_inicio: '2026-01-01',
          },
          normalized: {
            personaCodigo: 'P-002',
            edificioCodigo: 'A',
            unidadCodigo: 'A-01-02',
            rol: 'RESIDENT',
            principal: false,
            startDate: '2026-01-01',
          },
        },
      ],
      openingBalances: [
        {
          sheet: 'Saldos_Iniciales',
          rowNumber: 2,
          raw: {
            edificio_codigo: 'A',
            unidad_codigo: 'A-01-01',
            periodo: currentPeriod,
            concepto: 'Saldo inicial',
            monto: 15000,
            moneda: 'ARS',
            vencimiento: `${currentPeriod}-15`,
            tipo: 'DEBITO',
          },
          normalized: {
            edificioCodigo: 'A',
            unidadCodigo: 'A-01-01',
            period: currentPeriod,
            concept: 'Saldo inicial',
            amountMinor: 15000,
            currency: 'ARS',
            dueDate: `${currentPeriod}-15`,
            kind: 'DEBITO',
          },
        },
        {
          sheet: 'Saldos_Iniciales',
          rowNumber: 3,
          raw: {
            edificio_codigo: 'A',
            unidad_codigo: 'A-01-02',
            periodo: currentPeriod,
            concepto: 'Saldo inicial',
            monto: 7000,
            moneda: 'ARS',
            vencimiento: `${currentPeriod}-15`,
            tipo: 'DEBITO',
          },
          normalized: {
            edificioCodigo: 'A',
            unidadCodigo: 'A-01-02',
            period: currentPeriod,
            concept: 'Saldo inicial',
            amountMinor: 7000,
            currency: 'ARS',
            dueDate: `${currentPeriod}-15`,
            kind: 'DEBITO',
          },
        },
      ],
    };

    const validation = await (service as any).validateWorkbook(tenantId, 'ARS', parsedData, []);

    expect(validation.summary.buildings.reusable).toBe(1);
    expect(validation.summary.units.reusable).toBe(2);
    expect(validation.summary.units.conflict).toBe(1);
    expect(validation.summary.people.reusable).toBe(1);
    expect(validation.summary.relations.reusable).toBe(1);
    expect(validation.summary.relations.new).toBe(1);
    expect(validation.summary.openingBalances.reusable).toBe(1);
    expect(validation.summary.openingBalances.new).toBe(1);
    expect(validation.issues.some((issue) => issue.code === 'CONFLICT_WITH_DB')).toBe(true);
    expect(businessWrites.building.create).not.toHaveBeenCalled();
    expect(businessWrites.unit.create).not.toHaveBeenCalled();
    expect(businessWrites.unitCategory.create).not.toHaveBeenCalled();
    expect(businessWrites.tenantMember.create).not.toHaveBeenCalled();
    expect(businessWrites.unitOccupant.create).not.toHaveBeenCalled();
    expect(businessWrites.user.create).not.toHaveBeenCalled();
    expect(businessWrites.membership.create).not.toHaveBeenCalled();
    expect(businessWrites.membershipRole.create).not.toHaveBeenCalled();
    expect(businessWrites.charge.create).not.toHaveBeenCalled();
  });
});
