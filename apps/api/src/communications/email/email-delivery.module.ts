/**
 * EmailDeliveryModule — DynamicModule for email provider selection
 * Task 3.2: Selects adapter from MAIL_PROVIDER env var
 */

import { DynamicModule, Module, Provider } from '@nestjs/common';
import { EMAIL_PROVIDER_TOKEN } from './interfaces/email-provider.interface';
import { EmailProvider } from './interfaces/email-provider.interface';
import { NoOpAdapter } from './adapters/noop.adapter';
import { SmtpAdapter } from './adapters/smtp.adapter';
import { ResendAdapter } from './adapters/resend.adapter';
import { SesAdapter } from './adapters/ses.adapter';
import { EmailRetryInterceptor } from './email-retry.interceptor';
import { DeliveryTrackingService } from './delivery-tracking.service';
import { PrismaModule } from '../../prisma/prisma.module';

export interface EmailDeliveryOptions {
  mailProvider: 'none' | 'smtp' | 'resend' | 'ses';
  mailFrom: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
  resendApiKey?: string;
  sesRegion?: string;
  sesAccessKey?: string;
  sesSecretKey?: string;
}

@Module({})
export class EmailDeliveryModule {
  static register(options: EmailDeliveryOptions): DynamicModule {
    const providerFactory: Provider<EmailProvider> = {
      provide: EMAIL_PROVIDER_TOKEN,
      useFactory: () => {
        switch (options.mailProvider) {
          case 'smtp':
            return new SmtpAdapter({
              host: options.smtpHost || '',
              port: options.smtpPort || 587,
              user: options.smtpUser || '',
              pass: options.smtpPass || '',
              from: options.mailFrom,
            });
          case 'resend':
            return new ResendAdapter(options.resendApiKey || '', options.mailFrom);
          case 'ses':
            return new SesAdapter(
              options.sesRegion || 'us-east-1',
              options.sesAccessKey || '',
              options.sesSecretKey || '',
              options.mailFrom,
            );
          case 'none':
          default:
            return new NoOpAdapter();
        }
      },
    };

    return {
      module: EmailDeliveryModule,
      imports: [PrismaModule],
      providers: [providerFactory, EmailRetryInterceptor, DeliveryTrackingService],
      exports: [EMAIL_PROVIDER_TOKEN, EmailRetryInterceptor, DeliveryTrackingService],
    };
  }
}