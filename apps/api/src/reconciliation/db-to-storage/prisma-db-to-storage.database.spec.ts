import { PrismaService } from '../../prisma/prisma.service';
import { PrismaDbToStorageDatabase } from './prisma-db-to-storage.database';

describe('PrismaDbToStorageDatabase', () => {
  it('uses bounded deterministic File SELECT batches', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      file: { findMany },
      importJob: { findMany: jest.fn() },
    } as unknown as PrismaService;
    const database = new PrismaDbToStorageDatabase(prisma);

    await database.findFileBatch({ afterId: 'file-1', take: 50 });

    expect(findMany).toHaveBeenCalledWith({
      where: { id: { gt: 'file-1' } },
      orderBy: { id: 'asc' },
      take: 50,
      select: {
        id: true,
        tenantId: true,
        bucket: true,
        objectKey: true,
        objectVersionId: true,
      },
    });
  });

  it('uses bounded deterministic ImportJob SELECT batches without write methods', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      file: { findMany: jest.fn() },
      importJob: { findMany },
    } as unknown as PrismaService;
    const database = new PrismaDbToStorageDatabase(prisma);

    await database.findImportJobBatch({ take: 25 });

    expect(findMany).toHaveBeenCalledWith({
      where: undefined,
      orderBy: { id: 'asc' },
      take: 25,
      select: {
        id: true,
        tenantId: true,
        status: true,
        previewVersion: true,
        originalObjectKey: true,
        originalObjectVersionId: true,
        normalizedObjectKey: true,
        normalizedObjectVersionId: true,
      },
    });
  });

  it.each([
    ['Expense', 'expense', 'expense-1'],
    ['Income', 'income', 'income-1'],
  ] as const)('uses bounded deterministic %s attachment SELECT batches', async (_label, model, afterId) => {
    const expenseFindMany = jest.fn().mockResolvedValue([]);
    const incomeFindMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      file: { findMany: jest.fn() },
      importJob: { findMany: jest.fn() },
      expense: { findMany: expenseFindMany },
      income: { findMany: incomeFindMany },
    } as unknown as PrismaService;
    const database = new PrismaDbToStorageDatabase(prisma);

    await (model === 'expense'
      ? database.findExpenseBatch({ afterId, take: 50 })
      : database.findIncomeBatch({ afterId, take: 50 }));

    expect(model === 'expense' ? expenseFindMany : incomeFindMany).toHaveBeenCalledWith({
      where: { id: { gt: afterId } },
      orderBy: { id: 'asc' },
      take: 50,
      select: {
        id: true,
        tenantId: true,
        attachmentFileKey: true,
      },
    });
  });
});
