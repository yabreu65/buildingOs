import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  CommunicationsInboxController,
  ResidentCommunicationsController,
} from './communications-user.controller';
import { CommunicationsService } from './communications.service';
import { CommunicationsValidators } from './communications.validators';
import { ResidentAccessService } from '../resident-access/resident-access.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedRequest } from '../common/types/request.types';

const tenantId = 'tenant-1';
const userId = 'user-1';
const buildingId = 'building-1';
const unitId = 'unit-1';
const communicationId = 'comm-1';

function buildReq(
  overrides: Partial<{ headers: Record<string, string | undefined>; user: Record<string, unknown> }> = {},
): AuthenticatedRequest {
  return {
    headers: { 'x-tenant-id': tenantId, ...overrides.headers },
    user: {
      id: userId,
      memberships: [{ tenantId, roles: ['RESIDENT'] }],
      ...overrides.user,
    },
  } as AuthenticatedRequest;
}

describe('ResidentCommunicationsController', () => {
  let service: { findForResidentV2: jest.Mock; markAsReadForResident: jest.Mock };
  let validators: { validateCommunicationBelongsToTenant: jest.Mock };
  let residentAccess: { assertUnitAccess: jest.Mock };
  let prisma: { tenantMember: { findFirst: jest.Mock } };
  let controller: ResidentCommunicationsController;

  beforeEach(() => {
    service = {
      findForResidentV2: jest.fn().mockResolvedValue({ items: [], nextCursor: undefined }),
      markAsReadForResident: jest.fn().mockResolvedValue({ readAt: new Date() }),
    };
    validators = { validateCommunicationBelongsToTenant: jest.fn().mockResolvedValue(undefined) };
    residentAccess = { assertUnitAccess: jest.fn().mockResolvedValue(undefined) };
    prisma = {
      tenantMember: {
        findFirst: jest.fn().mockResolvedValue({ id: 'tenant-member-1' }),
      },
    };
    controller = new ResidentCommunicationsController(
      service as CommunicationsService,
      validators as CommunicationsValidators,
      residentAccess as ResidentAccessService,
      prisma as PrismaService,
    );
  });

  describe('getResidentCommunications', () => {
    it('uses X-Tenant-Id header and not the first membership', async () => {
      const req = buildReq({
        user: {
          id: userId,
          memberships: [
            { tenantId: 'tenant-other', roles: ['RESIDENT'] },
            { tenantId, roles: ['RESIDENT'] },
          ],
        },
      });

      await controller.getResidentCommunications(
        { buildingId, unitId, limit: 10 },
        req,
      );

      expect(service.findForResidentV2).toHaveBeenCalledWith(
        tenantId,
        userId,
        buildingId,
        unitId,
        10,
        undefined,
      );
      expect(prisma.tenantMember.findFirst).toHaveBeenCalledWith({
        where: {
          tenantId,
          userId,
          disabledAt: null,
        },
        select: { id: true },
      });
    });

    it('validates active occupancy via assertUnitAccess', async () => {
      const req = buildReq();

      await controller.getResidentCommunications(
        { buildingId, unitId, limit: 10 },
        req,
      );

      expect(residentAccess.assertUnitAccess).toHaveBeenCalledWith(
        tenantId,
        userId,
        unitId,
        buildingId,
      );
    });

    it('passes tenantId, userId, buildingId, unitId, limit and cursor to service', async () => {
      const req = buildReq();
      const cursor = 'test-cursor';

      await controller.getResidentCommunications(
        { buildingId, unitId, limit: 5, cursor },
        req,
      );

      expect(service.findForResidentV2).toHaveBeenCalledWith(
        tenantId,
        userId,
        buildingId,
        unitId,
        5,
        cursor,
      );
    });

    it('rejects tenant without membership', async () => {
      const req = buildReq({
        headers: { 'x-tenant-id': 'tenant-unknown' },
      });

      await expect(
        controller.getResidentCommunications({ buildingId, unitId, limit: 10 }, req),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects query without buildingId', async () => {
      const req = buildReq();

      await expect(
        controller.getResidentCommunications({ unitId, limit: 10 }, req),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects query without unitId', async () => {
      const req = buildReq();

      await expect(
        controller.getResidentCommunications({ buildingId, limit: 10 }, req),
      ).rejects.toThrow(BadRequestException);
    });

    it('does not call service when assertUnitAccess fails', async () => {
      residentAccess.assertUnitAccess.mockRejectedValue(
        new BadRequestException('Unit not found or does not belong to you'),
      );
      const req = buildReq();

      await expect(
        controller.getResidentCommunications({ buildingId, unitId, limit: 10 }, req),
      ).rejects.toThrow(BadRequestException);

      expect(service.findForResidentV2).not.toHaveBeenCalled();
    });

    it('rejects a disabled membership before calling the service', async () => {
      prisma.tenantMember.findFirst.mockResolvedValueOnce(null);
      const req = buildReq();

      await expect(
        controller.getResidentCommunications({ buildingId, unitId, limit: 10 }, req),
      ).rejects.toThrow(ForbiddenException);

      expect(service.findForResidentV2).not.toHaveBeenCalled();
    });
  });

  describe('markResidentAsRead', () => {
    it('requires X-Tenant-Id header', async () => {
      const req = buildReq({ headers: { 'x-tenant-id': undefined } });

      await expect(
        controller.markResidentAsRead(communicationId, req),
      ).rejects.toThrow(BadRequestException);
    });

    it('selects the matching membership and not the first', async () => {
      const req = buildReq({
        user: {
          id: userId,
          memberships: [
            { tenantId: 'tenant-other', roles: ['RESIDENT'] },
            { tenantId, roles: ['RESIDENT'] },
          ],
        },
      });

      await controller.markResidentAsRead(communicationId, req);

      expect(validators.validateCommunicationBelongsToTenant).toHaveBeenCalledWith(
        tenantId,
        communicationId,
      );
      expect(service.markAsReadForResident).toHaveBeenCalledWith(
        tenantId,
        userId,
        communicationId,
      );
    });

    it('uses the resolved tenantId for validation and marking', async () => {
      const req = buildReq();

      await controller.markResidentAsRead(communicationId, req);

      expect(validators.validateCommunicationBelongsToTenant).toHaveBeenCalledWith(
        tenantId,
        communicationId,
      );
      expect(service.markAsReadForResident).toHaveBeenCalledWith(
        tenantId,
        userId,
        communicationId,
      );
    });

    it('rejects tenant without membership', async () => {
      const req = buildReq({
        headers: { 'x-tenant-id': 'tenant-unknown' },
      });

      await expect(
        controller.markResidentAsRead(communicationId, req),
      ).rejects.toThrow(ForbiddenException);

      expect(validators.validateCommunicationBelongsToTenant).not.toHaveBeenCalled();
      expect(service.markAsReadForResident).not.toHaveBeenCalled();
    });

    it('does not call service when header is missing', async () => {
      const req = buildReq({ headers: { 'x-tenant-id': undefined } });

      await expect(
        controller.markResidentAsRead(communicationId, req),
      ).rejects.toThrow(BadRequestException);

      expect(validators.validateCommunicationBelongsToTenant).not.toHaveBeenCalled();
      expect(service.markAsReadForResident).not.toHaveBeenCalled();
    });
  });
});

describe('CommunicationsInboxController', () => {
  let service: { findForUser: jest.Mock; findOne: jest.Mock; markAsRead: jest.Mock };
  let validators: {
    validateBuildingBelongsToTenant: jest.Mock;
    validateUnitBelongsToTenant: jest.Mock;
    validateCommunicationBelongsToTenant: jest.Mock;
    canUserReadCommunication: jest.Mock;
  };
  let prisma: { tenantMember: { findFirst: jest.Mock } };
  let controller: CommunicationsInboxController;

  beforeEach(() => {
    service = {
      findForUser: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({}),
      markAsRead: jest.fn().mockResolvedValue({ count: 1 }),
    };
    validators = {
      validateBuildingBelongsToTenant: jest.fn().mockResolvedValue(undefined),
      validateUnitBelongsToTenant: jest.fn().mockResolvedValue(undefined),
      validateCommunicationBelongsToTenant: jest.fn().mockResolvedValue(undefined),
      canUserReadCommunication: jest.fn().mockResolvedValue(true),
    };
    prisma = {
      tenantMember: {
        findFirst: jest.fn().mockResolvedValue({ id: 'tenant-member-1' }),
      },
    };
    controller = new CommunicationsInboxController(
      service as CommunicationsService,
      validators as CommunicationsValidators,
      prisma as PrismaService,
    );
  });

  describe('getInbox', () => {
    it('uses X-Tenant-Id and ignores the first membership when resolving the tenant', async () => {
      const req = buildReq({
        user: {
          id: userId,
          memberships: [
            { tenantId: 'tenant-other', roles: ['RESIDENT'] },
            { tenantId, roles: ['RESIDENT'] },
          ],
        },
      });

      await controller.getInbox(req, buildingId, unitId, 'false');

      expect(service.findForUser).toHaveBeenCalledWith(
        tenantId,
        userId,
        ['RESIDENT'],
        expect.objectContaining({
          buildingId,
          unitId,
          readOnly: false,
        }),
      );
      expect(validators.validateBuildingBelongsToTenant).toHaveBeenCalledWith(tenantId, buildingId);
      expect(prisma.tenantMember.findFirst).toHaveBeenCalledWith({
        where: {
          tenantId,
          userId,
          disabledAt: null,
        },
        select: { id: true },
      });
    });

    it('rejects a unit that does not belong to the tenant', async () => {
      validators.validateUnitBelongsToTenant.mockRejectedValueOnce(
        new BadRequestException('Unit not found or does not belong to this tenant'),
      );

      const req = buildReq();

      await expect(
        controller.getInbox(req, buildingId, unitId, 'false'),
      ).rejects.toThrow(BadRequestException);

      expect(service.findForUser).not.toHaveBeenCalled();
    });

    it('rejects a missing tenant header before calling the service', async () => {
      const req = buildReq({
        headers: { 'x-tenant-id': undefined },
      });

      await expect(controller.getInbox(req)).rejects.toThrow(BadRequestException);

      expect(service.findForUser).not.toHaveBeenCalled();
    });

    it('rejects a tenant that the user does not belong to', async () => {
      const req = buildReq({
        headers: { 'x-tenant-id': 'tenant-unknown' },
      });

      await expect(controller.getInbox(req)).rejects.toThrow(ForbiddenException);

      expect(service.findForUser).not.toHaveBeenCalled();
    });

    it('rejects a disabled membership', async () => {
      prisma.tenantMember.findFirst.mockResolvedValueOnce(null);
      const req = buildReq({
      });

      await expect(controller.getInbox(req)).rejects.toThrow(ForbiddenException);

      expect(service.findForUser).not.toHaveBeenCalled();
    });
  });

  describe('getCommunicationDetail', () => {
    it('does not call the service when the tenant header is missing', async () => {
      const req = buildReq({
        headers: { 'x-tenant-id': undefined },
      });

      await expect(controller.getCommunicationDetail(communicationId, req)).rejects.toThrow(
        BadRequestException,
      );

      expect(validators.validateCommunicationBelongsToTenant).not.toHaveBeenCalled();
      expect(service.findOne).not.toHaveBeenCalled();
    });

    it('uses the requested tenant and not memberships[0]', async () => {
      const req = buildReq({
        user: {
          id: userId,
          memberships: [
            { tenantId: 'tenant-other', roles: ['RESIDENT'] },
            { tenantId, roles: ['RESIDENT'] },
          ],
        },
      });

      await controller.getCommunicationDetail(communicationId, req);

      expect(validators.validateCommunicationBelongsToTenant).toHaveBeenCalledWith(
        tenantId,
        communicationId,
      );
      expect(validators.canUserReadCommunication).toHaveBeenCalledWith(
        tenantId,
        userId,
        communicationId,
        ['RESIDENT'],
      );
      expect(service.findOne).toHaveBeenCalledWith(tenantId, communicationId);
    });
  });
});
