import { Type } from 'class-transformer';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  Matches,
  IsArray,
  ValidateNested,
  IsNumber,
} from 'class-validator';

export class ImportExpensesDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'period must be in YYYY-MM format',
  })
  period!: string;

  @IsOptional()
  @IsString()
  columnMapping?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExpenseImportRowDto)
  rows?: ExpenseImportRowDto[];
}

export class ExpenseImportRowDto {
  @IsString()
  @IsNotEmpty()
  fecha!: string;

  @IsString()
  @IsNotEmpty()
  descripcion!: string;

  @IsNumber()
  monto!: number;

  @IsString()
  @IsNotEmpty()
  moneda!: string;

  @IsString()
  @IsNotEmpty()
  edificio!: string;

  @IsString()
  @IsNotEmpty()
  categoria!: string;

  @IsOptional()
  @IsString()
  proveedor?: string;
}

export interface ExpenseImportRow {
  fecha: string;
  descripcion: string;
  monto: number;
  moneda: string;
  edificio: string;
  categoria: string;
  proveedor?: string;
}

export interface ExpenseImportResult {
  totalRows: number;
  successCount: number;
  failureCount: number;
  createdExpenses: string[];
  errors: { rowIndex: number; reason: string }[];
}
