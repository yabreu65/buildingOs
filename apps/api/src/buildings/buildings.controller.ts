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
import { BuildingsService } from './buildings.service';
import { CreateBuildingDto } from './dto/create-building.dto';
import { UpdateBuildingDto } from './dto/update-building.dto';

export interface RequestWithUser extends Request {
  user: {
    id: string;
    email: string;
    name: string;
  };
}

@Controller('tenants/:tenantId/buildings')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
export class BuildingsController {
  constructor(private readonly buildingsService: BuildingsService) {}

  @Post()
  create(
    @TenantParam() tenantId: string,
    @Body() dto: CreateBuildingDto,
    @Request() req: RequestWithUser,
  ) {
    return this.buildingsService.create(tenantId, dto, req.user.id);
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
    @Request() req: RequestWithUser,
  ) {
    return this.buildingsService.update(tenantId, buildingId, dto, req.user.id);
  }

  @Delete(':buildingId')
  remove(
    @TenantParam() tenantId: string,
    @Param('buildingId') buildingId: string,
    @Request() req: RequestWithUser,
  ) {
    return this.buildingsService.remove(tenantId, buildingId, req.user.id);
  }
}
