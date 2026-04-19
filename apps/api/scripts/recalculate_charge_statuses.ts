import { ChargeStatus, PaymentStatus, PrismaClient } from '@prisma/client';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

interface CliArgs {
  tenantId?: string;
  dryRun: boolean;
  limit?: number;
}

function computeStatus(amount: number, allocatedApproved: number): ChargeStatus {
  if (allocatedApproved <= 0) return ChargeStatus.PENDING;
  if (allocatedApproved < amount) return ChargeStatus.PARTIAL;
  return ChargeStatus.PAID;
}

async function main(): Promise<void> {
  const argv = await yargs(hideBin(process.argv))
    .option('tenantId', {
      type: 'string',
      describe: 'Optional tenant ID to scope recalculation',
    })
    .option('dryRun', {
      type: 'boolean',
      default: true,
      describe: 'When true, only reports changes without writing',
    })
    .option('limit', {
      type: 'number',
      describe: 'Optional max number of charges to process',
    })
    .strict()
    .help()
    .parse();

  const args = argv as unknown as CliArgs;
  const prisma = new PrismaClient();

  try {
    const where = {
      canceledAt: null,
      ...(args.tenantId ? { tenantId: args.tenantId } : {}),
    };

    const charges = await prisma.charge.findMany({
      where,
      include: {
        paymentAllocations: {
          include: {
            payment: {
              select: {
                status: true,
              },
            },
          },
        },
      },
      take: args.limit,
      orderBy: { createdAt: 'asc' },
    });

    let scanned = 0;
    let changed = 0;

    for (const charge of charges) {
      scanned += 1;
      const allocatedApproved = charge.paymentAllocations.reduce((sum, allocation) => {
        const status = allocation.payment?.status;
        if (
          status === PaymentStatus.APPROVED ||
          status === PaymentStatus.RECONCILED
        ) {
          return sum + allocation.amount;
        }
        return sum;
      }, 0);

      const nextStatus = computeStatus(charge.amount, allocatedApproved);
      if (nextStatus === charge.status) {
        continue;
      }

      changed += 1;
      console.log(
        `[${args.dryRun ? 'DRY-RUN' : 'UPDATE'}] charge=${charge.id} tenant=${charge.tenantId} unit=${charge.unitId} amount=${charge.amount} allocatedApproved=${allocatedApproved} ${charge.status} -> ${nextStatus}`,
      );

      if (!args.dryRun) {
        await prisma.charge.update({
          where: { id: charge.id },
          data: {
            status: nextStatus,
            updatedAt: new Date(),
          },
        });
      }
    }

    console.log(
      `\nDone. scanned=${scanned} changed=${changed} mode=${args.dryRun ? 'dry-run' : 'apply'}${args.tenantId ? ` tenant=${args.tenantId}` : ''}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('Fatal error recalculating charge statuses:', error);
  process.exit(1);
});
