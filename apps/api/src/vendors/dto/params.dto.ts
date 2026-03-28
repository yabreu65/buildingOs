import { IsString } from 'class-validator';
import { BuildingVendorParamDto } from '../../common/dtos/params.dto';

export class VendorIdParamDto {
  @IsString()
  vendorId!: string;
}

export class BuildingVendorIdParamDto extends BuildingVendorParamDto {}

export class QuoteIdParamDto {
  @IsString()
  quoteId!: string;
}

export class BuildingQuoteParamDto {
  @IsString()
  buildingId!: string;

  @IsString()
  quoteId!: string;
}

export class WorkOrderIdParamDto {
  @IsString()
  workOrderId!: string;
}

export class BuildingWorkOrderParamDto {
  @IsString()
  buildingId!: string;

  @IsString()
  workOrderId!: string;
}
