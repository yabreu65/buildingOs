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
import { ResidentAccessService } from '../resident-access/resident-access.service';

@Controller('tenants/:tenantId/units')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
export class UnitsController {
  constructor(
    private readonly unitsService: UnitsService,
    private readonly residentAccess: ResidentAccessService,
  ) {}

  /**
   * Get all units for a tenant (optionally filtered by buildingId)
   * GET /tenants/:tenantId/units
   * GET /tenants/:tenantId/units?buildingId=xyz
   */
  @Get()
  async findAllByTenant(
    @TenantParam() tenantId: string,
    @Query('buildingId') buildingId: string | undefined,
    @Req() req: RequestWithUser,
  ) {
    const roles = req.user.roles || [];
    const unitIds = this.residentAccess.shouldEnforce(roles)
      ? await this.residentAccess.getActiveUnitIds(tenantId, req.user.id, buildingId)
      : undefined;
    return this.unitsService.findAllByTenant(tenantId, buildingId, unitIds);
  }
}

/**
 * Building-scoped routes (kept for backward compatibility)
 * POST/GET/PATCH/DELETE specific units within a building
 */
@Controller('tenants/:tenantId/buildings/:buildingId/units')
@UseGuards(JwtAuthGuard, TenantAccessGuard, BuildingAccessGuard)
export class BuildingUnitsController {
  constructor(
    private readonly unitsService: UnitsService,
    private readonly residentAccess: ResidentAccessService,
  ) {}

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
  async findAll(@TenantParam() tenantId: string, @Param('buildingId') buildingId: string, @Req() req: RequestWithUser) {
    const unitIds = this.residentAccess.shouldEnforce(req.user.roles || [])
      ? await this.residentAccess.getActiveUnitIds(tenantId, req.user.id, buildingId)
      : undefined;
    return this.unitsService.findAll(tenantId, buildingId, unitIds);
  }

  /**
   * Get a single unit by ID
   */
  @Get(':unitId')
  async findOne(
    @TenantParam() tenantId: string,
    @Param('buildingId') buildingId: string,
    @Param('unitId') unitId: string,
    @Req() req: RequestWithUser,
  ) {
    if (this.residentAccess.shouldEnforce(req.user.roles || [])) {
      await this.residentAccess.assertUnitAccess(tenantId, req.user.id, unitId, buildingId);
    }
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
