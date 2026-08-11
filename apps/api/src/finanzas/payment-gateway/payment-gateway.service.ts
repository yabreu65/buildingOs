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
import { Prisma } from '@prisma/client';
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
import {
  assertPaymentAllocationCurrencyMode,
  createLockedAllocation,
  lockChargesForAllocation,
  lockPaymentForAllocation,
  recalculateLockedCharge,
  reconcilePaymentWhenConsumed,
} from '../payment-allocation-transaction';

/**
 * 3E2 fix: the gateway Payment.paidAt must derive from the SAME verified
 * provider economic date used for the FX snapshot (YYYY-MM-DD), never from
 * server processing time. Returns undefined for malformed days (defense).
 */
export function gatewayPaymentDate(day: string | undefined): Date | undefined {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return undefined;
  }
  const date = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== day) {
    return undefined;
  }
  return date;
}


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

    const providerReference = event.externalId?.trim();
    if (!providerReference) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        error: 'PAYMENT_PROVIDER_REFERENCE_REQUIRED',
        message: 'Paid webhook event missing provider reference',
      });
    }

    // Idempotency: check only after the event is known to require durable side effects.
    const isDuplicate = await this.idempotencyService.isProcessed(event.eventId, providerName);
    if (isDuplicate) {
      this.logger.log(`Webhook event ${event.eventId} already processed, skipping`);
      return { ...event, chargeUpdated: false };
    }

    const chargeUpdated = await this.applyPaidEvent(event, providerReference);

    if (chargeUpdated) {
      await this.idempotencyService.cacheProcessed(event.eventId, providerName);
    } else {
      // No durable side effects applied: do not mark processed so the
      // provider retries and the event stays in manual-review visibility.
      this.logger.error(
        `Webhook event ${event.eventId} left unprocessed: manual review required`,
      );
    }

    return { ...event, chargeUpdated };
  }

  private async applyPaidEvent(event: WebhookEvent, providerReference: string): Promise<boolean> {
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

    return this.prisma.$transaction(async (tx) => {
      const eventLockKey = `webhook:${this.provider?.providerName}:${event.eventId}`;
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${eventLockKey}, 0))`,
      );
      const processed = await tx.processedWebhookEvent.findUnique({
        where: {
          eventId_provider: {
            eventId: event.eventId,
            provider: this.provider!.providerName,
          },
        },
      });
      if (processed) return true;

      const discoveredPayments = await tx.payment.findMany({
        where: {
          tenantId: charge.tenantId,
          reference: providerReference,
        },
        select: { id: true },
        take: 2,
      });
      if (discoveredPayments.length !== 1) {
        this.logger.error(
          `Webhook event ${event.eventId}: expected one local payment with reference ${providerReference} for tenant ${charge.tenantId}, found ${discoveredPayments.length}; manual review required`,
        );
        return false;
      }
      const discoveredPayment = discoveredPayments[0];
      if (discoveredPayment === undefined) return false;
      const scope = {
        tenantId: charge.tenantId,
        buildingId: charge.buildingId,
        paymentId: discoveredPayment.id,
        chargeId: charge.id,
      };
      await lockPaymentForAllocation(tx, scope);
      const payment = await tx.payment.findFirst({
        where: { id: discoveredPayment.id, tenantId: charge.tenantId, buildingId: charge.buildingId },
        include: {
          paymentAllocations: { include: { charge: { select: { currency: true } } } },
        },
      });
      if (!payment) return false;
      await lockChargesForAllocation(tx, charge.tenantId, charge.buildingId, [charge.id]);
      const lockedCharge = await tx.charge.findFirst({
        where: { id: charge.id, tenantId: charge.tenantId, buildingId: charge.buildingId },
        include: {
          paymentAllocations: {
            include: { payment: { select: { id: true, status: true } } },
          },
        },
      });
      if (!lockedCharge) return false;
      const lockedOutstanding = lockedCharge.amount - lockedCharge.paymentAllocations.reduce(
        (sum, allocation) =>
          allocation.payment.id !== payment.id && isEffectivePaymentStatus(allocation.payment.status)
            ? sum + allocation.amount
            : sum,
        0,
      );
      if (verifiedAmount > lockedOutstanding) {
        throw new UnprocessableEntityException({
          statusCode: 422,
          error: 'PAYMENT_EVENT_AMOUNT_EXCEEDS_OUTSTANDING',
        });
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
        if (existingAllocation.amount !== verifiedAmount) {
          throw new UnprocessableEntityException({
            statusCode: 422,
            error: 'PAYMENT_PROVIDER_AMOUNT_MISMATCH',
          });
        }
      }

      assertPaymentAllocationCurrencyMode(payment.currency, payment.paymentAllocations);

      const alreadyAllocated = payment.paymentAllocations.reduce(
        (sum, allocation) => sum + allocation.amount,
        0,
      );
      if (!existingAllocation && alreadyAllocated + verifiedAmount > payment.amount) {
        throw new UnprocessableEntityException({
          statusCode: 422,
          error: 'PAYMENT_EVENT_AMOUNT_EXCEEDS_PAYMENT',
          message: 'El monto del evento supera el monto del pago local',
        });
      }

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
            paidAt: gatewayPaymentDate(event.paidAt),
            paymentEventId: event.eventId,
            updatedAt: new Date(),
            ...snapshotData,
          },
        });
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

      if (!existingAllocation) {
        await createLockedAllocation(tx, scope, verifiedAmount);
      } else {
        await recalculateLockedCharge(tx, charge.id);
        await reconcilePaymentWhenConsumed(tx, payment.id);
      }
      await tx.processedWebhookEvent.create({
        data: { eventId: event.eventId, provider: this.provider!.providerName },
      });

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
        this.currencyConversionService.convert(
          {
            tenantId: input.tenantId,
            amount: input.amount,
            originalCurrency: input.originalCurrency as Parameters<
              typeof this.currencyConversionService.convert
            >[0]['originalCurrency'],
            functionalCurrency: input.functionalCurrency as Parameters<
              typeof this.currencyConversionService.convert
            >[0]['functionalCurrency'],
            conversionDate: input.conversionDate,
          },
          tx,
        ),
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
   * Get the status of a charge from the provider
   */
  async getChargeStatus(externalId: string): Promise<PaymentStatus> {
    if (!this.provider) throw new Error('Payment provider not configured');
    return this.provider.getChargeStatus(externalId);
  }
}
