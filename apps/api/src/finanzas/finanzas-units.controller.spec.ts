import type { Role } from '@buildingos/contracts';
import { FinanzasUnitsController } from './finanzas-units.controller';
import { FinanzasService } from './finanzas.service';

describe('FinanzasUnitsController', () => {
  const finanzasService = {
    getUnitLedger: jest.fn(),
  } as unknown as jest.Mocked<FinanzasService>;

  const controller = new FinanzasUnitsController(finanzasService);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function buildRequest(params: {
    tenantIdHeader?: string;
    tenantId?: string;
    memberships: Array<{
      id: string;
      tenantId: string;
      roles: Role[];
    }>;
    userId?: string;
  }) {
    return {
      headers: params.tenantIdHeader
        ? { 'x-tenant-id': params.tenantIdHeader }
        : {},
      tenantId: params.tenantId,
      user: {
        id: params.userId ?? 'user-1',
        email: 'user@example.com',
        name: 'User',
        tenantId: params.tenantId,
        roles: params.memberships[0]?.roles,
        membershipId: params.memberships[0]?.id,
        memberships: params.memberships,
      },
    } as never;
  }

  it('uses the exact membership for the requested tenant instead of the first one', async () => {
    finanzasService.getUnitLedger.mockResolvedValue({
      unitId: 'unit-1',
      unitLabel: '101',
      buildingId: 'building-1',
      buildingName: 'Building A',
      charges: [],
      payments: [],
      totals: {
        totalCharges: 0,
        totalPaid: 0,
        totalOutstanding: 0,
        currency: 'ARS',
        balance: 0,
      },
    } as never);

    const request = buildRequest({
      tenantIdHeader: 'tenant-b',
      memberships: [
        {
          id: 'membership-a',
          tenantId: 'tenant-a',
          roles: ['RESIDENT'],
        },
        {
          id: 'membership-b',
          tenantId: 'tenant-b',
          roles: ['TENANT_ADMIN'],
        },
      ],
    });

    await expect(
      controller.getUnitLedger('unit-1', '2026-01', '2026-02', request),
    ).resolves.toEqual(expect.objectContaining({ unitId: 'unit-1' }));

    expect(finanzasService.getUnitLedger).toHaveBeenCalledWith(
      'tenant-b',
      'unit-1',
      '2026-01',
      '2026-02',
      ['TENANT_ADMIN'],
      'user-1',
      expect.objectContaining({
        id: 'membership-b',
        tenantId: 'tenant-b',
        roles: ['TENANT_ADMIN'],
      }),
    );
    expect(request.tenantId).toBe('tenant-b');
    expect(request.user.tenantId).toBe('tenant-b');
    expect(request.user.membershipId).toBe('membership-b');
    expect(request.user.roles).toEqual(['TENANT_ADMIN']);
  });

  it('denies access when the requested tenant is not present in the user memberships', async () => {
    const request = buildRequest({
      tenantIdHeader: 'tenant-b',
      memberships: [
        {
          id: 'membership-a',
          tenantId: 'tenant-a',
          roles: ['TENANT_ADMIN'],
        },
      ],
    });

    await expect(
      controller.getUnitLedger('unit-1', '' as never, '' as never, request),
    ).rejects.toThrow('No tiene acceso al tenant tenant-b');

    expect(finanzasService.getUnitLedger).not.toHaveBeenCalled();
  });
});
