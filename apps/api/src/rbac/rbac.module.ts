import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthorizeService } from './authorize.service';

/**
 * Global RBAC Module
 *
 * Makes AuthorizeService available to all modules without explicit imports.
 * Usage:
 *   constructor(private readonly authorize: AuthorizeService) {}
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [AuthorizeService],
  exports: [AuthorizeService],
})
export class RbacModule {}
