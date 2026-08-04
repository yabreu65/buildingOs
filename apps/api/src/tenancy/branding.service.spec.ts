import 'reflect-metadata';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedServiceActor } from '../common/types/request.types';
import { BrandingService } from './branding.service';
import { UpdateBrandingDto } from './dto/branding.dto';

describe('UpdateBrandingDto', () => {
  const validate = (input: Record<string, unknown>) =>
    validateSync(plainToInstance(UpdateBrandingDto, input), {
      whitelist: true,
      forbidUnknownValues: true,
    });

  it('accepts omitted logoFileId', () => {
    expect(validate({ brandName: 'Tenant' })).toHaveLength(0);
  });

  it('accepts null logoFileId as an explicit removal request', () => {
    expect(validate({ logoFileId: null })).toHaveLength(0);
  });

  it('rejects an empty logoFileId', () => {
    const errors = validate({ logoFileId: '' });
    expect(errors.map((error) => error.property)).toContain('logoFileId');
  });

  it('rejects a whitespace-only logoFileId', () => {
    const errors = validate({ logoFileId: '   ' });
    expect(errors.map((error) => error.property)).toContain('logoFileId');
  });
});

describe('BrandingService', () => {
  const tenantId = 'tenant-1';

  const prisma = {
    tenant: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    file: {
      findFirst: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  } satisfies Pick<PrismaService, 'tenant' | 'file' | 'auditLog'>;

  const auditService = {
    createLog: jest.fn().mockResolvedValue(undefined),
  } satisfies Pick<AuditService, 'createLog'>;

  let brandingService: BrandingService;

  const actor = {
    id: 'user-1',
    memberships: [
      {
        tenantId,
        roles: ['TENANT_ADMIN'],
      },
    ],
  } satisfies AuthenticatedServiceActor;

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        BrandingService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    brandingService = moduleRef.get(BrandingService);

    prisma.tenant.findUnique.mockResolvedValue({
      id: tenantId,
      name: 'Tenant 1',
      brandName: 'Tenant One',
      logoFileId: 'file-1',
      primaryColor: '#111111',
      secondaryColor: '#222222',
      theme: 'light',
      emailFooter: 'Footer',
      currency: 'ARS',
      locale: 'es-AR',
    });
    prisma.tenant.update.mockResolvedValue({
      id: tenantId,
      name: 'Tenant 1',
      brandName: 'Tenant One',
      logoFileId: 'file-1',
      primaryColor: '#111111',
      secondaryColor: '#222222',
      theme: 'light',
      emailFooter: 'Footer',
      currency: 'ARS',
      locale: 'es-AR',
    });
    prisma.file.findFirst.mockResolvedValue({
      id: 'file-1',
      tenantId,
      mimeType: 'image/png',
    });
  });

  it('allows null logoFileId to clear the tenant logo without querying files', async () => {
    prisma.tenant.update.mockResolvedValueOnce({
      id: tenantId,
      name: 'Tenant 1',
      brandName: 'Tenant One',
      logoFileId: null,
      primaryColor: '#111111',
      secondaryColor: '#222222',
      theme: 'light',
      emailFooter: 'Footer',
      currency: 'ARS',
      locale: 'es-AR',
    });

    const result = await brandingService.updateBranding(
      tenantId,
      { logoFileId: null },
      actor,
    );

    expect(prisma.file.findFirst).not.toHaveBeenCalled();
    expect(prisma.tenant.update).toHaveBeenCalledWith({
      where: { id: tenantId },
      data: expect.objectContaining({ logoFileId: null }),
    });
    expect(result.logoFileId).toBeNull();
  });

  it('rejects a logo file that belongs to another tenant', async () => {
    prisma.file.findFirst.mockResolvedValueOnce(null);

    await expect(
      brandingService.updateBranding(tenantId, { logoFileId: 'file-2' }, actor),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a missing logo file', async () => {
    prisma.file.findFirst.mockResolvedValueOnce(null);

    await expect(
      brandingService.updateBranding(tenantId, { logoFileId: 'missing-file' }, actor),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a non-image logo file', async () => {
    prisma.file.findFirst.mockResolvedValueOnce({
      id: 'file-1',
      tenantId,
      mimeType: 'application/pdf',
    });

    await expect(
      brandingService.updateBranding(tenantId, { logoFileId: 'file-1' }, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a valid image logo file from the same tenant', async () => {
    prisma.file.findFirst.mockResolvedValueOnce({
      id: 'file-1',
      tenantId,
      mimeType: 'image/png',
    });

    const result = await brandingService.updateBranding(
      tenantId,
      { logoFileId: 'file-1' },
      actor,
    );

    expect(prisma.file.findFirst).toHaveBeenCalledWith({
      where: { id: 'file-1', tenantId },
    });
    expect(prisma.tenant.update).toHaveBeenCalledWith({
      where: { id: tenantId },
      data: expect.objectContaining({ logoFileId: 'file-1' }),
    });
    expect(result.logoFileId).toBe('file-1');
  });
});
