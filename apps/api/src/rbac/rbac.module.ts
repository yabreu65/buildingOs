import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthorizeService } from './authorize.service';
import { RolesGuard } from './roles.guard';

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
  providers: [AuthorizeService, RolesGuard],
  exports: [AuthorizeService, RolesGuard],
})
export class RbacModule {}
