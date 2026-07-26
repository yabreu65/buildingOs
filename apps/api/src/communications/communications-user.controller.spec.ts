import { BadRequestException } from '@nestjs/common';
import { ResidentCommunicationsController } from './communications-user.controller';
import { CommunicationsService } from './communications.service';
import { CommunicationsValidators } from './communications.validators';
import { ResidentAccessService } from '../resident-access/resident-access.service';
import type { AuthenticatedRequest } from '../common/types/request.types';

const tenantId = 'tenant-1';
const userId = 'user-1';
const buildingId = 'building-1';
const unitId = 'unit-1';
const communicationId = 'comm-1';

function buildReq(
  overrides: Partial<{ headers: Record<string, string>; user: Record<string, unknown> }> = {},
): AuthenticatedRequest {
  return {
    headers: { 'x-tenant-id': tenantId, ...overrides.headers },
    user: {
      id: userId,
      memberships: [{ tenantId, roles: ['RESIDENT'] }],
      ...overrides.user,
    },
  } as unknown as AuthenticatedRequest;
}

describe('ResidentCommunicationsController', () => {
  let service: { findForResidentV2: jest.Mock; markAsReadForResident: jest.Mock };
  let validators: { validateCommunicationBelongsToTenant: jest.Mock };
  let residentAccess: { assertUnitAccess: jest.Mock };
  let controller: ResidentCommunicationsController;

  beforeEach(() => {
    service = {
      findForResidentV2: jest.fn().mockResolvedValue({ items: [], nextCursor: undefined }),
      markAsReadForResident: jest.fn().mockResolvedValue({ readAt: new Date() }),
    };
    validators = { validateCommunicationBelongsToTenant: jest.fn().mockResolvedValue(undefined) };
    residentAccess = { assertUnitAccess: jest.fn().mockResolvedValue(undefined) };
    controller = new ResidentCommunicationsController(
      service as unknown as CommunicationsService,
      validators as unknown as CommunicationsValidators,
      residentAccess as unknown as ResidentAccessService,
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
      ).rejects.toThrow(BadRequestException);
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
  });

  describe('markResidentAsRead', () => {
    it('requires X-Tenant-Id header', async () => {
      const req = buildReq({ headers: { 'x-tenant-id': undefined as unknown as string } });

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
      ).rejects.toThrow(BadRequestException);

      expect(validators.validateCommunicationBelongsToTenant).not.toHaveBeenCalled();
      expect(service.markAsReadForResident).not.toHaveBeenCalled();
    });

    it('does not call service when header is missing', async () => {
      const req = buildReq({ headers: { 'x-tenant-id': undefined as unknown as string } });

      await expect(
        controller.markResidentAsRead(communicationId, req),
      ).rejects.toThrow(BadRequestException);

      expect(validators.validateCommunicationBelongsToTenant).not.toHaveBeenCalled();
      expect(service.markAsReadForResident).not.toHaveBeenCalled();
    });
  });
});
