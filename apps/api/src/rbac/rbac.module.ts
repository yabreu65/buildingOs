import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthorizeService } from './authorize.service';
import { TenantPermissionGuard } from './tenant-permission.guard';

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
  providers: [AuthorizeService, TenantPermissionGuard],
  exports: [AuthorizeService, TenantPermissionGuard],
})
export class RbacModule {}
