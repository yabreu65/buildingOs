import { PrismaClient } from '@prisma/client';

type RequiredColumnSet = {
  table: string;
  columns: string[];
};

const REQUIRED_SCHEMA: RequiredColumnSet[] = [
  {
    table: 'AssistantHandoff',
    columns: [
      'id',
      'tenantId',
      'traceId',
      'assignedToUserId',
      'assignedAt',
      'resolvedAt',
      'resolutionNote',
      'fallbackPath',
      'gatewayOutcome',
    ],
  },

  {
    table: 'AssistantHandoffAudit',
    columns: [
      'id',
      'handoffId',
      'actorUserId',
      'action',
      'createdAt',
    ],
  },
  {
    table: 'AssistantMessage',
    columns: [
      'id',
      'tenantId',
      'userId',
      'handoffId',
      'traceId',
      'direction',
      'content',
      'createdByUserId',
      'channel',
      'deliveryStatus',
    ],
  },
  {
    table: 'OpsAlert',
    columns: [
      'id',
      'tenantId',
      'severity',
      'code',
      'message',
      'metricsJson',
      'window',
      'status',
      'dedupeKey',
      'createdAt',
      'ackAt',
      'resolvedAt',
    ],
  },
];

async function main() {
  const prisma = new PrismaClient();
  try {
    const missing: string[] = [];

    for (const required of REQUIRED_SCHEMA) {
      const rows = await prisma.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = ${required.table}
      `;
      const existingColumns = new Set(rows.map((row) => row.column_name));

      if (existingColumns.size === 0) {
        missing.push(`${required.table}.*`);
        continue;
      }

      for (const column of required.columns) {
        if (!existingColumns.has(column)) {
          missing.push(`${required.table}.${column}`);
        }
      }
    }

    if (missing.length > 0) {
      console.error('[SCHEMA-READINESS] Missing required tables/columns:');
      for (const item of missing) {
        console.error(`- ${item}`);
      }
      process.exitCode = 1;
      return;
    }

    console.log('[SCHEMA-READINESS] OK');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('[SCHEMA-READINESS] Failed:', error);
  process.exitCode = 1;
});
