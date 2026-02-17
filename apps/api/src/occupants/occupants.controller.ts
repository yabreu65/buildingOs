import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantAccessGuard } from '../tenancy/tenant-access.guard';
import { TenantParam } from '../tenancy/tenant-param.decorator';
import { OccupantsService } from './occupants.service';
import { CreateOccupantDto } from './dto/create-occupant.dto';

export interface RequestWithUser extends Request {
  user: {
    id: string;
    email: string;
    name: string;
  };
}

@Controller('tenants/:tenantId/buildings/:buildingId/units/:unitId/occupants')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
export class OccupantsController {
  constructor(private readonly occupantsService: OccupantsService) {}

  @Post()
  assign(
    @TenantParam() tenantId: string,
    @Param('buildingId') buildingId: string,
    @Param('unitId') unitId: string,
    @Body() dto: CreateOccupantDto,
    @Request() req: RequestWithUser,
  ) {
    return this.occupantsService.assignOccupant(tenantId, buildingId, unitId, dto, req.user.id);
  }

  @Get()
  findAll(
    @TenantParam() tenantId: string,
    @Param('buildingId') buildingId: string,
    @Param('unitId') unitId: string,
  ) {
    return this.occupantsService.findOccupants(tenantId, buildingId, unitId);
  }

  @Delete(':occupantId')
  remove(
    @TenantParam() tenantId: string,
    @Param('buildingId') buildingId: string,
    @Param('unitId') unitId: string,
    @Param('occupantId') occupantId: string,
    @Request() req: RequestWithUser,
  ) {
    return this.occupantsService.removeOccupant(tenantId, buildingId, unitId, occupantId, req.user.id);
  }
}
