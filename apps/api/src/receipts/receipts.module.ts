import { Module } from '@nestjs/common';
import { PaymentReceiptService } from './payment-receipt.service';
import { PrismaModule } from '../prisma/prisma.module';
import { TenancyModule } from '../tenancy/tenancy.module';

@Module({
  imports: [PrismaModule, TenancyModule],
  providers: [PaymentReceiptService],
  exports: [PaymentReceiptService],
})
export class ReceiptsModule {}
