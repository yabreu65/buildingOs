import { IsUUID } from 'class-validator';
import { BuildingVendorParamDto } from '../../common/dtos/params.dto';

export class VendorIdParamDto {
  @IsUUID()
  vendorId!: string;
}

export class BuildingVendorIdParamDto extends BuildingVendorParamDto {}

export class QuoteIdParamDto {
  @IsUUID()
  quoteId!: string;
}

export class BuildingQuoteParamDto {
  @IsUUID()
  buildingId!: string;

  @IsUUID()
  quoteId!: string;
}

export class WorkOrderIdParamDto {
  @IsUUID()
  workOrderId!: string;
}

export class BuildingWorkOrderParamDto {
  @IsUUID()
  buildingId!: string;

  @IsUUID()
  workOrderId!: string;
}
