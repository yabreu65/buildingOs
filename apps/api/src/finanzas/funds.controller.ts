import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantAccessGuard } from '../tenancy/tenant-access.guard';
import { AuthenticatedRequest } from '../common/types/request.types';
import { FundsService } from './funds.service';
import {
  CreateFundDto,
  UpdateFundDto,
  FundQueryDto,
  FundResponseDto,
  CreateFundTransactionDto,
  ReverseFundTransactionDto,
  FundTransactionQueryDto,
  FundTransactionResponseDto,
} from './funds.dto';

/**
 * Fondos financieros (tenant-scoped)
 * Routes: /tenants/:tenantId/finance/funds
 */
@Controller('tenants/:tenantId/finance/funds')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
export class FundsController {
  constructor(private readonly fundsService: FundsService) {}

  @Get()
  async listFunds(
    @Query() query: FundQueryDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<FundResponseDto[]> {
    return this.fundsService.listFunds(req.tenantId!, req.user.roles ?? [], query);
  }

  @Post()
  async createFund(
    @Body() dto: CreateFundDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<FundResponseDto> {
    return this.fundsService.createFund(
      req.tenantId!,
      req.user.membershipId ?? '',
      req.user.roles ?? [],
      dto,
    );
  }

  @Get(':fundId')
  async getFund(
    @Param('fundId') fundId: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<FundResponseDto> {
    return this.fundsService.getFund(req.tenantId!, fundId, req.user.roles ?? []);
  }

  @Patch(':fundId')
  async updateFund(
    @Param('fundId') fundId: string,
    @Body() dto: UpdateFundDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<FundResponseDto> {
    return this.fundsService.updateFund(
      req.tenantId!,
      fundId,
      req.user.membershipId ?? '',
      req.user.roles ?? [],
      dto,
    );
  }

  @Post(':fundId/archive')
  @HttpCode(HttpStatus.OK)
  async archiveFund(
    @Param('fundId') fundId: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<FundResponseDto> {
    return this.fundsService.archiveFund(
      req.tenantId!,
      fundId,
      req.user.membershipId ?? '',
      req.user.roles ?? [],
    );
  }

  @Get(':fundId/transactions')
  async listTransactions(
    @Param('fundId') fundId: string,
    @Query() query: FundTransactionQueryDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<FundTransactionResponseDto[]> {
    return this.fundsService.listTransactions(
      req.tenantId!,
      fundId,
      req.user.roles ?? [],
      query,
    );
  }

  @Post(':fundId/transactions')
  async createTransaction(
    @Param('fundId') fundId: string,
    @Body() dto: CreateFundTransactionDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<FundTransactionResponseDto> {
    return this.fundsService.createTransaction(
      req.tenantId!,
      fundId,
      req.user.membershipId ?? '',
      req.user.roles ?? [],
      dto,
    );
  }

  @Post(':fundId/transactions/:transactionId/reverse')
  async reverseTransaction(
    @Param('fundId') fundId: string,
    @Param('transactionId') transactionId: string,
    @Body() dto: ReverseFundTransactionDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<FundTransactionResponseDto> {
    return this.fundsService.reverseTransaction(
      req.tenantId!,
      fundId,
      transactionId,
      req.user.membershipId ?? '',
      req.user.roles ?? [],
      dto,
    );
  }
}
