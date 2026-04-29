import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ReportsValidators } from './reports.validators';

describe('ReportsValidators', () => {
  const prisma = {
    building: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
  } as any;

  let validators: ReportsValidators;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-19T12:00:00.000Z'));
    jest.clearAllMocks();
    validators = new ReportsValidators(prisma);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('accepts building-scoped admin role for report read', () => {
    const allowed = validators.canReadReports({
      roles: [],
      scopedRoles: [
        {
          role: 'TENANT_ADMIN',
          scopeType: 'BUILDING',
          scopeBuildingId: 'building-1',
          scopeUnitId: null,
        },
      ],
    });

    expect(allowed).toBe(true);
  });

  it('throws forbidden when requested building is out of accessible scope', async () => {
    prisma.building.findFirst.mockResolvedValue({ id: 'building-2' });

    await expect(
      validators.resolveBuildingScope('tenant-1', 'building-2', ['building-1']),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('parses asOf with strict format and defaults to today', () => {
    const today = validators.parseAsOfDate(undefined);
    expect(today).toBe('2026-04-19');

    expect(() => validators.parseAsOfDate('19-04-2026')).toThrow(BadRequestException);
    expect(() => validators.parseAsOfDate('2026-02-31')).toThrow(BadRequestException);
  });
});
