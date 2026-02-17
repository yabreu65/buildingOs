import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { PrismaModule } from '../prisma/prisma.module';

/**
 * AuditModule: Global audit logging service
 *
 * PATTERN: @Global() makes AuditService available to all modules
 * without requiring explicit imports. This avoids circular dependencies
 * and massive refactoring of imports across the codebase.
 *
 * USAGE in other services:
 *   constructor(
 *     private prisma: PrismaService,
 *     private auditService: AuditService,  // Auto-available due to @Global()
 *   ) {}
 */
@Global()
@Module({
  imports: [PrismaModule],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
