import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DocumentsValidators } from './documents.validators';
import { PrismaModule } from '../prisma/prisma.module';
import { ResidentAccessModule } from '../resident-access/resident-access.module';
import { StorageModule } from '../storage/storage.module';
import { AppConfigModule } from '../config/config.module';

@Module({
  imports: [PrismaModule, ResidentAccessModule, StorageModule, AppConfigModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, DocumentsValidators],
  exports: [DocumentsService, DocumentsValidators],
})
export class DocumentsModule {}
