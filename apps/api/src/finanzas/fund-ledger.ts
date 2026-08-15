import { BadRequestException } from '@nestjs/common';
import { FundTransactionDirection, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Semántica de saldo compartida (FIN-02/FIN-03).
 * El saldo SIEMPRE se deriva del ledger: SUM(CREDIT) - SUM(DEBIT) por moneda.
 * Ningún DEBIT puede producir saldo negativo.
 */

export async function computeFundBalanceMinor(
  tx: Prisma.TransactionClient | PrismaService,
  tenantId: string,
  fundId: string,
  currencyCode: string,
): Promise<number> {
  const credits = await tx.fundTransaction.groupBy({
    by: ['currencyCode'],
    where: { tenantId, fundId, direction: FundTransactionDirection.CREDIT },
    _sum: { amountMinor: true },
  });
  const debits = await tx.fundTransaction.groupBy({
    by: ['currencyCode'],
    where: { tenantId, fundId, direction: FundTransactionDirection.DEBIT },
    _sum: { amountMinor: true },
  });
  const credit = credits.find((row) => row.currencyCode === currencyCode)?._sum.amountMinor ?? 0;
  const debit = debits.find((row) => row.currencyCode === currencyCode)?._sum.amountMinor ?? 0;
  return credit - debit;
}

export async function assertSufficientFundBalance(
  tx: Prisma.TransactionClient | PrismaService,
  tenantId: string,
  fundId: string,
  currencyCode: string,
  amountMinor: number,
): Promise<void> {
  const balance = await computeFundBalanceMinor(tx, tenantId, fundId, currencyCode);
  if (balance < amountMinor) {
    throw new BadRequestException(
      `Saldo insuficiente en ${currencyCode}: saldo ${balance}, débito solicitado ${amountMinor}`,
    );
  }
}
