import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantAccessGuard } from '../tenancy/tenant-access.guard';
import { AuthenticatedRequest } from '../common/types/request.types';
import { IncomePoliciesService } from './income-policies.service';
import {
  CreateIncomePolicyDto,
  CreateIncomePolicyVersionDto,
  IncomePolicyResponseDto,
} from './income-policies.dto';

/**
 * Políticas de ingresos (tenant-scoped)
 * Routes: /tenants/:tenantId/finance/income-policies
 */
@Controller('tenants/:tenantId/finance/income-policies')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
export class IncomePoliciesController {
  constructor(private readonly incomePoliciesService: IncomePoliciesService) {}

  @Get()
  async listPolicies(
    @Request() req: AuthenticatedRequest,
  ): Promise<IncomePolicyResponseDto[]> {
    return this.incomePoliciesService.listPolicies(req.tenantId!, req.user.roles ?? []);
  }

  @Get(':categoryId')
  async getPolicy(
    @Param('categoryId') categoryId: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<IncomePolicyResponseDto> {
    return this.incomePoliciesService.getPolicy(req.tenantId!, categoryId, req.user.roles ?? []);
  }

  @Post()
  async createPolicy(
    @Body() dto: CreateIncomePolicyDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<IncomePolicyResponseDto> {
    return this.incomePoliciesService.createPolicy(
      req.tenantId!,
      req.user.membershipId ?? '',
      req.user.roles ?? [],
      dto,
    );
  }

  @Post(':categoryId/versions')
  async createVersion(
    @Param('categoryId') categoryId: string,
    @Body() dto: CreateIncomePolicyVersionDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<IncomePolicyResponseDto> {
    return this.incomePoliciesService.createVersion(
      req.tenantId!,
      categoryId,
      req.user.membershipId ?? '',
      req.user.roles ?? [],
      dto,
    );
  }

  @Post(':categoryId/deactivate')
  async deactivatePolicy(
    @Param('categoryId') categoryId: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<IncomePolicyResponseDto> {
    return this.incomePoliciesService.deactivatePolicy(
      req.tenantId!,
      categoryId,
      req.user.membershipId ?? '',
      req.user.roles ?? [],
    );
  }
}
