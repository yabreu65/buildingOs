import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantAccessGuard } from '../tenancy/tenant-access.guard';
import { TenantParam } from '../tenancy/tenant-param.decorator';
import { AuthenticatedRequest } from '../common/types/request.types';
import { BuildingsService, BuildingWithUnits, BuildingWithUnitsDetail } from './buildings.service';
import { CreateBuildingDto } from './dto/create-building.dto';
import { UpdateBuildingDto } from './dto/update-building.dto';

@Controller('tenants/:tenantId/buildings')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
export class BuildingsController {
  constructor(private readonly buildingsService: BuildingsService) {}

  /** Create a new building for the tenant */
  @Post()
  create(
    @TenantParam() tenantId: string,
    @Body() dto: CreateBuildingDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.buildingsService.create(tenantId, dto, req.user.id);
  }

  /** List all buildings for the tenant */
  @Get()
  findAll(@TenantParam() tenantId: string): Promise<BuildingWithUnits[]> {
    return this.buildingsService.findAll(tenantId);
  }

  /** Get a single building by ID with units and occupants */
  @Get(':buildingId')
  findOne(@TenantParam() tenantId: string, @Param('buildingId') buildingId: string): Promise<BuildingWithUnitsDetail> {
    return this.buildingsService.findOne(tenantId, buildingId);
  }

  /** Update building metadata */
  @Patch(':buildingId')
  update(
    @TenantParam() tenantId: string,
    @Param('buildingId') buildingId: string,
    @Body() dto: UpdateBuildingDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<BuildingWithUnits> {
    return this.buildingsService.update(tenantId, buildingId, dto, req.user.id);
  }

  /** Delete a building */
  @Delete(':buildingId')
  remove(
    @TenantParam() tenantId: string,
    @Param('buildingId') buildingId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.buildingsService.remove(tenantId, buildingId, req.user.id);
  }
}
