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
import { BuildingsService } from './buildings.service';
import { CreateBuildingDto } from './dto/create-building.dto';
import { UpdateBuildingDto } from './dto/update-building.dto';

@Controller('tenants/:tenantId/buildings')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
export class BuildingsController {
  constructor(private readonly buildingsService: BuildingsService) {}

  @Post()
  create(@TenantParam() tenantId: string, @Body() dto: CreateBuildingDto) {
    return this.buildingsService.create(tenantId, dto);
  }

  @Get()
  findAll(@TenantParam() tenantId: string) {
    return this.buildingsService.findAll(tenantId);
  }

  @Get(':buildingId')
  findOne(@TenantParam() tenantId: string, @Param('buildingId') buildingId: string) {
    return this.buildingsService.findOne(tenantId, buildingId);
  }

  @Patch(':buildingId')
  update(
    @TenantParam() tenantId: string,
    @Param('buildingId') buildingId: string,
    @Body() dto: UpdateBuildingDto,
  ) {
    return this.buildingsService.update(tenantId, buildingId, dto);
  }

  @Delete(':buildingId')
  remove(@TenantParam() tenantId: string, @Param('buildingId') buildingId: string) {
    return this.buildingsService.remove(tenantId, buildingId);
  }
}
