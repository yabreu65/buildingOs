import { CANONICAL_CURRENCIES, type CanonicalCurrency } from '@buildingos/contracts';
import { IsDateString, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class UpdateFinanceSettingsDto {
  @IsIn(CANONICAL_CURRENCIES)
  functionalCurrency!: CanonicalCurrency;
}

export class ExchangeRateQueryDto {
  @IsOptional()
  @IsIn(CANONICAL_CURRENCIES)
  baseCurrency?: CanonicalCurrency;

  @IsOptional()
  @IsIn(CANONICAL_CURRENCIES)
  quoteCurrency?: CanonicalCurrency;
}

export class CreateExchangeRateDto {
  @IsIn(CANONICAL_CURRENCIES)
  baseCurrency!: CanonicalCurrency;

  @IsIn(CANONICAL_CURRENCIES)
  quoteCurrency!: CanonicalCurrency;

  @IsString()
  @Matches(/^(?:0*\.\d{0,11}[1-9]|0*[1-9]\d*(?:\.\d{1,12})?)$/, { message: 'rate must be a positive decimal string with at most 12 decimal places' })
  rate!: string;

  @IsDateString()
  effectiveAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  source?: string;
}

export class UpdateExchangeRateDto {
  @IsString()
  @Matches(/^(?:0*\.\d{0,11}[1-9]|0*[1-9]\d*(?:\.\d{1,12})?)$/, { message: 'rate must be a positive decimal string with at most 12 decimal places' })
  rate!: string;

  @IsDateString()
  effectiveAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  source?: string;
}
