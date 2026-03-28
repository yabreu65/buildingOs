import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantAccessGuard } from '../tenancy/tenant-access.guard';
import { BuildingAccessGuard, RequestWithUser } from '../tenancy/building-access.guard';
import { TenantParam } from '../tenancy/tenant-param.decorator';
import { UnitsService } from './units.service';
import { CreateUnitDto } from './dto/create-unit.dto';
import { UpdateUnitDto } from './dto/update-unit.dto';

@Controller('tenants/:tenantId/units')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
export class UnitsController {
  constructor(private readonly unitsService: UnitsService) {}

  /**
   * Get all units for a tenant (optionally filtered by buildingId)
   * GET /tenants/:tenantId/units
   * GET /tenants/:tenantId/units?buildingId=xyz
   */
  @Get()
  findAllByTenant(
    @TenantParam() tenantId: string,
    @Query('buildingId') buildingId?: string,
  ) {
    return this.unitsService.findAllByTenant(tenantId, buildingId);
  }
}

/**
 * Building-scoped routes (kept for backward compatibility)
 * POST/GET/PATCH/DELETE specific units within a building
 */
@Controller('tenants/:tenantId/buildings/:buildingId/units')
@UseGuards(JwtAuthGuard, TenantAccessGuard, BuildingAccessGuard)
export class BuildingUnitsController {
  constructor(private readonly unitsService: UnitsService) {}

  /**
   * Create a new unit in a building
   */
  @Post()
  create(
    @TenantParam() tenantId: string,
    @Param('buildingId') buildingId: string,
    @Body() dto: CreateUnitDto,
    @Req() req: RequestWithUser,
  ) {
    const userId = req.user.id;
    return this.unitsService.create(tenantId, buildingId, userId, dto);
  }

  /**
   * List all units in a building
   */
  @Get()
  findAll(@TenantParam() tenantId: string, @Param('buildingId') buildingId: string) {
    return this.unitsService.findAll(tenantId, buildingId);
  }

  /**
   * Get a single unit by ID
   */
  @Get(':unitId')
  findOne(
    @TenantParam() tenantId: string,
    @Param('buildingId') buildingId: string,
    @Param('unitId') unitId: string,
  ) {
    return this.unitsService.findOne(tenantId, buildingId, unitId);
  }

  /**
   * Update a unit
   */
  @Patch(':unitId')
  update(
    @TenantParam() tenantId: string,
    @Param('buildingId') buildingId: string,
    @Param('unitId') unitId: string,
    @Body() dto: UpdateUnitDto,
    @Req() req: RequestWithUser,
  ) {
    const userId = req.user.id;
    return this.unitsService.update(tenantId, buildingId, unitId, userId, dto);
  }

  /**
   * Delete a unit
   */
  @Delete(':unitId')
  remove(
    @TenantParam() tenantId: string,
    @Param('buildingId') buildingId: string,
    @Param('unitId') unitId: string,
    @Req() req: RequestWithUser,
  ) {
    const userId = req.user.id;
    return this.unitsService.remove(tenantId, buildingId, unitId, userId);
  }
}
