import { Global, Module } from '@nestjs/common';
import { MinioService } from './minio.service';
import { AppConfigModule } from '../config/config.module';

@Global()
@Module({
  imports: [AppConfigModule],
  providers: [MinioService],
  exports: [MinioService],
})
export class StorageModule {}
