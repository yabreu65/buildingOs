import { Module } from '@nestjs/common';
import { PaymentReceiptService } from './payment-receipt.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [PaymentReceiptService],
  exports: [PaymentReceiptService],
})
export class ReceiptsModule {}
