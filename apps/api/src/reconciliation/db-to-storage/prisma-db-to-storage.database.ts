import { PrismaService } from '../../prisma/prisma.service';
import {
  DatabaseBatchOptions,
  FileReferenceRecord,
  ImportJobReferenceRecord,
  ReadOnlyReconciliationDatabase,
} from './db-to-storage.types';

/** Prisma adapter exposing only bounded SELECT operations to the scanner. */
export class PrismaDbToStorageDatabase implements ReadOnlyReconciliationDatabase {
  constructor(private readonly prisma: PrismaService) {}

  async findFileBatch(options: DatabaseBatchOptions): Promise<readonly FileReferenceRecord[]> {
    const rows = await this.prisma.file.findMany({
      where: options.afterId ? { id: { gt: options.afterId } } : undefined,
      orderBy: { id: 'asc' },
      take: options.take,
      select: {
        id: true,
        tenantId: true,
        bucket: true,
        objectKey: true,
        objectVersionId: true,
      },
    });

    return rows;
  }

  async findImportJobBatch(options: DatabaseBatchOptions): Promise<readonly ImportJobReferenceRecord[]> {
    const rows = await this.prisma.importJob.findMany({
      where: options.afterId ? { id: { gt: options.afterId } } : undefined,
      orderBy: { id: 'asc' },
      take: options.take,
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

    return rows;
  }
}
