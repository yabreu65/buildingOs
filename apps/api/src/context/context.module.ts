import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ResidentAccessModule } from '../resident-access/resident-access.module';
import { RbacModule } from '../rbac/rbac.module';
import { ContextService } from './context.service';
import { ContextController } from './context.controller';

@Module({
  imports: [PrismaModule, ResidentAccessModule, RbacModule],
  controllers: [ContextController],
  providers: [ContextService],
  exports: [ContextService],
})
export class ContextModule {}
