/**
 * PaymentGatewayService — delegates to active provider adapter
 * Task 2.3: Orchestrates payment creation, webhook handling, and charge confirmation
 */

import {
  BadRequestException,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { isCanonicalCurrency } from '@buildingos/contracts';
import {
  PaymentProvider,
  CreatePreferenceInput,
  PaymentPreference,
  WebhookEvent,
  PaymentStatus,
  PAYMENT_PROVIDER_TOKEN,
  PaymentProviderName,
  WebhookSignatureContext,
} from './interfaces/payment-provider.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { IdempotencyService } from './webhooks/idempotency.service';
import { ChargeStatus } from '@prisma/client';
import { Inject } from '@nestjs/common';
import {
  EFFECTIVE_PAYMENT_STATUSES,
  isEffectivePaymentStatus,
} from '../payment-status-semantics';
import { CurrencyConversionService } from '../currency-conversion.service';
import {
  buildPaymentFunctionalSnapshot,
  classifyFunctionalSnapshot,
  type FunctionalSnapshotFields,
} from '../functional-snapshot';

@Injectable()
export class PaymentGatewayService {
  private readonly logger = new Logger(PaymentGatewayService.name);

  constructor(
    @Optional() @Inject(PAYMENT_PROVIDER_TOKEN) private readonly provider: PaymentProvider | null,
    private readonly prisma: PrismaService,
    private readonly idempotencyService: IdempotencyService,
    private readonly currencyConversionService: CurrencyConversionService,
  ) {}

  /**
   * Create a payment preference (checkout link) for a charge
   */
  async createPreference(input: CreatePreferenceInput): Promise<PaymentPreference> {
    if (!this.provider) throw new Error('Payment provider not configured');
    return this.provider.createPreference(input);
  }

  /**
   * Return the canonical provider configured for this gateway instance.
   */
  getActiveProviderName(): PaymentProviderName | null {
    return this.provider?.providerName ?? null;
  }

  /**
   * Process a webhook event after signature validation.
   *
   * 3E1 financial rules:
   * - A charge is NEVER marked PAID directly: every gateway-confirmed payment
   *   must produce ledger evidence (Payment + PaymentAllocation) and the
   *   charge status is recalculated from its allocations.
   * - The event must carry verifiable amount + currency from the provider.
   *   Missing/invalid evidence produces NO financial mutation and leaves the
   *   event unprocessed (provider will retry; manual review required).
   * - 3E1 is same-currency: event.currency must equal Charge.currency and the
   *   local Payment currency. Cross-currency arrives with 3E3.
   * - A local Payment is matched tenant-scoped by reference; if it does not
   *   exist, no Payment is invented (no verifiable actor) and no mutation
   *   happens — the charge stays PENDING for the resident/admin flow.
   */
  async processWebhookEvent(
    payload: unknown,
    signature: string | WebhookSignatureContext,
    requestedProviderName?: PaymentProviderName,
  ): Promise<WebhookEvent & { chargeUpdated?: boolean }> {
    if (!this.provider) throw new ServiceUnavailableException('Payment provider not configured');
    const providerName = this.provider.providerName;

    if (requestedProviderName && requestedProviderName !== providerName) {
      throw new BadRequestException(`Webhook provider mismatch: active provider is ${providerName}`);
    }

    const signatureContext = typeof signature === 'string' ? { signature } : signature;
    const adapterSignatureContext = {
      ...signatureContext,
      provider: providerName,
    };

    const event = await this.provider.handleWebhook(
      payload,
      adapterSignatureContext.signature || '',
      adapterSignatureContext,
    );

    if (event.status !== 'PAID') {
      this.logger.log(`Webhook event ${event.eventId} with status ${event.status} acknowledged without charge update`);
      return { ...event, chargeUpdated: false };
    }

    // Idempotency: check only after the event is known to require durable side effects.
    const isDuplicate = await this.idempotencyService.isProcessed(event.eventId, providerName);
    if (isDuplicate) {
      this.logger.log(`Webhook event ${event.eventId} already processed, skipping`);
      return { ...event, chargeUpdated: false };
    }

    const chargeUpdated = await this.applyPaidEvent(event);

    if (chargeUpdated) {
      await this.idempotencyService.markProcessed(event.eventId, providerName);
    } else {
      // No durable side effects applied: do not mark processed so the
      // provider retries and the event stays in manual-review visibility.
      this.logger.error(
        `Webhook event ${event.eventId} left unprocessed: manual review required`,
      );
    }

    return { ...event, chargeUpdated };
  }

  private async applyPaidEvent(event: WebhookEvent): Promise<boolean> {
    if (!event.chargeId) {
      this.logger.warn(`Webhook event ${event.eventId} has no chargeId; no financial mutation`);
      return false;
    }

    const charge = await this.prisma.charge.findFirst({
      where: { id: event.chargeId },
      include: {
        paymentAllocations: {
          where: {
            payment: { status: { in: [...EFFECTIVE_PAYMENT_STATUSES] } },
          },
          select: { amount: true },
        },
      },
    });

    if (!charge) {
      this.logger.error(`Webhook event ${event.eventId}: charge ${event.chargeId} not found`);
      return false;
    }

    // Verifiable financial evidence is mandatory: never infer amount/currency.
    if (
      event.amount === undefined ||
      event.amount === null ||
      !Number.isSafeInteger(event.amount) ||
      event.amount <= 0
    ) {
      this.logger.error(
        `Webhook event ${event.eventId}: missing or invalid provider amount; no financial mutation`,
      );
      throw new ServiceUnavailableException(
        'Webhook event missing verifiable amount; manual review required',
      );
    }
    const verifiedAmount: number = event.amount;

    if (!event.currency || !isCanonicalCurrency(event.currency)) {
      this.logger.error(
        `Webhook event ${event.eventId}: missing or invalid provider currency; no financial mutation`,
      );
      throw new ServiceUnavailableException(
        'Webhook event missing verifiable currency; manual review required',
      );
    }

    // 3E1 same-currency invariant.
    if (event.currency !== charge.currency) {
      this.logger.error(
        `Webhook event ${event.eventId}: provider currency ${event.currency} does not match charge currency ${charge.currency}`,
      );
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: 'PAYMENT_ALLOCATION_CURRENCY_NOT_SUPPORTED',
        message: `La moneda del evento (${event.currency}) no coincide con la moneda del cargo (${charge.currency})`,
      });
    }

    if (verifiedAmount > charge.amount) {
      this.logger.error(
        `Webhook event ${event.eventId}: provider amount ${verifiedAmount} exceeds charge amount ${charge.amount}`,
      );
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: 'PAYMENT_EVENT_AMOUNT_EXCEEDS_CHARGE',
        message: 'El monto del evento excede el monto del cargo',
      });
    }

    const effectiveAllocated = charge.paymentAllocations.reduce(
      (sum, allocation) => sum + allocation.amount,
      0,
    );
    const outstanding = charge.amount - effectiveAllocated;

    if (verifiedAmount > outstanding) {
      this.logger.error(
        `Webhook event ${event.eventId}: provider amount ${verifiedAmount} exceeds charge outstanding ${outstanding}`,
      );
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: 'PAYMENT_EVENT_AMOUNT_EXCEEDS_OUTSTANDING',
        message: 'El monto del evento supera el saldo pendiente del cargo',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findFirst({
        where: {
          tenantId: charge.tenantId,
          reference: event.externalId ?? undefined,
        },
        include: { paymentAllocations: true },
      });

      if (!payment) {
        this.logger.error(
          `Webhook event ${event.eventId}: no local payment with reference ${event.externalId} for tenant ${charge.tenantId}; manual review required`,
        );
        return false;
      }

      if (payment.currency !== event.currency || payment.currency !== charge.currency) {
        throw new UnprocessableEntityException({
          statusCode: 422,
          error: 'PAYMENT_ALLOCATION_CURRENCY_NOT_SUPPORTED',
          message: `La moneda del pago (${payment.currency}) no coincide con la del evento (${event.currency})`,
        });
      }

      // 3E1 hardening: the provider amount must reconcile EXACTLY with the
      // local payment amount. Any difference blocks the whole reconciliation
      // (no allocation, no status mutation) and leaves the event unprocessed.
      if (verifiedAmount !== payment.amount) {
        this.logger.error(
          `Webhook event ${event.eventId}: provider amount ${verifiedAmount} does not match local payment amount ${payment.amount}`,
        );
        throw new UnprocessableEntityException({
          statusCode: 422,
          error: 'PAYMENT_PROVIDER_AMOUNT_MISMATCH',
          message: 'El monto del proveedor no coincide con el monto del pago local',
        });
      }

      const existingAllocation = payment.paymentAllocations.find(
        (allocation) => allocation.chargeId === charge.id,
      );
      if (existingAllocation) {
        this.logger.log(
          `Webhook event ${event.eventId}: allocation for payment ${payment.id} / charge ${charge.id} already exists`,
        );
        return true;
      }

      const alreadyAllocated = payment.paymentAllocations.reduce(
        (sum, allocation) => sum + allocation.amount,
        0,
      );
      if (alreadyAllocated + verifiedAmount > payment.amount) {
        throw new UnprocessableEntityException({
          statusCode: 422,
          error: 'PAYMENT_EVENT_AMOUNT_EXCEEDS_PAYMENT',
          message: 'El monto del evento supera el monto del pago local',
        });
      }

      let effectivePaymentStatus = payment.status;
      if (payment.status === 'SUBMITTED') {
        const snapshotData = await this.gatewayPaymentSnapshot(
          tx,
          charge.tenantId,
          payment,
          event,
        );
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: 'APPROVED',
            paidAt: new Date(),
            paymentEventId: event.eventId,
            updatedAt: new Date(),
            ...snapshotData,
          },
        });
        effectivePaymentStatus = 'APPROVED';
      } else if (payment.status === 'APPROVED' || payment.status === 'RECONCILED') {
        await tx.payment.update({
          where: { id: payment.id },
          data: { paymentEventId: event.eventId, updatedAt: new Date() },
        });
      } else {
        this.logger.error(
          `Webhook event ${event.eventId}: payment ${payment.id} in status ${payment.status}; no allocation created`,
        );
        return false;
      }

      await tx.paymentAllocation.create({
        data: {
          tenantId: charge.tenantId,
          paymentId: payment.id,
          chargeId: charge.id,
          amount: verifiedAmount,
        },
      });

      await this.recalculateChargeStatus(tx, charge.id);

      if (effectivePaymentStatus === 'APPROVED') {
        await this.reconcilePaymentIfAllPaid(tx, payment.id);
      }

      return true;
    });
  }


  /**
   * 3E2: freeze a COMPLETE functional snapshot before the gateway effective
   * transition. COMPLETE → reuse; LEGACY_NULL → requires the provider
   * economic date (event.paidAt, YYYY-MM-DD) — missing date blocks the whole
   * reconciliation; PARTIAL_INVALID → block.
   */
  private async gatewayPaymentSnapshot(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    tenantId: string,
    payment: FunctionalSnapshotFields & {
      amount: number;
      currency: string;
    },
    event: WebhookEvent,
  ): Promise<Record<string, unknown>> {
    const state = classifyFunctionalSnapshot(payment);

    if (state === 'COMPLETE') {
      return {};
    }

    if (state === 'PARTIAL_INVALID') {
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: 'PAYMENT_FUNCTIONAL_SNAPSHOT_INVALID',
        message: 'El pago posee un snapshot funcional incompleto o incoherente',
      });
    }

    if (!event.paidAt) {
      this.logger.error(
        `Webhook event ${event.eventId}: no provider economic date; no effective transition`,
      );
      throw new ServiceUnavailableException(
        'Webhook event missing provider economic date; manual review required',
      );
    }

    const tenant = await tx.tenant.findFirst({
      where: { id: tenantId },
      select: { functionalCurrency: true },
    });
    if (!tenant) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: 'PAYMENT_FUNCTIONAL_SNAPSHOT_INVALID',
        message: 'Tenant no encontrado para el snapshot del pago',
      });
    }

    return buildPaymentFunctionalSnapshot(
      (input) =>
        this.currencyConversionService.convert({
          tenantId: input.tenantId,
          amount: input.amount,
          originalCurrency: input.originalCurrency as Parameters<
            typeof this.currencyConversionService.convert
          >[0]['originalCurrency'],
          functionalCurrency: input.functionalCurrency as Parameters<
            typeof this.currencyConversionService.convert
          >[0]['functionalCurrency'],
          conversionDate: input.conversionDate,
        }),
      tenantId,
      {
        amountMinor: payment.amount,
        currencyCode: payment.currency,
        functionalCurrency: tenant.functionalCurrency,
        conversionDate: event.paidAt,
      },
    );
  }

  /**
   * Mirrors the ledger status computation: charge status derives exclusively
   * from its effective allocations. Never a direct PAID mutation.
   */
  private async recalculateChargeStatus(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    chargeId: string,
  ): Promise<void> {
    const charge = await tx.charge.findFirst({
      where: { id: chargeId },
      include: {
        paymentAllocations: {
          where: {
            payment: { status: { in: [...EFFECTIVE_PAYMENT_STATUSES] } },
          },
          select: { amount: true },
        },
      },
    });

    if (!charge) {
      return;
    }

    const totalAllocated = charge.paymentAllocations.reduce(
      (sum, allocation) => sum + allocation.amount,
      0,
    );

    let newStatus: ChargeStatus;
    if (totalAllocated === 0) {
      newStatus = ChargeStatus.PENDING;
    } else if (totalAllocated < charge.amount) {
      newStatus = ChargeStatus.PARTIAL;
    } else {
      newStatus = ChargeStatus.PAID;
    }

    if (newStatus !== charge.status) {
      await tx.charge.update({
        where: { id: chargeId },
        data: { status: newStatus, updatedAt: new Date() },
      });
    }
  }

  private async reconcilePaymentIfAllPaid(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    paymentId: string,
  ): Promise<void> {
    const payment = await tx.payment.findFirst({
      where: { id: paymentId },
      include: {
        paymentAllocations: { include: { charge: true } },
      },
    });

    if (!payment || !isEffectivePaymentStatus(payment.status)) {
      return;
    }

    const allPaid =
      payment.paymentAllocations.length > 0 &&
      payment.paymentAllocations.every(
        (allocation) => allocation.charge.status === ChargeStatus.PAID,
      );

    if (allPaid) {
      await tx.payment.update({
        where: { id: paymentId },
        data: { status: 'RECONCILED', updatedAt: new Date() },
      });
    }
  }

  /**
   * Get the status of a charge from the provider
   */
  async getChargeStatus(externalId: string): Promise<PaymentStatus> {
    if (!this.provider) throw new Error('Payment provider not configured');
    return this.provider.getChargeStatus(externalId);
  }
}
