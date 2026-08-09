import { CANONICAL_CURRENCIES, type CanonicalCurrency } from '@buildingos/contracts';
import { IsDateString, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const DECIMAL_28_12_POSITIVE_PATTERN = /^(?!0+(?:\.0+)?$)\d{1,16}(?:\.\d{1,12})?$/;
const DECIMAL_28_12_POSITIVE_MESSAGE = 'rate must be greater than zero with at most 16 integer and 12 fractional digits';

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
  @Matches(DECIMAL_28_12_POSITIVE_PATTERN, { message: DECIMAL_28_12_POSITIVE_MESSAGE })
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
  @Matches(DECIMAL_28_12_POSITIVE_PATTERN, { message: DECIMAL_28_12_POSITIVE_MESSAGE })
  rate!: string;

  @IsDateString()
  effectiveAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  source?: string;
}
