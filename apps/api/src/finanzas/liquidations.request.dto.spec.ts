import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  CancelLiquidationDto,
  ListLiquidationsQueryDto,
  LiquidationParamDto,
  PublishLiquidationDto,
  CreateLiquidationDraftDto,
} from './expense-ledger.dto';

const validate = <T extends object>(cls: new () => T, input: Record<string, unknown>) =>
  validateSync(plainToInstance(cls, input), {
    whitelist: true,
    forbidUnknownValues: true,
  });

describe('Liquidation request DTOs', () => {
  describe('ListLiquidationsQueryDto.period', () => {
    it.each(['2026-01', '2026-12'])('accepts %s', (period) => {
      expect(validate(ListLiquidationsQueryDto, { period })).toHaveLength(0);
    });

    it.each(['2026-00', '2026-13', '2026-1', 'foo', ' 2026-01 '])('rejects %s', (period) => {
      expect(validate(ListLiquidationsQueryDto, { period }).map((error) => error.property)).toContain('period');
    });
  });

  describe('LiquidationParamDto.liquidationId', () => {
    it('accepts a valid CUID', () => {
      expect(
        validate(LiquidationParamDto, { liquidationId: 'c123456789012345678901234' }),
      ).toHaveLength(0);
    });

    it.each(['', '   ', 'liq-1', 'c123', 'c1234567890123456789012345'])(
      'rejects %s',
      (liquidationId) => {
        expect(
          validate(LiquidationParamDto, { liquidationId }).map((error) => error.property),
        ).toContain('liquidationId');
      },
    );
  });

  describe('CancelLiquidationDto.reason', () => {
    it('accepts a trimmed reason', () => {
      const dto = plainToInstance(CancelLiquidationDto, { reason: '  Board decision  ' });

      expect(dto.reason).toBe('Board decision');
      expect(validate(CancelLiquidationDto, { reason: '  Board decision  ' })).toHaveLength(0);
    });

    it('allows omission of reason', () => {
      expect(validate(CancelLiquidationDto, {})).toHaveLength(0);
    });

    it.each([0, '', '   ', null, ['x'], { text: 'x' }, true])('rejects %p', (reason) => {
      expect(
        validate(CancelLiquidationDto, { reason }).map((error) => error.property),
      ).toContain('reason');
    });
  });

  describe('PublishLiquidationDto.dueDate', () => {
    it('accepts a strict ISO date', () => {
      expect(validate(PublishLiquidationDto, { dueDate: '2026-06-10' })).toHaveLength(0);
    });

    it.each(['01/02/2026', 'January 2 2026', '2026-1-2', '2026-13-01', '2026-06-31', '2026-06-10T00:00:00.000Z'])(
      'rejects ambiguous or invalid dueDate %s',
      (dueDate) => {
        expect(
          validate(PublishLiquidationDto, { dueDate }).map((error) => error.property),
        ).toContain('dueDate');
      },
    );
  });

  describe('CreateLiquidationDraftDto.period', () => {
    it('accepts a valid month period', () => {
      expect(
        validate(CreateLiquidationDraftDto, {
          buildingId: 'building-1',
          period: '2026-01',
          baseCurrency: 'ARS',
        }),
      ).toHaveLength(0);
    });

    it('rejects malformed periods', () => {
      expect(
        validate(CreateLiquidationDraftDto, {
          buildingId: 'building-1',
          period: '2026-13',
          baseCurrency: 'ARS',
        }).map((error) => error.property),
      ).toContain('period');
    });
  });
});
