import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SnapshotGenerationService, BackfillRangeOptions } from './snapshot-generation.service';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../rbac/roles.guard';
import { Roles } from '../rbac/roles.decorator';

class BackfillRangeDto {
  tenantId!: string;
  buildingId?: string;
  fromPeriod!: string;
  toPeriod!: string;
}

class RecomputePeriodDto {
  tenantId!: string;
  buildingId?: string;
  period!: string;
}

@ApiTags('snapshot-generation')
@ApiBearerAuth()
@Controller('admin/snapshots')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('SUPER_ADMIN')
export class SnapshotGenerationController {
  constructor(
    private readonly snapshotGenerationService: SnapshotGenerationService,
  ) {}

  @Post('backfill-range')
  @ApiOperation({ summary: 'Backfill snapshots for a range of periods' })
  async backfillRange(@Body() dto: BackfillRangeDto) {
    const options: BackfillRangeOptions = {
      tenantId: dto.tenantId,
      buildingId: dto.buildingId,
      fromPeriod: dto.fromPeriod,
      toPeriod: dto.toPeriod,
    };
    return this.snapshotGenerationService.backfillRange(options);
  }

  @Post('recompute-period')
  @ApiOperation({ summary: 'Recompute snapshots for a specific period' })
  async recomputePeriod(@Body() dto: RecomputePeriodDto) {
    return this.snapshotGenerationService.generateSnapshots({
      tenantId: dto.tenantId,
      buildingId: dto.buildingId,
      period: dto.period,
      recompute: true,
    });
  }
}