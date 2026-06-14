import { Module, Global } from '@nestjs/common';
import { RedisService } from './redis.service';
import { AppConfigModule } from '../config/config.module';

@Global()
@Module({
  imports: [AppConfigModule],
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
