import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ImportExpensesDto, ExpenseImportRowDto } from './expense-import.dto';

describe('ImportExpensesDto', () => {
  const validRow = {
    fecha: '01/05/2026',
    descripcion: 'Luz',
    monto: 100,
    moneda: 'ARS',
    edificio: 'Edificio A',
    categoria: 'Servicios',
  };

  describe('valid payloads', () => {
    it('accepts a valid period', async () => {
      const dto = plainToInstance(ImportExpensesDto, { period: '2026-05' });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('accepts period with rows', async () => {
      const dto = plainToInstance(ImportExpensesDto, {
        period: '2026-05',
        rows: [validRow],
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('accepts period with columnMapping', async () => {
      const dto = plainToInstance(ImportExpensesDto, {
        period: '2026-05',
        columnMapping: '{"fecha":0,"descripcion":1}',
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('accepts period with optional fields omitted', async () => {
      const dto = plainToInstance(ImportExpensesDto, { period: '2026-12' });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });
  });

  describe('invalid payloads', () => {
    it('rejects missing period', async () => {
      const dto = plainToInstance(ImportExpensesDto, {});
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      const periodError = errors.find((e) => e.property === 'period');
      expect(periodError).toBeDefined();
    });

    it('rejects empty period', async () => {
      const dto = plainToInstance(ImportExpensesDto, { period: '' });
      const errors = await validate(dto);
      const periodError = errors.find((e) => e.property === 'period');
      expect(periodError).toBeDefined();
    });

    it('rejects period without YYYY-MM format', async () => {
      const dto = plainToInstance(ImportExpensesDto, { period: '2026/05' });
      const errors = await validate(dto);
      const periodError = errors.find((e) => e.property === 'period');
      expect(periodError).toBeDefined();
    });

    it('rejects period with month 00', async () => {
      const dto = plainToInstance(ImportExpensesDto, { period: '2026-00' });
      const errors = await validate(dto);
      const periodError = errors.find((e) => e.property === 'period');
      expect(periodError).toBeDefined();
    });

    it('rejects period with month 13', async () => {
      const dto = plainToInstance(ImportExpensesDto, { period: '2026-13' });
      const errors = await validate(dto);
      const periodError = errors.find((e) => e.property === 'period');
      expect(periodError).toBeDefined();
    });

    it('rejects period with wrong separator', async () => {
      const dto = plainToInstance(ImportExpensesDto, { period: '2026_05' });
      const errors = await validate(dto);
      const periodError = errors.find((e) => e.property === 'period');
      expect(periodError).toBeDefined();
    });
  });
});

describe('ExpenseImportRowDto', () => {
  const validRow = {
    fecha: '01/05/2026',
    descripcion: 'Luz',
    monto: 100,
    moneda: 'ARS',
    edificio: 'Edificio A',
    categoria: 'Servicios',
  };

  describe('valid payloads', () => {
    it('accepts a valid row', async () => {
      const dto = plainToInstance(ExpenseImportRowDto, validRow);
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('accepts a row with optional proveedor', async () => {
      const dto = plainToInstance(ExpenseImportRowDto, {
        ...validRow,
        proveedor: 'Vendor A',
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });
  });

  describe('invalid payloads', () => {
    it('rejects missing fecha', async () => {
      const { fecha, ...rest } = validRow;
      const dto = plainToInstance(ExpenseImportRowDto, rest);
      const errors = await validate(dto);
      expect(errors.find((e) => e.property === 'fecha')).toBeDefined();
    });

    it('rejects empty fecha', async () => {
      const dto = plainToInstance(ExpenseImportRowDto, { ...validRow, fecha: '' });
      const errors = await validate(dto);
      expect(errors.find((e) => e.property === 'fecha')).toBeDefined();
    });

    it('rejects missing descripcion', async () => {
      const { descripcion, ...rest } = validRow;
      const dto = plainToInstance(ExpenseImportRowDto, rest);
      const errors = await validate(dto);
      expect(errors.find((e) => e.property === 'descripcion')).toBeDefined();
    });

    it('rejects missing monto', async () => {
      const { monto, ...rest } = validRow;
      const dto = plainToInstance(ExpenseImportRowDto, rest);
      const errors = await validate(dto);
      expect(errors.find((e) => e.property === 'monto')).toBeDefined();
    });

    it('rejects non-numeric monto', async () => {
      const dto = plainToInstance(ExpenseImportRowDto, {
        ...validRow,
        monto: 'abc',
      });
      const errors = await validate(dto);
      expect(errors.find((e) => e.property === 'monto')).toBeDefined();
    });

    it('rejects missing moneda', async () => {
      const { moneda, ...rest } = validRow;
      const dto = plainToInstance(ExpenseImportRowDto, rest);
      const errors = await validate(dto);
      expect(errors.find((e) => e.property === 'moneda')).toBeDefined();
    });

    it('rejects missing edificio', async () => {
      const { edificio, ...rest } = validRow;
      const dto = plainToInstance(ExpenseImportRowDto, rest);
      const errors = await validate(dto);
      expect(errors.find((e) => e.property === 'edificio')).toBeDefined();
    });

    it('rejects missing categoria', async () => {
      const { categoria, ...rest } = validRow;
      const dto = plainToInstance(ExpenseImportRowDto, rest);
      const errors = await validate(dto);
      expect(errors.find((e) => e.property === 'categoria')).toBeDefined();
    });
  });
});
