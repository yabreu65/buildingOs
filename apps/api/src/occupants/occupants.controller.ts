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
import { BuildingAccessGuard } from '../tenancy/building-access.guard';
import { TenantParam } from '../tenancy/tenant-param.decorator';
import { RequestWithUser } from '../tenancy/building-access.guard';
import { OccupantsService } from './occupants.service';
import { CreateOccupantDto } from './dto/create-occupant.dto';

@Controller('tenants/:tenantId/buildings/:buildingId/units/:unitId/occupants')
@UseGuards(JwtAuthGuard, TenantAccessGuard, BuildingAccessGuard)
export class OccupantsController {
  constructor(private readonly occupantsService: OccupantsService) {}

  /**
   * Assign a member as occupant of a unit
   */
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

  /**
   * List all occupants for a unit
   */
  @Get()
  findAll(
    @TenantParam() tenantId: string,
    @Param('buildingId') buildingId: string,
    @Param('unitId') unitId: string,
  ) {
    return this.occupantsService.findOccupants(tenantId, buildingId, unitId);
  }

  /**
   * Remove an occupant from a unit
   */
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
