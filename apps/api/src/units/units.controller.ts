import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantAccessGuard } from '../tenancy/tenant-access.guard';
import { TenantParam } from '../tenancy/tenant-param.decorator';
import { UnitsService } from './units.service';
import { CreateUnitDto } from './dto/create-unit.dto';
import { UpdateUnitDto } from './dto/update-unit.dto';

@Controller('tenants/:tenantId/buildings/:buildingId/units')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
export class UnitsController {
  constructor(private readonly unitsService: UnitsService) {}

  @Post()
  create(
    @TenantParam() tenantId: string,
    @Param('buildingId') buildingId: string,
    @Body() dto: CreateUnitDto,
  ) {
    return this.unitsService.create(tenantId, buildingId, dto);
  }

  @Get()
  findAll(@TenantParam() tenantId: string, @Param('buildingId') buildingId: string) {
    return this.unitsService.findAll(tenantId, buildingId);
  }

  @Get(':unitId')
  findOne(
    @TenantParam() tenantId: string,
    @Param('buildingId') buildingId: string,
    @Param('unitId') unitId: string,
  ) {
    return this.unitsService.findOne(tenantId, buildingId, unitId);
  }

  @Patch(':unitId')
  update(
    @TenantParam() tenantId: string,
    @Param('buildingId') buildingId: string,
    @Param('unitId') unitId: string,
    @Body() dto: UpdateUnitDto,
  ) {
    return this.unitsService.update(tenantId, buildingId, unitId, dto);
  }

  @Delete(':unitId')
  remove(
    @TenantParam() tenantId: string,
    @Param('buildingId') buildingId: string,
    @Param('unitId') unitId: string,
  ) {
    return this.unitsService.remove(tenantId, buildingId, unitId);
  }
}
