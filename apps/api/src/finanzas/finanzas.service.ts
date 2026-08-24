import { Injectable, ConflictException, NotFoundException, BadRequestException, Logger, PayloadTooLargeException, ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { Charge, Payment, PaymentAllocation, Prisma, ChargeStatus, PaymentStatus, PaymentMethod, AuditAction, PaymentAuditAction, RejectionReason, ReceiptStatus, ScopeType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FinanzasValidators } from './finanzas.validators';
import { PaymentReceiptService } from '../receipts/payment-receipt.service';
import type { AuthenticatedMembership, PortalContext } from '../common/types/request.types';
import { resolveNotificationPortalContext } from '../common/portal-context';
import { ExpensesService } from './expenses.service';
import { CurrencyConversionService } from './currency-conversion.service';
import {
  buildPaymentFunctionalSnapshot,
  classifyFunctionalSnapshot,
  type FunctionalSnapshotFields,
} from './functional-snapshot';
import {
  aggregatePaymentSideAllocations,
  assertPaymentAllocationCurrencyMode,
  createLockedAllocation,
  deleteLockedAllocation,
  lockChargesForAllocation,
  lockPaymentForAllocation,
  recalculateLockedCharge,
  reconcilePaymentWhenConsumed,
} from './payment-allocation-transaction';
import { calculateChargeOutstandingMinor } from './charge-aggregation';
import {
  aggregateReportBuckets,
  type ReportCurrencyAmountBucket,
} from './currency-buckets';
import { acquirePaymentLinkedDocumentLock } from '../common/payment-linked-document-lock';
import { isEffectivePaymentStatus as isEffectivePaymentStatusShared } from './payment-status-semantics';
import type { Role, ScopedRole } from '@buildingos/contracts';
import {
  CreateChargeDto,
  UpdateChargeDto,
  CancelChargeDto,
  SubmitPaymentDto,
  ApprovePaymentDto,
  RejectPaymentDto,
  CreateAllocationDto,
  ListChargesQueryDto,
  ListTenantChargesQueryDto,
  ListPaymentsQueryDto,
  ListPendingPaymentsQueryDto,
  FinancialSummaryDto,
  BuildingDelinquencyAging,
  BuildingDelinquencyItemDto,
  BuildingDelinquencyQueryDto,
  BuildingDelinquencyResponseDto,
  BuildingDelinquencySortBy,
  BuildingDelinquencySortOrder,
  PaymentMetricsQueryDto,
  PaymentMetricsDto,
  PaymentAuditLogDto,
  PaymentDuplicateCheckResultDto,
  UnitLedgerDto,
  MonthlyTrendDto,
  PaymentDetailDto,
} from './finanzas.dto';

export interface PendingPaymentListItem extends Omit<Payment, 'exchangeRateValue'> {
  exchangeRateValue: string | null;
  building?: { id: string; name: string } | null;
  unit?: { id: string; label: string | null } | null;
  createdByUser?: { id: string; name: string; email: string } | null;
  reviewedByMembership?: { id: string; user?: { name: string } | null } | null;
  proofFile?: { id: string } | null;
  proofDocumentId?: string | null;
}

type PaymentWithAllocationSummary = Prisma.PaymentGetPayload<{
  include: {
    paymentAllocations: {
      include: {
        charge: {
          select: {
            id: true;
            concept: true;
            amount: true;
            status: true;
            period: true;
          };
        };
      };
    };
  };
}>;

type SanitizedPayment<T extends { notes?: string | null }> = Omit<T, 'notes'> & {
  notes: string | null;
};

export interface BuildingFinancialSummaryPeriodFilter {
  period?: string;
  periods?: string[];
}

interface RawDelinquencyRow {
  unitId: string;
  unitCode: string;
  unitLabel: string;
  responsibleName: string | null;
  periodDebtByCurrency: Array<{ currency: string; amountMinor: bigint | number | string }>;
  accumulatedDebtByCurrency: Array<{ currency: string; amountMinor: bigint | number | string }>;
  overduePeriods: bigint | number | string;
}

interface RawDelinquencyCountRow {
  total: bigint | number | string;
}

interface RawDelinquencyTotalsRow {
  periodDebtByCurrency: Array<{ currency: string; amountMinor: bigint | number | string }> | null;
  accumulatedDebtByCurrency: Array<{ currency: string; amountMinor: bigint | number | string }> | null;
}

type ChargeWithAllocations = Prisma.ChargeGetPayload<{
  include: {
    paymentAllocations: {
      include: {
        payment: {
          select: {
            id: true;
            status: true;
          };
        };
      };
    };
  };
}>;

type PaymentWithAllocations = Prisma.PaymentGetPayload<{
  include: {
    paymentAllocations: {
      include: {
        charge: true;
      };
    };
  };
}>;

interface ResidentChargeSelectionItem {
  readonly charge: ChargeWithAllocations;
  readonly approvedOutstanding: number;
}

const RESIDENT_DIRECTED_PAYMENT_PREFIX = 'resident-charge-selection-requires-resubmission';
const PAYMENT_PROOF_MAX_BYTES = 10 * 1024 * 1024;
const TENANT_LEDGER_ROLES = new Set<string>([
  'SUPER_ADMIN',
  'TENANT_OWNER',
  'TENANT_ADMIN',
  'OPERATOR',
]);

const KNOWN_ROLES = {
  SUPER_ADMIN: true,
  TENANT_OWNER: true,
  TENANT_ADMIN: true,
  OPERATOR: true,
  RESIDENT: true,
} as const satisfies Record<Role, true>;

function isRole(value: string): value is Role {
  return value in KNOWN_ROLES;
}

@Injectable()
export class FinanzasService {
  private readonly logger = new Logger(FinanzasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly validators: FinanzasValidators,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
    private readonly receiptService: PaymentReceiptService,
    private readonly expensesService: ExpensesService,
    private readonly currencyConversionService: CurrencyConversionService,
  ) {}

  private toConversionDate(date: Date): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * 3E2: guarantee a COMPLETE functional snapshot before an effective
   * transition (SUBMITTED → APPROVED).
   *
   * - COMPLETE: reuse exactly, never reconvert.
   * - LEGACY_NULL: freeze with transferDate if present, else the definitive
   *   paidAt. Covers pre-3E2 SUBMITTED payments approved after rollout.
   * - PARTIAL_INVALID: block with a stable structured error.
   */
  private async paymentFunctionalSnapshot(
    client: Prisma.TransactionClient | PrismaService,
    tenantId: string,
    amountMinor: number,
    currencyCode: string,
    conversionDate: Date,
  ): Promise<{
    functionalAmountMinor: number;
    functionalCurrencyCode: string;
    exchangeRateId: string | null;
    exchangeRateValue: string;
    exchangeRateDirection: 'IDENTITY' | 'DIRECT' | 'INVERSE';
    exchangeRateEffectiveAt: Date | null;
    conversionDate: Date;
  }> {
    const tenant = await client.tenant.findFirst({
      where: { id: tenantId },
      select: { functionalCurrency: true },
    });

    if (!tenant) {
      throw new NotFoundException(`Tenant no encontrado: ${tenantId}`);
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
          client,
        ),
      tenantId,
      {
        amountMinor,
        currencyCode,
        functionalCurrency: tenant.functionalCurrency,
        conversionDate: this.toConversionDate(conversionDate),
      },
    );
  }

  private async ensurePaymentFunctionalSnapshot(
    tx: Prisma.TransactionClient,
    tenantId: string,
    payment: FunctionalSnapshotFields & {
      amount: number;
      currency: string;
      transferDate: Date | null;
    },
    paidAt: Date,
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

    const conversionDate = payment.transferDate ?? paidAt;
    return this.paymentFunctionalSnapshot(
      tx,
      tenantId,
      payment.amount,
      payment.currency,
      conversionDate,
    );
  }

  // ============================================================================
  // CHARGE OPERATIONS
  // ============================================================================

  /**
   * Create a new charge for a unit
   *
   * Security:
   * - Validates building belongs to tenant
   * - Validates unit belongs to building and tenant
   * - Admin/Operator only
   */
  async createCharge(
    tenantId: string,
    buildingId: string,
    userRoles: string[],
    userId: string,
    dto: CreateChargeDto,
  ): Promise<Charge> {
    // 1. Permission check
    if (!this.validators.canWriteCharges(userRoles)) {
      this.validators.throwForbidden('charges', 'create');
    }

    // 2. Validate building
    await this.validators.validateBuildingBelongsToTenant(
      tenantId,
      buildingId,
    );

    // 3. Validate unit
    await this.validators.validateUnitBelongsToBuildingAndTenant(
      tenantId,
      buildingId,
      dto.unitId,
    );

    // 4. Check for duplicate (unique per unit/period/concept)
    const existing = await this.prisma.charge.findFirst({
      where: {
        tenantId,
        buildingId,
        unitId: dto.unitId,
        period: dto.period || new Date().toISOString().substring(0, 7),
        concept: dto.concept,
        canceledAt: null, // Don't count canceled charges
      },
    });

    if (existing) {
      throw new ConflictException(
        `Charge already exists for this unit/period/concept`,
      );
    }

    // 5. Create charge with PENDING status
    const charge = await this.prisma.charge.create({
      data: {
        tenantId,
        buildingId,
        unitId: dto.unitId,
        period: dto.period || new Date().toISOString().substring(0, 7),
        type: dto.type,
        concept: dto.concept,
        amount: dto.amount,
        currency: dto.currency,
        dueDate: new Date(dto.dueDate),
        status: ChargeStatus.PENDING,
        createdByMembershipId: dto.createdByMembershipId,
      },
    });

    // Audit: CHARGE_CREATE
    void this.auditService.createLog({
      tenantId,
      actorUserId: userId,
      action: AuditAction.CHARGE_CREATE,
      entityType: 'Charge',
      entityId: charge.id,
      metadata: {
        unitId: dto.unitId,
        amount: dto.amount,
        type: dto.type,
        concept: dto.concept,
        period: charge.period,
      },
    });

    return charge;
  }

  /**
   * List charges for a building
   *
   * Security:
   * - For RESIDENT/OWNER: filtered to their units only (404 otherwise)
   * - For Admin/Operator: all building charges
   */
  async listCharges(
    tenantId: string,
    buildingId: string,
    userRoles: string[],
    userId: string,
    query: ListChargesQueryDto,
  ): Promise<(Charge & { paymentAllocations: PaymentAllocation[] })[]> {
    // 1. Validate building
    await this.validators.validateBuildingBelongsToTenant(
      tenantId,
      buildingId,
    );

    // 2. Build where clause
    const where: Prisma.ChargeWhereInput = {
      tenantId,
      buildingId,
      canceledAt: null, // Exclude canceled charges
    };

    // 3. Apply RESIDENT/OWNER scope
    if (this.validators.isResidentOrOwner(userRoles)) {
      const userUnitIds = await this.validators.getUserUnitIds(
        tenantId,
        userId,
      );
      if (userUnitIds.length === 0) {
        return []; // User has no assigned units
      }
      where.unitId = { in: userUnitIds };
    }

    // 4. Apply filters
    if (query.period) {
      where.period = query.period;
    }
    if (query.status) {
      where.status = query.status;
    }
    if (query.unitId) {
      // Validate unit access for RESIDENT/OWNER
      if (this.validators.isResidentOrOwner(userRoles)) {
        await this.validators.validateResidentUnitAccess(
          tenantId,
          userId,
          query.unitId,
        );
      }
      where.unitId = query.unitId;
    }

    // 5. Execute query
    const limit = Math.min(query.limit || 50, 500);
    const offset = query.offset || 0;

    return this.prisma.charge.findMany({
      where,
      orderBy: { dueDate: 'desc' },
      take: limit,
      skip: offset,
      include: {
        unit: {
          select: { id: true, label: true },
        },
        building: {
          select: { id: true, name: true },
        },
        paymentAllocations: true,
      },
    });
  }

  /**
   * Get a single charge detail
   *
   * Security:
   * - For RESIDENT/OWNER: only if unit is theirs (404 otherwise)
   */
  async getCharge(
    tenantId: string,
    buildingId: string,
    chargeId: string,
    userRoles: string[],
    userId: string,
  ): Promise<Charge & { paymentAllocations: PaymentAllocation[] }> {
    // 1. Validate charge belongs to building and tenant
    const charge = await this.prisma.charge.findFirst({
      where: {
        id: chargeId,
        tenantId,
        buildingId,
      },
      include: {
        paymentAllocations: true,
      },
    });

    if (!charge) {
      throw new NotFoundException(
        `Charge not found or does not belong to this building/tenant`,
      );
    }

    // 2. Validate RESIDENT/OWNER can only access their units
    if (this.validators.isResidentOrOwner(userRoles)) {
      await this.validators.validateResidentUnitAccess(
        tenantId,
        userId,
        charge.unitId,
      );
    }

    return charge;
  }

  /**
   * Update a charge
   *
   * Security:
   * - Admin/Operator only
   * - Cannot update if payment allocations exist
   */
  async updateCharge(
    tenantId: string,
    buildingId: string,
    chargeId: string,
    userRoles: string[],
    dto: UpdateChargeDto,
  ): Promise<Charge> {
    // 1. Permission check
    if (!this.validators.canWriteCharges(userRoles)) {
      this.validators.throwForbidden('charges', 'update');
    }

    // 2. Validate charge
    const charge = await this.prisma.charge.findFirst({
      where: {
        id: chargeId,
        tenantId,
        buildingId,
      },
      include: {
        paymentAllocations: true,
      },
    });

    if (!charge) {
      throw new NotFoundException(
        `Charge not found or does not belong to this building/tenant`,
      );
    }

    // 3. Cannot update if has allocations
    if (charge.paymentAllocations.length > 0) {
      throw new ConflictException(
        `Cannot update charge that has payment allocations`,
      );
    }

    // 4. Update
    return this.prisma.charge.update({
      where: { id: chargeId, tenantId },
      data: {
        ...dto,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Cancel a charge (soft delete)
   *
   * Security:
   * - Admin/Operator only
   */
  async cancelCharge(
    tenantId: string,
    buildingId: string,
    chargeId: string,
    userRoles: string[],
    userId: string,
    dto: CancelChargeDto,
  ): Promise<Charge> {
    // 1. Permission check
    if (!this.validators.canWriteCharges(userRoles)) {
      this.validators.throwForbidden('charges', 'cancel');
    }

    // 2. Validate and fetch charge
    await this.validators.validateChargeBelongsToBuildingAndTenant(
      tenantId,
      buildingId,
      chargeId,
    );

    const charge = await this.prisma.charge.findUnique({
      where: { id: chargeId },
    });

    // 2.5. A charge with effective (APPROVED/RECONCILED) payments cannot be
    // canceled: PaymentAllocation history must stay coherent. SUBMITTED
    // payments are only reservations and do not block cancellation.
    const effectiveAllocation = await this.prisma.paymentAllocation.findFirst({
      where: {
        tenantId,
        chargeId,
        payment: {
          status: {
            in: [PaymentStatus.APPROVED, PaymentStatus.RECONCILED],
          },
        },
      },
      select: { id: true },
    });

    if (effectiveAllocation) {
      throw new ConflictException({
        statusCode: 409,
        error: 'CHARGE_HAS_EFFECTIVE_ALLOCATIONS',
        message:
          'No se puede cancelar un cargo con pagos efectivos aplicados',
      });
    }

    // 3. Cancel
    const canceledCharge = await this.prisma.charge.update({
      where: { id: chargeId },
      data: {
        canceledAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // Audit: CHARGE_CANCEL
    void this.auditService.createLog({
      tenantId,
      actorUserId: userId,
      action: AuditAction.CHARGE_CANCEL,
      entityType: 'Charge',
      entityId: chargeId,
      metadata: {
        unitId: charge?.unitId,
        amount: charge?.amount,
        concept: charge?.concept,
        reason: dto.reason || 'No reason provided',
      },
    });

    return canceledCharge;
  }

  // ============================================================================
  // PAYMENT OPERATIONS
  // ============================================================================

  /**
   * Submit a payment (RESIDENT or ADMIN)
   *
   * Security:
   * - RESIDENT can only submit for their own units (unitId required and validated)
   * - ADMIN can submit for any unit
   */
  async submitPayment(
    tenantId: string,
    buildingId: string,
    userId: string,
    userRoles: string[],
    dto: SubmitPaymentDto,
    portalContext?: PortalContext,
  ): Promise<PaymentDetailDto> {
    // 1. Permission check
    if (!this.validators.canSubmitPayments(userRoles)) {
      this.validators.throwForbidden('payments', 'submit');
    }
    const isResidentPayment = this.validators.isResidentOrOwner(userRoles);

    // 2. Validate building
    await this.validators.validateBuildingBelongsToTenant(
      tenantId,
      buildingId,
    );

    // 3. If RESIDENT/OWNER, unitId is REQUIRED
    if (isResidentPayment) {
      if (!dto.unitId) {
        throw new BadRequestException(
          'RESIDENT must specify unitId when submitting a payment',
        );
      }
      await this.validators.validateResidentUnitAccess(
        tenantId,
        userId,
        dto.unitId,
      );
    }

    // 4. If unitId provided, validate it belongs to building
    if (dto.unitId) {
      await this.validators.validateUnitBelongsToBuildingAndTenant(
        tenantId,
        buildingId,
        dto.unitId,
      );
    }

    // 5. MVP payment provider policy: only bank transfers are supported in production.
    // Keep the wider enum for future providers, but reject unsupported methods at runtime.
    if (dto.method !== PaymentMethod.TRANSFER) {
      throw new BadRequestException(
        'Por ahora solo se aceptan pagos por transferencia bancaria',
      );
    }

    const requestedChargeIds = this.normalizeChargeSelection(dto);
    if (requestedChargeIds.length === 0) {
      throw new BadRequestException(
        'Debes seleccionar una o más obligaciones consecutivas para continuar.',
      );
    }

    if (!dto.unitId) {
      throw new BadRequestException(
        'Debes indicar la unidad para validar la selección de cargos',
      );
    }

    // 6. Duplicate detection: check for similar payments in last 48 hours
    const duplicateChargeIds = requestedChargeIds;
    const duplicateWindow = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const duplicatePayment = await this.prisma.payment.findFirst({
      where: {
        tenantId,
        buildingId,
        unitId: dto.unitId ?? undefined,
        amount: dto.amount,
        reference: dto.reference,
        createdAt: { gte: duplicateWindow },
        status: { in: [PaymentStatus.SUBMITTED, PaymentStatus.APPROVED] },
        ...(duplicateChargeIds.length > 0
          ? {
              paymentAllocations: {
                some: {
                  tenantId,
                  chargeId: { in: duplicateChargeIds },
                },
              },
            }
          : {}),
      },
    });

    if (duplicatePayment) {
      throw new ConflictException(
        `Posible pago duplicado detectado: Ya existe un pago con el mismo monto y referencia en las últimas 48 horas (ID: ${duplicatePayment.id}). Por favor verificá antes de continuar.`,
      );
    }

    // 7. Validate: TRANSFER method requires proofFileId
    if (!dto.proofFileId) {
      throw new BadRequestException(
        'Los pagos por transferencia requieren subir el comprobante de pago',
      );
    }
    {
      const payment = await this.prisma.$transaction(async (tx) => {
        await acquirePaymentLinkedDocumentLock(tx, tenantId, dto.proofFileId!);
        await this.validatePaymentProofFileInTransaction(tx, tenantId, dto.proofFileId!);

        if (isResidentPayment) {
          await this.validators.validateResidentUnitAccess(
            tenantId,
            userId,
            dto.unitId!,
          );
        }

        await this.validators.validateUnitBelongsToBuildingAndTenant(
          tenantId,
          buildingId,
          dto.unitId!,
        );

        await this.acquireResidentPaymentSelectionLock(
          tx,
          tenantId,
          buildingId,
          dto.unitId!,
        );

        const selectableCharges = await this.loadResidentChargeSelection(
          tx,
          tenantId,
          buildingId,
          dto.unitId!,
        );
        const canonicalSelection = this.validateCanonicalResidentChargeSelection(
          selectableCharges,
          requestedChargeIds,
        );
        const paymentCurrency = this.validateResidentChargeCurrencies(canonicalSelection);
        if (dto.currency && dto.currency !== paymentCurrency) {
          throw new BadRequestException(
            'La moneda del pago debe coincidir con la moneda de las obligaciones seleccionadas',
          );
        }

        const calculatedAmount = canonicalSelection.reduce(
          (sum, item) => sum + item.approvedOutstanding,
          0,
        );

        if (dto.amount !== calculatedAmount) {
          throw new ConflictException(
            'El monto ya no coincide con la deuda actual. Actualiza la información e inténtalo nuevamente.',
          );
        }

        // 3E2: when the resident declares a transferDate (economic bank day,
        // strict YYYY-MM-DD), the functional snapshot is frozen AT SUBMIT.
        // If the conversion fails the whole submit fails: no Payment and no
        // reservation allocations are created.
        const transferDate = dto.transferDate ? new Date(`${dto.transferDate}T00:00:00.000Z`) : null;
        const submitSnapshot = transferDate
          ? await this.paymentFunctionalSnapshot(
              tx,
              tenantId,
              calculatedAmount,
              paymentCurrency,
              transferDate,
            )
          : null;

        const payment = await tx.payment.create({
          data: {
            tenantId,
            buildingId,
            unitId: dto.unitId || null,
            amount: calculatedAmount,
            currency: paymentCurrency,
            method: dto.method,
            status: PaymentStatus.SUBMITTED,
            reference: dto.reference,
            proofFileId: dto.proofFileId || null,
            createdByUserId: userId,
            notes: this.createResidentDirectedPaymentMarker(),
            transferDate,
            ...(submitSnapshot ?? {}),
          },
        });
        await lockPaymentForAllocation(tx, {
          tenantId,
          buildingId,
          paymentId: payment.id,
        });
        await lockChargesForAllocation(
          tx,
          tenantId,
          buildingId,
          canonicalSelection.map(({ charge }) => charge.id),
        );
        const lockedSelection = this.validateCanonicalResidentChargeSelection(
          await this.loadResidentChargeSelection(tx, tenantId, buildingId, dto.unitId!),
          requestedChargeIds,
        );
        const lockedAmount = lockedSelection.reduce(
          (sum, item) => sum + item.approvedOutstanding,
          0,
        );
        if (lockedAmount !== calculatedAmount) {
          throw new ConflictException(
            'El monto ya no coincide con la deuda actual. Actualiza la información e inténtalo nuevamente.',
          );
        }
        assertPaymentAllocationCurrencyMode(
          payment.currency,
          lockedSelection.map((selection) => ({ charge: selection.charge })),
        );

        for (const selection of lockedSelection) {
          await tx.paymentAllocation.create({
            data: {
              tenantId,
              paymentId: payment.id,
              chargeId: selection.charge.id,
              amount: selection.approvedOutstanding,
              paymentOriginalAmountMinor: selection.approvedOutstanding,
            },
          });
        }

        await tx.paymentAuditLog.create({
          data: {
            tenantId,
            paymentId: payment.id,
            action: PaymentAuditAction.SUBMITTED,
            membershipId: null,
            reason: null,
            comment: null,
            metadata: {
              amount: payment.amount,
              currency: payment.currency,
              method: payment.method,
              reference: payment.reference,
              submittedByUserId: userId,
            },
          },
        });

        return payment;
      });

      if (resolveNotificationPortalContext(userRoles, portalContext) === 'resident') {
        void this.notifyAdminsOfPaymentSubmitted(tenantId, payment, userId);
      }
      return this.sanitizePaymentForResponse(payment);
    }
  }

  /**
   * List payments for a building
   *
   * Security:
   * - For RESIDENT/OWNER: filtered to their units only
   * - For Admin/Operator: all building payments
   */
  async listPayments(
    tenantId: string,
    buildingId: string,
    userRoles: string[],
    userId: string,
    query: ListPaymentsQueryDto,
  ): Promise<PendingPaymentListItem[]> {
    // 1. Validate building
    await this.validators.validateBuildingBelongsToTenant(
      tenantId,
      buildingId,
    );

    // 2. Build where clause
    const where: Prisma.PaymentWhereInput = {
      tenantId,
      buildingId,
      canceledAt: null, // Exclude soft-deleted payments
    };

    // 3. Apply RESIDENT/OWNER scope
    if (this.validators.isResidentOrOwner(userRoles)) {
      const userUnitIds = await this.validators.getUserUnitIds(
        tenantId,
        userId,
      );
      if (userUnitIds.length === 0) {
        return [];
      }
      where.unitId = { in: userUnitIds };
    }

    // 4. Apply filters
    if (query.status) {
      where.status = query.status;
    }
    if (query.unitId) {
      if (this.validators.isResidentOrOwner(userRoles)) {
        await this.validators.validateResidentUnitAccess(
          tenantId,
          userId,
          query.unitId,
        );
      }
      where.unitId = query.unitId;
    }

    // 5. Execute query
    const limit = Math.min(query.limit || 50, 500);
    const offset = query.offset || 0;

    const payments = await this.prisma.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        unit: {
          select: { id: true, label: true },
        },
        building: {
          select: { id: true, name: true },
        },
        paymentAllocations: true,
        createdByUser: {
          select: { id: true, name: true, email: true },
        },
        reviewedByMembership: {
          select: { id: true, user: { select: { name: true } } },
        },
        proofFile: {
          select: { id: true },
        },
      },
    });

    // Resolve proofDocumentId for each payment
    const paymentsWithProofDoc = payments.map((p) => ({
      ...p,
      proofDocumentId: p.proofFile?.id
        ? this.prisma.document.findUnique({
            where: { fileId: p.proofFile.id },
            select: { id: true },
          }).then((d) => d?.id)
        : null,
    }));

    const resolvedPayments = await Promise.all(
      paymentsWithProofDoc.map(async (p) => ({
        ...p,
        proofDocumentId: await p.proofDocumentId,
      }))
    );

    return resolvedPayments.map((payment) => this.sanitizePaymentForResponse(payment));
  }

  /**
   * Approve a payment
   *
   * Security:
   * - Admin/Operator only
   */
  async approvePayment(
    tenantId: string,
    buildingId: string,
    paymentId: string,
    userRoles: string[],
    membershipId: string,
    dto: ApprovePaymentDto,
    userId?: string,
  ): Promise<PaymentDetailDto> {
    // 1. Permission check
    if (!this.validators.canReviewPayments(userRoles)) {
      this.validators.throwForbidden('payments', 'approve');
    }

    const actorUserId = await this.resolvePaymentReviewerUserId(
      tenantId,
      membershipId,
      userId,
    );

    // 2. Approve payment with either resident-selected allocations or legacy FIFO allocation
    const result = await this.prisma.$transaction(async (tx) => {
      const payment = await this.lockSubmittedPaymentForApproval(
        tx,
        tenantId,
        paymentId,
        buildingId,
      );

      if (payment.status !== PaymentStatus.SUBMITTED) {
        throw new ConflictException(
          `Cannot approve payment in status ${payment.status}. Only SUBMITTED payments can be approved.`,
        );
      }

      if (payment.canceledAt) {
        throw new ConflictException('Cannot approve a canceled payment');
      }

      if (payment.paymentAllocations.length === 0) {
        throw new ConflictException(
          'El pago no tiene cargos asociados para validar la selección. Reenviá el pago con una selección válida.',
        );
      }

      const lockedSelection = await this.validateResidentPaymentAllocationsForApproval(
        tx,
        tenantId,
        buildingId,
        payment,
      );
      assertPaymentAllocationCurrencyMode(
        payment.currency,
        lockedSelection.map((selection) => ({ charge: selection.charge })),
      );
      const paidAt = dto.paidAt ? new Date(dto.paidAt) : new Date();
      const snapshot = await this.ensurePaymentFunctionalSnapshot(
        tx,
        tenantId,
        payment,
        paidAt,
      );
      const approvedPayment = await this.persistPaymentApproval(
        tx,
        tenantId,
        payment,
        membershipId,
        actorUserId,
        paidAt,
        snapshot,
      );

      // 3E1: the payment's allocations became effective at APPROVED, so the
      // affected charges must be recalculated from effective allocations only
      // (a SUBMITTED reservation must never mark PARTIAL/PAID).
      const affectedChargeIds = payment.paymentAllocations.map(
        (allocation) => allocation.chargeId,
      );
      for (const chargeId of affectedChargeIds) {
        await this.recalculateChargeStatus(chargeId, tx);
      }

      await this.tryReconcilePayment(payment.id, tx);
      return approvedPayment;
    });

    // Global audit remains best-effort; the financial PaymentAuditLog above is strict.
    void this.auditService.createLog({
      tenantId,
      actorUserId,
      actorMembershipId: membershipId,
      action: AuditAction.PAYMENT_APPROVE,
      entityType: 'Payment',
      entityId: paymentId,
      metadata: {
        amount: result.amount,
        paidAt: result.paidAt?.toISOString() ?? null,
        fifoAllocated: result.unitId ? true : false,
      },
    });

    // [PHASE 2 QUICK #3] Send PAYMENT_RECEIVED notification
    void this.sendPaymentReceivedNotification(tenantId, result, actorUserId);

    // Generate receipt for approved payment (async, non-blocking)
    void this.receiptService.ensureReceiptForPayment(tenantId, paymentId, actorUserId).catch((err) => {
      this.logger.error(`Failed to generate receipt for payment ${paymentId}: ${err.message}`);
    });

    return this.sanitizePaymentForResponse(result);
  }

  /**
   * Reject a payment
   *
   * Security:
   * - Admin/Operator only
   */
  async rejectPayment(
    tenantId: string,
    buildingId: string,
    paymentId: string,
    userRoles: string[],
    membershipId: string,
    dto: RejectPaymentDto,
  ): Promise<PaymentDetailDto> {
    if (!this.validators.canReviewPayments(userRoles)) {
      this.validators.throwForbidden('payments', 'reject');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const payment = await this.lockSubmittedPaymentForApproval(
        tx,
        tenantId,
        paymentId,
        buildingId,
      );

      if (payment.status !== PaymentStatus.SUBMITTED) {
        throw new BadRequestException(
          `Cannot reject payment in status ${payment.status}. Only SUBMITTED payments can be rejected.`,
        );
      }

      if (payment.canceledAt) {
        throw new BadRequestException('Cannot reject a canceled payment');
      }

      await this.releaseSubmittedPaymentAllocations(
        tx,
        paymentId,
        tenantId,
        buildingId,
      );
      const rejectedPayment = await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: PaymentStatus.REJECTED,
          reviewedByMembershipId: membershipId,
          rejectionReason: dto.reason,
          rejectionComment: dto.comment || null,
          reviewedAt: new Date(),
          notes: this.mergeResidentResubmissionMarker(payment.notes, dto.notes),
          updatedAt: new Date(),
        },
      });

      await tx.paymentAuditLog.create({
        data: {
          tenantId,
          paymentId,
          action: PaymentAuditAction.REJECTED,
          membershipId,
          reason: dto.reason,
          comment: dto.comment || null,
          metadata: {
            amount: payment.amount,
            currency: payment.currency,
            method: payment.method,
            reference: payment.reference,
          },
        },
      });

      return rejectedPayment;
    });

    const actorUserId = await this.resolveMembershipUserId(tenantId, membershipId);
    void this.sendPaymentRejectedNotification(tenantId, result, dto.reason, actorUserId ?? undefined);

    return this.sanitizePaymentForResponse(result);
  }

  // ============================================================================
  // ALLOCATION OPERATIONS
  // ============================================================================

  /**
   * Create a payment allocation
   *
   * Security:
   * - Admin/Operator only
   * - Cannot exceed payment amount
   * - Uses transaction for atomicity
   * - Recalculates charge status and attempts payment reconciliation
   */
  async createAllocation(
    tenantId: string,
    buildingId: string,
    userRoles: string[],
    membershipId: string,
    dto: CreateAllocationDto,
  ): Promise<PaymentAllocation> {
    // 1. Permission check
    if (!this.validators.canAllocate(userRoles)) {
      this.validators.throwForbidden('allocations', 'create');
    }

    // 2. Validate building
    await this.validators.validateBuildingBelongsToTenant(
      tenantId,
      buildingId,
    );

    return this.prisma.$transaction(async (tx) => {
      const scope = { tenantId, buildingId, paymentId: dto.paymentId, chargeId: dto.chargeId };
      await lockPaymentForAllocation(tx, scope);
      const payment = await tx.payment.findFirst({
        where: { id: dto.paymentId, tenantId, buildingId },
        select: { unitId: true, currency: true },
      });
      if (!payment) {
        throw new NotFoundException(
          'Payment not found or does not belong to this building/tenant',
        );
      }
      if (!payment.unitId) throw new ConflictException('Payment must belong to a unit');
      await lockChargesForAllocation(tx, tenantId, buildingId, [dto.chargeId]);
      const charge = await tx.charge.findFirst({
        where: { id: dto.chargeId, tenantId, buildingId },
        select: { id: true },
      });
      if (!charge) {
        throw new NotFoundException(
          'Charge not found or does not belong to this building/tenant',
        );
      }
      const selectableCharges = await this.loadResidentChargeSelection(
        tx, tenantId, buildingId, payment.unitId,
      );
      const expectedCharge = selectableCharges[0];
      if (!expectedCharge || expectedCharge.charge.id !== dto.chargeId) {
        throw new ConflictException('Solo puedes asignar pagos siguiendo la obligación más antigua pendiente.');
      }
      if (payment.currency === expectedCharge.charge.currency
        ? dto.amount !== expectedCharge.approvedOutstanding
        : dto.amount > expectedCharge.approvedOutstanding) {
        throw new ConflictException('La asignación supera o no completa el saldo pendiente del cargo.');
      }
      const allocation = await createLockedAllocation(tx, scope, dto.amount);

      // Audit: PAYMENT_ALLOCATE
      void this.auditService.createLog({
        tenantId,
        actorUserId: membershipId,
        action: AuditAction.PAYMENT_ALLOCATE,
        entityType: 'PaymentAllocation',
        entityId: allocation.id,
        metadata: {
          paymentId: dto.paymentId,
          chargeId: dto.chargeId,
          amount: dto.amount,
        },
      });

      return allocation;
    });
  }

  /**
   * Delete a payment allocation
   *
   * Security:
   * - Admin/Operator only
   * - Uses transaction for atomicity
   * - Recalculates charge status and attempts payment reconciliation
   */
  async deleteAllocation(
    tenantId: string,
    buildingId: string,
    allocationId: string,
    userRoles: string[],
    membershipId: string,
  ): Promise<void> {
    // 1. Permission check
    if (!this.validators.canAllocate(userRoles)) {
      this.validators.throwForbidden('allocations', 'delete');
    }

    return this.prisma.$transaction(async (tx) => {
      const allocation = await deleteLockedAllocation(tx, tenantId, buildingId, allocationId);

      // Audit: ALLOCATION_DELETE (before deletion)
      void this.auditService.createLog({
        tenantId,
        actorUserId: membershipId,
        action: AuditAction.ALLOCATION_DELETE,
        entityType: 'PaymentAllocation',
        entityId: allocationId,
        metadata: {
          paymentId: allocation.paymentId,
          chargeId: allocation.chargeId,
          amount: allocation.amount,
        },
      });

    });
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Recalculate charge status based on payment allocations sum
   *
   * Rules:
   * - allocations_sum == 0 → PENDING
   * - 0 < allocations_sum < amount → PARTIAL
   * - allocations_sum >= amount → PAID
   *
   * @param chargeId - ID of charge to recalculate
   * @param tx - Optional Prisma transaction client (for use within transactions)
   */
  private async recalculateChargeStatus(
    chargeId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;

    const charge = await client.charge.findUnique({
      where: { id: chargeId },
      include: {
        paymentAllocations: {
          include: {
            payment: true,
          },
        },
      },
    });

    if (!charge) return;

    const allocationsSum = charge.paymentAllocations.reduce(
      (sum, a) => {
        if (this.isEffectivePaymentStatus(a.payment?.status)) {
          return sum + a.amount;
        }
        return sum;
      },
      0,
    );

    let newStatus: ChargeStatus;
    if (allocationsSum === 0) {
      newStatus = ChargeStatus.PENDING;
    } else if (allocationsSum < charge.amount) {
      newStatus = ChargeStatus.PARTIAL;
    } else {
      newStatus = ChargeStatus.PAID;
    }

    if (newStatus !== charge.status) {
      await client.charge.update({
        where: { id: chargeId },
        data: {
          status: newStatus,
          updatedAt: new Date(),
        },
      });
    }
  }

  private async releaseSubmittedPaymentAllocations(
    tx: Prisma.TransactionClient,
    paymentId: string,
    tenantId: string,
    buildingId: string,
  ): Promise<Array<{ chargeId: string; amount: number }>> {
    const allocations = await tx.paymentAllocation.findMany({
      where: {
        tenantId,
        paymentId,
      },
      select: {
        chargeId: true,
        amount: true,
      },
    });

    if (allocations.length === 0) {
      return [];
    }

    await lockChargesForAllocation(
      tx,
      tenantId,
      buildingId,
      allocations.map((allocation) => allocation.chargeId),
    );
    const lockedAllocations = await tx.paymentAllocation.findMany({
      where: {
        tenantId,
        paymentId,
        charge: { tenantId, buildingId },
      },
      select: { chargeId: true, amount: true },
    });

    await tx.paymentAllocation.deleteMany({
      where: {
        tenantId,
        paymentId,
        chargeId: { in: lockedAllocations.map((allocation) => allocation.chargeId) },
      },
    });
    for (const chargeId of [...new Set(lockedAllocations.map((allocation) => allocation.chargeId))].sort()) {
      await recalculateLockedCharge(tx, chargeId);
    }
    return lockedAllocations;
  }

  private async validatePaymentProofFileInTransaction(
    tx: Prisma.TransactionClient,
    tenantId: string,
    proofFileId: string,
  ): Promise<void> {
    const proofFile = await tx.file.findFirst({
      where: { id: proofFileId, tenantId },
      select: { id: true, size: true },
    });

    if (!proofFile) {
      throw new NotFoundException('El comprobante de pago no existe en este tenant');
    }

    if (proofFile.size <= 0) {
      throw new BadRequestException('El comprobante de pago no puede estar vacío');
    }

    if (proofFile.size > PAYMENT_PROOF_MAX_BYTES) {
      throw new PayloadTooLargeException('El comprobante de pago supera el máximo de 10 MB');
    }
  }

  private createResidentDirectedPaymentMarker(): string {
    return RESIDENT_DIRECTED_PAYMENT_PREFIX;
  }

  private hasResidentDirectedPaymentMarker(notes: string | null | undefined): boolean {
    return notes?.split('\n').some((line) => line === RESIDENT_DIRECTED_PAYMENT_PREFIX) ?? false;
  }

  private mergeResidentResubmissionMarker(
    existingNotes: string | null | undefined,
    reviewerNotes: string | undefined,
  ): string | null {
    if (!this.hasResidentDirectedPaymentMarker(existingNotes)) {
      return reviewerNotes || null;
    }

    return reviewerNotes
      ? `${RESIDENT_DIRECTED_PAYMENT_PREFIX}\n${reviewerNotes}`
      : RESIDENT_DIRECTED_PAYMENT_PREFIX;
  }

  private stripInternalPaymentMarkers(notes: string | null | undefined): string | null {
    if (!notes) {
      return null;
    }

    const publicNotes = notes
      .split('\n')
      .filter((line) => line !== RESIDENT_DIRECTED_PAYMENT_PREFIX)
      .join('\n');

    return publicNotes || null;
  }

  private sanitizePaymentForResponse<
    T extends { notes?: string | null; exchangeRateValue?: unknown },
  >(payment: T): SanitizedPayment<T> & { exchangeRateValue?: string | null } {
    const publicNotes = this.stripInternalPaymentMarkers(payment.notes);
    const { notes: _internalNotes, exchangeRateValue, ...publicPayment } = payment;

    return {
      ...publicPayment,
      notes: publicNotes,
      ...(exchangeRateValue === null || exchangeRateValue === undefined
        ? { exchangeRateValue: null }
        : { exchangeRateValue: (exchangeRateValue as { toString(): string }).toString() }),
    } as SanitizedPayment<T> & { exchangeRateValue?: string | null };
  }

  private calculateApprovedChargeOutstanding(charge: ChargeWithAllocations): number {
    return calculateChargeOutstandingMinor(charge);
  }

  private calculatePendingReservationAmount(
    charge: ChargeWithAllocations,
    currentPaymentId?: string,
  ): number {
    return charge.paymentAllocations.reduce((sum, allocation) => {
      if (allocation.payment?.id === currentPaymentId) {
        return sum;
      }

      if (allocation.payment?.status === PaymentStatus.SUBMITTED) {
        return sum + allocation.amount;
      }

      return sum;
    }, 0);
  }

  private async loadResidentChargeSelection(
    tx: Prisma.TransactionClient,
    tenantId: string,
    buildingId: string,
    unitId: string,
    currentPaymentId?: string,
  ): Promise<ResidentChargeSelectionItem[]> {
    const charges = await tx.charge.findMany({
      where: {
        tenantId,
        buildingId,
        unitId,
        canceledAt: null,
      },
      include: {
        paymentAllocations: {
          include: {
            payment: {
              select: {
                id: true,
                status: true,
              },
            },
          },
        },
      },
      orderBy: [
        { dueDate: 'asc' },
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
    });

    const selectablePrefix: ResidentChargeSelectionItem[] = [];

    for (const charge of charges) {
      const approvedOutstanding = this.calculateApprovedChargeOutstanding(charge);
      if (approvedOutstanding <= 0) {
        continue;
      }

      const pendingReservation = this.calculatePendingReservationAmount(
        charge,
        currentPaymentId,
      );
      if (pendingReservation > 0) {
        break;
      }

      selectablePrefix.push({
        charge,
        approvedOutstanding,
      });
    }

    return selectablePrefix;
  }

  private normalizeChargeSelection(dto: SubmitPaymentDto): string[] {
    const selectedChargeIds = dto.chargeIds?.length
      ? dto.chargeIds
      : dto.chargeId
        ? [dto.chargeId]
        : [];

    return selectedChargeIds
      .map((chargeId) => chargeId.trim())
      .filter((chargeId) => chargeId.length > 0);
  }

  private validateCanonicalResidentChargeSelection(
    selectableCharges: ResidentChargeSelectionItem[],
    requestedChargeIds: readonly string[],
  ): ResidentChargeSelectionItem[] {
    if (requestedChargeIds.length === 0) {
      throw new BadRequestException(
        'Debes seleccionar una o más obligaciones consecutivas para continuar.',
      );
    }

    const requestedSet = new Set(requestedChargeIds);
    if (requestedSet.size !== requestedChargeIds.length) {
      throw new BadRequestException(
        'La selección contiene IDs duplicados o inválidos.',
      );
    }

    const selectedCharges = selectableCharges.filter(({ charge }) => requestedSet.has(charge.id));

    if (selectedCharges.length !== requestedSet.size) {
      throw new ConflictException(
        'La selección ya no coincide con las obligaciones pendientes más antiguas. Actualiza la información e inténtalo nuevamente.',
      );
    }

    const canonicalSelection = selectableCharges.slice(0, selectedCharges.length);
    const canonicalSelectionIds = canonicalSelection.map(({ charge }) => charge.id);
    const selectedIds = selectedCharges.map(({ charge }) => charge.id);

    if (canonicalSelectionIds.length !== selectedIds.length) {
      throw new ConflictException(
        'La selección ya no coincide con las obligaciones pendientes más antiguas. Actualiza la información e inténtalo nuevamente.',
      );
    }

    for (let index = 0; index < canonicalSelectionIds.length; index += 1) {
      if (canonicalSelectionIds[index] !== selectedIds[index]) {
        throw new ConflictException(
          'Solo puedes pagar períodos consecutivos desde la deuda más antigua.',
        );
      }
    }

    return canonicalSelection;
  }

  private validateResidentChargeCurrencies(
    selection: ResidentChargeSelectionItem[],
  ): string {
    const [firstSelection] = selection;
    if (!firstSelection) {
      throw new BadRequestException(
        'No hay obligaciones elegibles para pagar en este momento.',
      );
    }

    const currency = firstSelection.charge.currency;
    if (selection.some(({ charge }) => charge.currency !== currency)) {
      throw new BadRequestException(
        'No se pueden mezclar monedas dentro del mismo pago.',
      );
    }

    return currency;
  }

  private async acquireResidentPaymentSelectionLock(
    tx: Prisma.TransactionClient,
    tenantId: string,
    buildingId: string,
    unitId: string,
  ): Promise<void> {
    const selectionLockKey = `resident-payment-selection:${tenantId}:${buildingId}:${unitId}`;
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${selectionLockKey}, 0))`,
    );
  }

  private async validateResidentPaymentAllocationsForApproval(
    tx: Prisma.TransactionClient,
    tenantId: string,
    buildingId: string,
    payment: PaymentWithAllocations,
  ): Promise<ResidentChargeSelectionItem[]> {
    const selectedChargeIds = payment.paymentAllocations.map((allocation) => allocation.chargeId);
    if (selectedChargeIds.length === 0) {
      throw new ConflictException(
        'El pago no tiene cargos asociados para validar la selección.',
      );
    }

    const selectedCharges = await tx.charge.findMany({
      where: {
        tenantId,
        buildingId,
        id: { in: selectedChargeIds },
        canceledAt: null,
      },
      select: {
        id: true,
        unitId: true,
        buildingId: true,
      },
      orderBy: [
        { dueDate: 'asc' },
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
    });

    if (selectedCharges.length !== selectedChargeIds.length) {
      throw new ConflictException(
        'El pago contiene cargos fuera de la unidad o edificio permitidos.',
      );
    }

    const selectedUnitId = payment.unitId ?? selectedCharges[0]?.unitId;
    if (!selectedUnitId) {
      throw new ConflictException(
        'El pago no tiene una unidad asociada para validar la selección de cargos.',
      );
    }

    if (selectedCharges.some((charge) => charge.unitId !== selectedUnitId || charge.buildingId !== buildingId)) {
      throw new ConflictException(
        'El pago contiene cargos fuera de la unidad o edificio permitidos.',
      );
    }

    await this.acquireResidentPaymentSelectionLock(
      tx,
      tenantId,
      buildingId,
      selectedUnitId,
    );

    for (const chargeId of [...selectedChargeIds].sort()) {
      await this.lockChargeForApproval(tx, tenantId, buildingId, chargeId);
    }

    const selectableCharges = await this.loadResidentChargeSelection(
      tx,
      tenantId,
      buildingId,
      selectedUnitId,
      payment.id,
    );
    const canonicalSelection = this.validateCanonicalResidentChargeSelection(
      selectableCharges,
      selectedChargeIds,
    );

    const totalAllocated = payment.paymentAllocations.reduce(
      (sum, allocation) => sum + allocation.amount,
      0,
    );
    const totalOutstanding = canonicalSelection.reduce(
      (sum, selection) => sum + selection.approvedOutstanding,
      0,
    );

    if (totalAllocated !== totalOutstanding) {
      throw new ConflictException(
        'El monto ya no coincide con la deuda actual. Actualiza la información e inténtalo nuevamente.',
      );
    }

    const allocationMap = new Map(
      payment.paymentAllocations.map((allocation) => [allocation.chargeId, allocation.amount]),
    );
    const currency = this.validateResidentChargeCurrencies(canonicalSelection);

    if (payment.currency !== currency) {
      throw new ConflictException(
        'La moneda del pago ya no coincide con la deuda actual. Actualiza la información e inténtalo nuevamente.',
      );
    }

    for (const selection of canonicalSelection) {
      const allocationAmount = allocationMap.get(selection.charge.id);
      if (allocationAmount !== selection.approvedOutstanding) {
        throw new ConflictException(
          'El monto ya no coincide con la deuda actual. Actualiza la información e inténtalo nuevamente.',
        );
      }
    }

    return canonicalSelection;
  }

  private async lockChargeForApproval(
    tx: Prisma.TransactionClient,
    tenantId: string,
    buildingId: string,
    chargeId: string,
  ): Promise<void> {
    await tx.$queryRaw(
      Prisma.sql`SELECT 1 FROM "Charge" WHERE id = ${chargeId} AND "tenantId" = ${tenantId} AND "buildingId" = ${buildingId} FOR UPDATE`,
    );
  }

  private async lockSubmittedPaymentForApproval(
    tx: Prisma.TransactionClient,
    tenantId: string,
    paymentId: string,
    buildingId?: string,
  ): Promise<PaymentWithAllocations> {
    if (buildingId) {
      await tx.$queryRaw(
        Prisma.sql`SELECT 1 FROM "Payment" WHERE id = ${paymentId} AND "tenantId" = ${tenantId} AND "buildingId" = ${buildingId} FOR UPDATE`,
      );
    } else {
      await tx.$queryRaw(
        Prisma.sql`SELECT 1 FROM "Payment" WHERE id = ${paymentId} AND "tenantId" = ${tenantId} FOR UPDATE`,
      );
    }

    const payment = await tx.payment.findFirst({
      where: {
        id: paymentId,
        tenantId,
        ...(buildingId ? { buildingId } : {}),
      },
      include: {
        paymentAllocations: {
          include: {
            charge: true,
          },
        },
      },
    });

    if (!payment) {
      throw buildingId
        ? new NotFoundException(
          'Payment not found or does not belong to this building/tenant',
        )
        : new NotFoundException('Payment not found');
    }

    return payment;
  }

  private isEffectivePaymentStatus(status?: PaymentStatus | null): boolean {
    return isEffectivePaymentStatusShared(status);
  }

  // ============================================================================
  // SUMMARY & DELINQUENCY OPERATIONS
  // ============================================================================

  async getBuildingDelinquency(
    tenantId: string,
    buildingId: string,
    query: BuildingDelinquencyQueryDto,
  ): Promise<BuildingDelinquencyResponseDto> {
    await this.validators.validateBuildingBelongsToTenant(tenantId, buildingId);

    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { currency: true },
    });
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const skip = (page - 1) * pageSize;
    const search = query.search?.trim();
    const searchPattern = search ? `%${search}%` : null;

    const searchClause = searchPattern
      ? Prisma.sql`AND (
          unit_rows."unitCode" ILIKE ${searchPattern}
          OR unit_rows."unitLabel" ILIKE ${searchPattern}
          OR unit_rows."responsibleName" ILIKE ${searchPattern}
        )`
      : Prisma.empty;
    const agingClause = this.buildDelinquencyAgingClause(query.aging);
    const orderBy = this.getDelinquencyOrderBy(query.sortBy, query.sortOrder);

    const baseQuery = Prisma.sql`
      WITH charge_balances AS (
        SELECT
          charge."unitId",
          charge.period,
          charge.currency,
          GREATEST(
            charge.amount - COALESCE(
              SUM(
                CASE
                  WHEN payment.status IN ('APPROVED', 'RECONCILED')
                    THEN allocation.amount
                  ELSE 0
                END
              ),
              0
            ),
            0
          ) AS outstanding
        FROM "Charge" AS charge
        LEFT JOIN "PaymentAllocation" AS allocation
          ON allocation."chargeId" = charge.id
          AND allocation."tenantId" = ${tenantId}
        LEFT JOIN "Payment" AS payment
          ON payment.id = allocation."paymentId"
          AND payment."tenantId" = ${tenantId}
          AND payment."canceledAt" IS NULL
        WHERE charge."tenantId" = ${tenantId}
          AND charge."buildingId" = ${buildingId}
          AND charge."canceledAt" IS NULL
          AND charge.period <= ${query.period}
        GROUP BY charge.id, charge."unitId", charge.period, charge.currency, charge.amount
      ),
      unit_debts AS (
        SELECT
          "unitId",
          currency,
          SUM(CASE WHEN period = ${query.period} THEN outstanding ELSE 0 END) AS "periodDebt",
          SUM(outstanding) AS "accumulatedDebt",
          COUNT(DISTINCT period) FILTER (WHERE outstanding > 0) AS "overduePeriods"
        FROM charge_balances
        GROUP BY "unitId", currency
        HAVING SUM(CASE WHEN period = ${query.period} THEN outstanding ELSE 0 END) > 0
      ),
      unit_rows AS (
        SELECT
          debt."unitId",
          unit.code AS "unitCode",
          COALESCE(unit.label, unit.code) AS "unitLabel",
          responsible.name AS "responsibleName",
          debt.currency,
          debt."periodDebt",
          debt."accumulatedDebt",
          debt."overduePeriods"
        FROM unit_debts AS debt
        INNER JOIN "Unit" AS unit
          ON unit.id = debt."unitId"
          AND unit."tenantId" = ${tenantId}
          AND unit."buildingId" = ${buildingId}
        LEFT JOIN LATERAL (
          SELECT member.name
          FROM "UnitOccupant" AS occupant
          INNER JOIN "TenantMember" AS member
            ON member.id = occupant."memberId"
            AND member."tenantId" = ${tenantId}
            AND member."disabledAt" IS NULL
            AND member.status = 'ACTIVE'
          WHERE occupant."tenantId" = ${tenantId}
            AND occupant."unitId" = unit.id
            AND occupant."endDate" IS NULL
          ORDER BY occupant."isPrimary" DESC, occupant."startDate" ASC
          LIMIT 1
        ) AS responsible ON TRUE
      ),
      unit_debts_per_currency AS (
        SELECT
          "unitId",
          json_agg(
            json_build_object(
              'currency', currency,
              'amountMinor', "periodDebt"
            ) ORDER BY currency
          ) AS "periodDebtByCurrency",
          json_agg(
            json_build_object(
              'currency', currency,
              'amountMinor', "accumulatedDebt"
            ) ORDER BY currency
          ) AS "accumulatedDebtByCurrency",
          MAX("overduePeriods") AS "overduePeriods",
          MAX(CASE WHEN currency = ${tenant.currency} THEN "periodDebt" ELSE 0 END) AS "periodDebtSort",
          MAX(CASE WHEN currency = ${tenant.currency} THEN "accumulatedDebt" ELSE 0 END) AS "accumulatedDebtSort"
        FROM unit_rows
        GROUP BY "unitId"
      ),
      filtered_units AS (
        SELECT
          rows."unitId",
          rows."unitCode",
          rows."unitLabel",
          rows."responsibleName",
          buckets."periodDebtByCurrency",
          buckets."accumulatedDebtByCurrency",
          buckets."overduePeriods",
          buckets."periodDebtSort",
          buckets."accumulatedDebtSort"
        FROM (
          SELECT DISTINCT
            "unitId",
            "unitCode",
            "unitLabel",
            "responsibleName"
          FROM unit_rows
        ) AS rows
        INNER JOIN unit_debts_per_currency AS buckets
          ON buckets."unitId" = rows."unitId"
        WHERE TRUE
        ${searchClause}
        ${agingClause}
      )
    `;

    const [items, countRows, totalsRows] = await this.prisma.$transaction([
      this.prisma.$queryRaw<RawDelinquencyRow[]>(Prisma.sql`
        ${baseQuery}
        SELECT
          "unitId",
          "unitCode",
          "unitLabel",
          "responsibleName",
          "periodDebtByCurrency",
          "accumulatedDebtByCurrency",
          "overduePeriods"
        FROM filtered_units
        ORDER BY ${orderBy}
        LIMIT ${pageSize}
        OFFSET ${skip}
      `),
      this.prisma.$queryRaw<RawDelinquencyCountRow[]>(Prisma.sql`
        ${baseQuery}
        SELECT COUNT(*) AS total
        FROM filtered_units
      `),
      this.prisma.$queryRaw<RawDelinquencyTotalsRow[]>(Prisma.sql`
        ${baseQuery}
        SELECT
          COALESCE(
            json_agg(
              json_build_object(
                'currency', currency,
                'amountMinor', "periodDebt"
              ) ORDER BY currency
            ),
            '[]'::json
          ) AS "periodDebtByCurrency",
          COALESCE(
            json_agg(
              json_build_object(
                'currency', currency,
                'amountMinor', "accumulatedDebt"
              ) ORDER BY currency
            ),
            '[]'::json
          ) AS "accumulatedDebtByCurrency"
        FROM (
          SELECT
            currency,
            SUM("periodDebt") AS "periodDebt",
            SUM("accumulatedDebt") AS "accumulatedDebt"
          FROM unit_rows
          GROUP BY currency
        ) AS totals_by_currency
      `),
    ]);

    const total = this.toSafeFinancialNumber(countRows[0]?.total ?? 0);
    const totals = totalsRows[0] ?? { periodDebtByCurrency: null, accumulatedDebtByCurrency: null };
    const periodDebtByCurrency = totals.periodDebtByCurrency ?? [];
    const accumulatedDebtByCurrency = totals.accumulatedDebtByCurrency ?? [];

    return {
      items: items.map((item) => this.mapDelinquencyItem(item)),
      page,
      pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
      totals: {
        periodDebtByCurrency: periodDebtByCurrency.map((bucket) => ({
          currency: bucket.currency,
          amountMinor: this.toSafeFinancialNumber(bucket.amountMinor),
        })),
        accumulatedDebtByCurrency: accumulatedDebtByCurrency.map((bucket) => ({
          currency: bucket.currency,
          amountMinor: this.toSafeFinancialNumber(bucket.amountMinor),
        })),
      },
    };
  }

  private buildDelinquencyAgingClause(
    aging: BuildingDelinquencyAging | undefined,
  ): Prisma.Sql {
    switch (aging) {
      case BuildingDelinquencyAging.ONE_PERIOD:
        return Prisma.sql`AND filtered_units."overduePeriods" = 1`;
      case BuildingDelinquencyAging.TWO_TO_THREE_PERIODS:
        return Prisma.sql`AND filtered_units."overduePeriods" BETWEEN 2 AND 3`;
      case BuildingDelinquencyAging.MORE_THAN_THREE_PERIODS:
        return Prisma.sql`AND filtered_units."overduePeriods" > 3`;
      case BuildingDelinquencyAging.ALL:
      case undefined:
        return Prisma.empty;
    }
  }

  private getDelinquencyOrderBy(
    sortBy: BuildingDelinquencySortBy | undefined,
    sortOrder: BuildingDelinquencySortOrder | undefined,
  ): Prisma.Sql {
    const direction = sortOrder === BuildingDelinquencySortOrder.ASC ? 'ASC' : 'DESC';
    const column = {
      [BuildingDelinquencySortBy.ACCUMULATED_DEBT]: '"accumulatedDebtSort"',
      [BuildingDelinquencySortBy.PERIOD_DEBT]: '"periodDebtSort"',
      [BuildingDelinquencySortBy.OVERDUE_PERIODS]: '"overduePeriods"',
      [BuildingDelinquencySortBy.UNIT]: '"unitLabel"',
    }[sortBy ?? BuildingDelinquencySortBy.ACCUMULATED_DEBT];

    return Prisma.raw(`${column} ${direction}, "unitLabel" ASC`);
  }

  private mapDelinquencyItem(item: RawDelinquencyRow): BuildingDelinquencyItemDto {
    return {
      unitId: item.unitId,
      unitCode: item.unitCode,
      unitLabel: item.unitLabel,
      responsibleName: item.responsibleName,
      periodDebtByCurrency: item.periodDebtByCurrency.map((bucket) => ({
        currency: bucket.currency,
        amountMinor: this.toSafeFinancialNumber(bucket.amountMinor),
      })),
      accumulatedDebtByCurrency: item.accumulatedDebtByCurrency.map((bucket) => ({
        currency: bucket.currency,
        amountMinor: this.toSafeFinancialNumber(bucket.amountMinor),
      })),
      overduePeriods: this.toSafeFinancialNumber(item.overduePeriods),
    };
  }

  private toSafeFinancialNumber(value: bigint | number | string): number {
    const numericValue = typeof value === 'bigint' ? Number(value) : Number(value);
    if (!Number.isSafeInteger(numericValue)) {
      throw new Error('Financial aggregate exceeds the supported integer range');
    }
    return numericValue;
  }

  /**
   * Get unit ledger (charges + payments + balance)
   *
   * Shows transaction history for a unit
   */
  async getUnitLedger(
    tenantId: string,
    unitId: string,
    periodFrom?: string,
    periodTo?: string,
    userRoles?: string[],
    userId?: string,
    membership?: AuthenticatedMembership,
  ): Promise<UnitLedgerDto> {
    // 1. Validate unit belongs to tenant
    const unit = await this.prisma.unit.findFirst({
      where: {
        id: unitId,
        building: { tenantId },
      },
      include: {
        building: true,
      },
    });

    if (!unit) {
      throw new NotFoundException(
        `Unit not found or does not belong to this tenant`,
      );
    }

    // 2. Enforce exact tenant membership and scoped roles before loading ledger data
    await this.assertUnitLedgerAccess({
      tenantId,
      unitId,
      buildingId: unit.building.id,
      userId,
      userRoles,
      membership,
    });

    // 3. Build charge filters
    // IMPORTANT: debt must be calculated from approved/reconciled allocations,
    // not from Charge.status alone (status can be stale/inconsistent).
    // Therefore, we fetch all active (non-canceled) charges for the unit.
    const chargeWhere: Prisma.ChargeWhereInput = {
      tenantId,
      unitId,
      canceledAt: null,
    };

    if (periodFrom || periodTo) {
      chargeWhere.period = {};
      if (periodFrom) chargeWhere.period.gte = periodFrom;
      if (periodTo) chargeWhere.period.lte = periodTo;
    }

    // 4. Get charges with allocations
    const charges = await this.prisma.charge.findMany({
      where: chargeWhere,
      include: {
        paymentAllocations: {
          include: {
            payment: true,
          },
        },
      },
      orderBy: { dueDate: 'desc' },
    });

    // 5. Get payments for this unit (only approved/reconciled for history)
    const payments = await this.prisma.payment.findMany({
      where: {
        tenantId,
        unitId,
        status: { in: [PaymentStatus.APPROVED, PaymentStatus.RECONCILED] },
        canceledAt: null,
      },
      select: {
        id: true,
        amount: true,
        currency: true,
        method: true,
        status: true,
        createdAt: true,
        functionalAmountMinor: true,
        functionalCurrencyCode: true,
        exchangeRateId: true,
        exchangeRateValue: true,
        exchangeRateDirection: true,
        exchangeRateEffectiveAt: true,
        conversionDate: true,
        paymentAllocations: {
          select: {
            amount: true,
            paymentOriginalAmountMinor: true,
            charge: { select: { currency: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // 6. Calculate balance based on approved/reconciled allocations only
    // and only for charges with real outstanding > 0.
    const chargesWithApprovedAllocated = charges.map((charge) => {
      const approvedAllocated = charge.paymentAllocations.reduce((sum, allocation) => {
        if (this.isEffectivePaymentStatus(allocation.payment?.status)) {
          return sum + allocation.amount;
        }
        return sum;
      }, 0);

      return {
        charge,
        approvedAllocated,
        outstanding: calculateChargeOutstandingMinor(charge),
      };
    });

    const chargesWithOutstanding = chargesWithApprovedAllocated.filter(
      (item) => item.outstanding > 0,
    );

    // Per-currency charge-side aggregates. Each charge contributes to
    // the bucket of its own currency (Charge.currency) — never mixed,
    // never relabelled to a tenant/default currency.
    //
    // balanceByCurrency represents OUTSTANDING_DEBT per currency: it is
    // derived from calculateChargeOutstandingMinor (clamped >= 0), never
    // from charges - allocations, so legacy over-allocation can never
    // produce a negative balance. totalAllocatedByCurrency keeps the
    // informative effective allocation totals.
    const totalsByCurrency = new Map<
      string,
      { charges: number; paid: number; balance: number }
    >();
    for (const item of chargesWithApprovedAllocated) {
      const acc = totalsByCurrency.get(item.charge.currency) ?? {
        charges: 0,
        paid: 0,
        balance: 0,
      };
      acc.charges += item.charge.amount;
      acc.paid += item.approvedAllocated;
      acc.balance += item.outstanding;
      totalsByCurrency.set(item.charge.currency, acc);
    }

    const totalChargesByCurrency = aggregateReportBuckets(
      Array.from(totalsByCurrency.entries(), ([currency, acc]) => ({
        currency,
        amountMinor: acc.charges,
      })),
    );
    const totalPaidByCurrency = aggregateReportBuckets(
      Array.from(totalsByCurrency.entries(), ([currency, acc]) => ({
        currency,
        amountMinor: acc.paid,
      })),
    );
    const balanceByCurrency = aggregateReportBuckets(
      Array.from(totalsByCurrency.entries(), ([currency, acc]) => ({
        currency,
        amountMinor: acc.balance,
      })),
    );

    return {
      unitId,
      unitLabel: unit.label ?? '',
      buildingId: unit.buildingId,
      buildingName: unit.building.name,
      charges: chargesWithApprovedAllocated.map(({ charge, approvedAllocated }) => ({
        id: charge.id,
        period: charge.period,
        concept: charge.concept,
        amount: charge.amount,
        currency: charge.currency,
        type: charge.type,
        status: charge.status,
        dueDate: charge.dueDate,
        allocated: approvedAllocated,
      })),
      payments: payments.map((p) => ({
        id: p.id,
        amount: p.amount,
        currency: p.currency,
        method: p.method,
        status: p.status,
        createdAt: p.createdAt,
        allocated: this.safePaymentSideAllocatedMinor(p),
      })),
      totals: {
        totalChargesByCurrency,
        totalPaidByCurrency,
        totalAllocatedByCurrency: totalPaidByCurrency,
        balanceByCurrency,
      },
    };
  }

  /**
   * Read-compatible payment-side allocated amount for the ledger.
   * Legacy payments whose original/functional snapshot cannot be resolved
   * (missing or inconsistent snapshot fields) must not crash the ledger
   * read path: their informational allocated amount is reported as 0.
   */
  /**
   * Read-compatible payment-side allocated amount for the ledger.
   * Legacy payments whose original/functional snapshot cannot be resolved
   * (PAYMENT_LEGACY_SNAPSHOT_REQUIRED) report null — the historical
   * payment-side value is UNKNOWN, never a fabricated zero.
   */
  private safePaymentSideAllocatedMinor(
    payment: Parameters<typeof aggregatePaymentSideAllocations>[0],
  ): number | null {
    try {
      return aggregatePaymentSideAllocations(payment).originalConsumedMinor;
    } catch {
      return null;
    }
  }

  private async assertUnitLedgerAccess(params: {
    tenantId: string;
    unitId: string;
    buildingId: string;
    userRoles?: string[];
    userId?: string;
    membership?: AuthenticatedMembership;
  }): Promise<void> {
    const membership = this.resolveLedgerMembership(params);

    if (membership.tenantId !== params.tenantId) {
      throw new ForbiddenException(`No tiene acceso al tenant ${params.tenantId}`);
    }

    const tenantRoles = membership.roles ?? [];

    if (tenantRoles.some((role) => this.isTenantLedgerRole(role))) {
      return;
    }

    if (this.hasScopedLedgerAccess(membership.scopedRoles ?? [], params)) {
      return;
    }

    if (tenantRoles.includes('RESIDENT')) {
      if (!params.userId) {
        throw new ForbiddenException('No tiene acceso al ledger de esta unidad');
      }

      await this.validators.validateResidentUnitAccess(
        params.tenantId,
        params.userId,
        params.unitId,
        params.buildingId,
      );
      return;
    }

    throw new ForbiddenException('No tiene acceso al ledger de esta unidad');
  }

  private resolveLedgerMembership(params: {
    tenantId: string;
    userRoles?: string[];
    membership?: AuthenticatedMembership;
  }): AuthenticatedMembership {
    if (params.membership) {
      return params.membership;
    }

    return {
      tenantId: params.tenantId,
      roles: (params.userRoles ?? []).filter(isRole),
      scopedRoles: [],
    };
  }

  private hasScopedLedgerAccess(
    scopedRoles: readonly ScopedRole[],
    params: {
      buildingId: string;
      unitId: string;
    },
  ): boolean {
    return scopedRoles.some((role) => {
      if (!this.isTenantLedgerRole(role.role)) {
        return false;
      }

      if (role.scopeType === ScopeType.BUILDING) {
        return role.scopeBuildingId === params.buildingId;
      }

      if (role.scopeType === ScopeType.UNIT) {
        return role.scopeUnitId === params.unitId;
      }

      return false;
    });
  }

  private isTenantLedgerRole(role: string): boolean {
    return TENANT_LEDGER_ROLES.has(role);
  }

  /**
   * Get allocations for a payment
   */
  async getPaymentAllocations(
    tenantId: string,
    buildingId: string,
    paymentId: string,
    userRoles: string[],
    userId: string,
  ): Promise<(PaymentAllocation & { charge: { id: string; concept: string; amount: number; status: ChargeStatus; period: string } })[]> {
    // 1. Validate payment
    const payment = await this.prisma.payment.findFirst({
      where: {
        id: paymentId,
        tenantId,
        buildingId,
        canceledAt: null, // Exclude soft-deleted payments
      },
    });

    if (!payment) {
      throw new NotFoundException(
        `Payment not found or does not belong to this building/tenant`,
      );
    }

    if (this.validators.isResidentOrOwner(userRoles)) {
      if (!payment.unitId) {
        throw new NotFoundException('Payment not found or does not belong to you');
      }
      await this.validators.validateResidentUnitAccess(
        tenantId,
        userId,
        payment.unitId,
        buildingId,
      );
    }

    // 2. Get allocations
    return this.prisma.paymentAllocation.findMany({
      where: {
        tenantId,
        paymentId,
      },
      include: {
        charge: {
          select: {
            id: true,
            concept: true,
            amount: true,
            status: true,
            period: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Revive a rejected payment (REJECTED → SUBMITTED)
   *
   * Security:
   * - Admin/Operator only
   */
  async revivePayment(
    tenantId: string,
    buildingId: string,
    paymentId: string,
    userRoles: string[],
    membershipId: string,
  ): Promise<PaymentDetailDto> {
    // 1. Permission check
    if (!this.validators.canReviewPayments(userRoles)) {
      this.validators.throwForbidden('payments', 'revive');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const payment = await this.lockSubmittedPaymentForApproval(
        tx,
        tenantId,
        paymentId,
        buildingId,
      );

      if (payment.status !== PaymentStatus.REJECTED) {
        throw new ConflictException('Only REJECTED payments can be revived');
      }

      if (payment.canceledAt) {
        throw new ConflictException('No se puede reactivar un pago cancelado');
      }

      if (this.hasResidentDirectedPaymentMarker(payment.notes)) {
        throw new BadRequestException(
          'No se puede reactivar este pago porque perdió la asociación con el cargo seleccionado. El residente debe reportarlo nuevamente.',
        );
      }

      return tx.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.SUBMITTED,
          reviewedByMembershipId: null,
          updatedAt: new Date(),
        },
      });
    });

    // Audit
    void this.auditService.createLog({
      tenantId,
      actorUserId: membershipId,
      action: AuditAction.PAYMENT_SUBMIT,
      entityType: 'Payment',
      entityId: paymentId,
      metadata: { action: 'REVIVED', previousStatus: 'REJECTED' },
    });

    return this.sanitizePaymentForResponse(result);
  }

  /**
   * Get a single payment with allocations
   *
   * Security:
   * - RESIDENT: can view only their own unit's payments
   * - Admin/Operator: can view any payment
   */
  async getPayment(
    tenantId: string,
    buildingId: string,
    paymentId: string,
    userRoles: string[],
    userId: string,
  ): Promise<PaymentDetailDto> {
    // 1. Find payment
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, tenantId, buildingId },
      include: {
        paymentAllocations: {
          include: {
            charge: {
              select: {
                id: true,
                concept: true,
                amount: true,
                status: true,
                period: true,
              },
            },
          },
        },
        createdByUser: { select: { id: true, name: true, email: true } },
        reviewedByMembership: {
          select: { id: true, user: { select: { name: true } } },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException(
        `Payment not found or does not belong to this building/tenant`,
      );
    }

    // 2. RESIDENT: validate unit ownership
    if (this.validators.isResidentOrOwner(userRoles)) {
      if (!payment.unitId) {
        throw new NotFoundException('Payment not found or does not belong to you');
      }
      await this.validators.validateResidentUnitAccess(
        tenantId,
        userId,
        payment.unitId,
        buildingId,
      );
    }

    return this.sanitizePaymentForResponse(payment);
  }

  /**
   * Cancel a payment (soft delete via canceledAt)
   *
   * Security:
   * - Admin/Operator only
   * - Cannot cancel if has allocations
   */
  async cancelPayment(
    tenantId: string,
    buildingId: string,
    paymentId: string,
    userRoles: string[],
    membershipId: string,
    reason?: string,
  ): Promise<PaymentDetailDto> {
    // 1. Permission check
    if (!this.validators.canReviewPayments(userRoles)) {
      this.validators.throwForbidden('payments', 'cancel');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const payment = await this.lockSubmittedPaymentForApproval(
        tx,
        tenantId,
        paymentId,
        buildingId,
      );

      if (payment.canceledAt) {
        throw new NotFoundException(
          `Payment not found or does not belong to this building/tenant`,
        );
      }

      const allocationCount = await tx.paymentAllocation.count({
        where: { tenantId, paymentId },
      });

      if (payment.status !== PaymentStatus.SUBMITTED && allocationCount > 0) {
        throw new ConflictException(
          `Cannot cancel payment with existing allocations. Remove allocations first.`,
        );
      }

      if (payment.status === PaymentStatus.SUBMITTED) {
        await this.releaseSubmittedPaymentAllocations(tx, paymentId, tenantId, buildingId);
      }
      const canceledPayment = await tx.payment.update({
        where: { id: paymentId },
        data: { canceledAt: new Date(), updatedAt: new Date() },
      });

      await tx.paymentAuditLog.create({
        data: {
          tenantId,
          paymentId,
          action: PaymentAuditAction.CANCELLED,
          membershipId,
          reason: reason || 'No reason provided',
          comment: null,
          metadata: { reason: reason || 'No reason provided' },
        },
      });

      return canceledPayment;
    });

    return this.sanitizePaymentForResponse(result);
  }

  /**
   * Get aggregated financial summary for entire tenant (all buildings)
   *
   * Security:
   * - No additional validation needed (tenant scope is automatic via req.tenantId)
   */
  async getTenantFinancialSummary(
    tenantId: string,
    period?: string | BuildingFinancialSummaryPeriodFilter,
    userRoles: string[] = [],
    userId?: string,
  ): Promise<FinancialSummaryDto> {
    // Build where clause: ALL charges for this tenant (no buildingId filter)
    const chargeWhere: Prisma.ChargeWhereInput = {
      tenantId,
      canceledAt: null,
    };
    if (this.validators.isResidentOrOwner(userRoles)) {
      const unitIds = await this.validators.getUserUnitIds(tenantId, userId!);
      if (unitIds.length === 0) {
        return {
          totalChargesByCurrency: [],
          totalPaidByCurrency: [],
          totalOutstandingByCurrency: [],
          delinquentUnitsCount: 0,
          topDelinquentUnits: [],
        };
      }
      chargeWhere.unitId = { in: unitIds };
    }
    if (typeof period === 'string') {
      chargeWhere.period = period;
    } else if (period?.periods?.length) {
      chargeWhere.period = { in: period.periods };
    } else if (period?.period) {
      chargeWhere.period = period.period;
    }

    return this.computeFinancialSummary(chargeWhere);
  }

  async getBuildingFinancialSummary(
    tenantId: string,
    buildingId: string,
    period?: string | BuildingFinancialSummaryPeriodFilter,
  ): Promise<FinancialSummaryDto> {
    // 1. Validate building
    await this.validators.validateBuildingBelongsToTenant(
      tenantId,
      buildingId,
    );

    // Build filters
    const where: Prisma.ChargeWhereInput = {
      tenantId,
      buildingId,
      canceledAt: null,
    };
    if (typeof period === 'string') {
      where.period = period;
    } else if (period?.periods?.length) {
      where.period = { in: period.periods };
    } else if (period?.period) {
      where.period = period.period;
    }

    return this.computeFinancialSummary(where);
  }

  /**
   * Currency-safe charge-side summary: buckets per currency (canonical
   * first, legacy after) and a deterministic NON-monetary delinquent list
   * (earliest overdue dueDate ASC, then unitId ASC). Delinquency is a
   * current snapshot (dueDate < now) — amounts in different currencies are
   * never compared or summed.
   */
  private async computeFinancialSummary(
    where: Prisma.ChargeWhereInput,
  ): Promise<FinancialSummaryDto> {
    const charges = await this.prisma.charge.findMany({
      where,
      include: {
        unit: {
          select: {
            id: true,
            label: true,
            building: { select: { id: true, name: true } },
          },
        },
        paymentAllocations: {
          include: { payment: { select: { status: true } } },
        },
      },
    });

    const totalsByCurrency = new Map<
      string,
      { charges: number; paid: number; outstanding: number }
    >();
    const delinquentByUnit = new Map<
      string,
      {
        unitId: string;
        unitLabel: string;
        buildingId: string;
        buildingName: string;
        earliestDue: Date;
        entries: Array<{ currency: string; amountMinor: number }>;
      }
    >();
    const now = new Date();

    for (const charge of charges) {
      const outstanding = calculateChargeOutstandingMinor(charge);
      const paid = charge.amount - outstanding;

      const acc = totalsByCurrency.get(charge.currency) ?? {
        charges: 0,
        paid: 0,
        outstanding: 0,
      };
      acc.charges += charge.amount;
      acc.paid += paid;
      acc.outstanding += outstanding;
      totalsByCurrency.set(charge.currency, acc);

      if (charge.dueDate < now && outstanding > 0) {
        const existing = delinquentByUnit.get(charge.unitId);
        if (existing) {
          existing.entries.push({ currency: charge.currency, amountMinor: outstanding });
          if (charge.dueDate < existing.earliestDue) {
            existing.earliestDue = charge.dueDate;
          }
        } else {
          delinquentByUnit.set(charge.unitId, {
            unitId: charge.unitId,
            unitLabel: charge.unit?.label || charge.unitId,
            buildingId: charge.unit?.building?.id || '',
            buildingName: charge.unit?.building?.name || '',
            earliestDue: charge.dueDate,
            entries: [{ currency: charge.currency, amountMinor: outstanding }],
          });
        }
      }
    }

    const bucket = (
      pick: (acc: { charges: number; paid: number; outstanding: number }) => number,
    ) =>
      aggregateReportBuckets(
        Array.from(totalsByCurrency.entries(), ([currency, acc]) => ({
          currency,
          amountMinor: pick(acc),
        })),
      );

    const topDelinquentUnits = Array.from(delinquentByUnit.values())
      .sort((a, b) => {
        const dueDiff = a.earliestDue.getTime() - b.earliestDue.getTime();
        if (dueDiff !== 0) return dueDiff;
        return a.unitId.localeCompare(b.unitId);
      })
      .slice(0, 10)
      .map((item) => ({
        unitId: item.unitId,
        unitLabel: item.unitLabel,
        buildingId: item.buildingId,
        buildingName: item.buildingName,
        outstandingByCurrency: aggregateReportBuckets(item.entries),
      }));

    return {
      totalChargesByCurrency: bucket((a) => a.charges),
      totalPaidByCurrency: bucket((a) => a.paid),
      totalOutstandingByCurrency: bucket((a) => a.outstanding),
      delinquentUnitsCount: delinquentByUnit.size,
      topDelinquentUnits,
    };
  }

  /**
   * List charges across all buildings for a tenant.
   *
   * Security:
   * - RESIDENT/OWNER: only charges from their assigned units
   * - ADMIN/OPERATOR: all tenant charges
   */
  async listTenantCharges(
    tenantId: string,
    userRoles: string[],
    userId: string,
    query: ListTenantChargesQueryDto,
  ) {
    const where: Prisma.ChargeWhereInput = {
      tenantId,
      canceledAt: null,
    };

    if (this.validators.isResidentOrOwner(userRoles)) {
      const userUnitIds = await this.validators.getUserUnitIds(tenantId, userId);
      if (userUnitIds.length === 0) {
        return [];
      }
      where.unitId = { in: userUnitIds };
    }

    if (query.buildingId) {
      where.buildingId = query.buildingId;
    }
    if (query.period) {
      where.period = query.period;
    }
    if (query.status) {
      where.status = query.status;
    }

    const limit = Math.min(query.limit || 50, 500);
    const offset = query.offset || 0;

    return this.prisma.charge.findMany({
      where,
      include: {
        building: { select: { id: true, name: true } },
        unit: { select: { id: true, label: true } },
      },
      orderBy: { dueDate: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  /**
   * Get financial trend for building or tenant over N months
   * Returns array of MonthlyTrendDto with collectionRate calculated
   */
  async getFinanceTrend(
    tenantId: string,
    buildingId?: string | null,
    months: number = 6,
  ): Promise<MonthlyTrendDto[]> {
    // Validate months
    const validMonths = Math.min(Math.max(months, 1), 12);

    // Generate array of periods (current month backwards N months)
    const now = new Date();
    const periods: string[] = [];
    for (let i = validMonths - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      periods.push(`${year}-${month}`);
    }

    // For each period, get summary (currency-safe buckets per period)
    const trend: {
      period: string;
      totalChargesByCurrency: ReportCurrencyAmountBucket[];
      totalPaidByCurrency: ReportCurrencyAmountBucket[];
      totalOutstandingByCurrency: ReportCurrencyAmountBucket[];
      collectionRateByCurrency: Array<{ currency: string; rate: number }>;
    }[] = [];
    for (const period of periods) {
      let summary;
      if (buildingId) {
        summary = await this.getBuildingFinancialSummary(tenantId, buildingId, period);
      } else {
        summary = await this.getTenantFinancialSummary(tenantId, period);
      }

      trend.push({
        period,
        totalChargesByCurrency: summary.totalChargesByCurrency,
        totalPaidByCurrency: summary.totalPaidByCurrency,
        totalOutstandingByCurrency: summary.totalOutstandingByCurrency,
        collectionRateByCurrency: summary.totalChargesByCurrency.map((bucket) => {
          const paid = summary.totalPaidByCurrency.find(
            (b) => b.currency === bucket.currency,
          );
          return {
            currency: bucket.currency,
            rate:
              bucket.amountMinor > 0
                ? Math.round(((paid?.amountMinor ?? 0) / bucket.amountMinor) * 1000) / 10
                : 0,
          };
        }),
      });
    }

    return trend;
  }

  /**
   * Update payment status based on allocation state
   * If all charges for a payment are PAID, mark payment as RECONCILED
   *
   * @param paymentId - ID of payment to reconcile
   * @param tx - Optional Prisma transaction client (for use within transactions)
   */
  private async tryReconcilePayment(
    paymentId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    await reconcilePaymentWhenConsumed(
      (tx ?? this.prisma) as Prisma.TransactionClient,
      paymentId,
    );
  }

  // ============================================================================
  // TENANT-LEVEL PAYMENT REVIEW OPERATIONS
  // ============================================================================

  /**
   * List pending payments across all buildings for a tenant
   * Supports filtering by building, unit, date range, status
   */
  async listPendingPayments(
    tenantId: string,
    userRoles: string[],
    userId: string,
    query: ListPendingPaymentsQueryDto,
  ): Promise<PendingPaymentListItem[]> {
    // Build where clause
    const where: Prisma.PaymentWhereInput = {
      tenantId,
      canceledAt: null,
    };

    // Apply filters
    if (query.status) {
      where.status = query.status;
    } else {
      // Default to SUBMITTED if no status specified
      where.status = PaymentStatus.SUBMITTED;
    }

    if (query.buildingId) {
      where.buildingId = query.buildingId;
    }

    if (query.unitId) {
      where.unitId = query.unitId;
    }

    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) {
        where.createdAt.gte = new Date(query.dateFrom);
      }
      if (query.dateTo) {
        where.createdAt.lte = new Date(query.dateTo);
      }
    }

    // For RESIDENT/OWNER: filter to their units or their submissions
    if (this.validators.isResidentOrOwner(userRoles)) {
      const userUnitIds = await this.validators.getUserUnitIds(tenantId, userId);
      if (userUnitIds.length === 0) {
        return [];
      }
      where.unitId = { in: userUnitIds };
    }

    // Execute query
    const limit = Math.min(query.limit || 50, 100);
    const offset = query.offset || 0;

    const payments = await this.prisma.payment.findMany({
      where,
      orderBy: { createdAt: 'asc' }, // Oldest first for review priority
      take: limit,
      skip: offset,
      include: {
        building: {
          select: { id: true, name: true },
        },
        unit: {
          select: { id: true, label: true },
        },
        createdByUser: {
          select: { id: true, name: true, email: true },
        },
        reviewedByMembership: {
          select: { id: true, user: { select: { name: true } } },
        },
        proofFile: {
          select: { id: true },
        },
      },
    });

    // Map payments to include proofDocumentId (for download endpoint)
    const paymentsWithProofDoc = payments.map((p) => ({
      ...p,
      proofDocumentId: p.proofFile?.id
        ? this.prisma.document.findUnique({
            where: { fileId: p.proofFile.id },
            select: { id: true },
          }).then((d) => d?.id)
        : null,
    }));

    // Resolve all proofDocumentIds
    const resolvedPayments = await Promise.all(
      paymentsWithProofDoc.map(async (p) => ({
        ...p,
        proofDocumentId: await p.proofDocumentId,
      }))
    );

    return resolvedPayments.map((payment) => this.sanitizePaymentForResponse(payment));
  }

  /**
   * Approve a payment at tenant level (any building)
   */
  async approvePaymentTenant(
    tenantId: string,
    paymentId: string,
    userRoles: string[],
    membershipId: string,
    dto: ApprovePaymentDto,
    userId?: string,
  ): Promise<PaymentDetailDto> {
    // Permission check
    if (!this.validators.canReviewPayments(userRoles)) {
      this.validators.throwForbidden('payments', 'approve');
    }

    const actorUserId = await this.resolvePaymentReviewerUserId(
      tenantId,
      membershipId,
      userId,
    );

    // Execute approval only when the submitted payment already carries explicit allocations
    let approvedPaymentResult: Payment | null = null;

    await this.prisma.$transaction(async (tx) => {
      const payment = await this.lockSubmittedPaymentForApproval(tx, tenantId, paymentId);

      if (payment.status !== PaymentStatus.SUBMITTED) {
        throw new BadRequestException(
          `Cannot approve payment in status ${payment.status}. Only SUBMITTED payments can be approved.`,
        );
      }

      if (payment.canceledAt) {
        throw new BadRequestException('Cannot approve a canceled payment');
      }

      if (payment.paymentAllocations.length === 0) {
        throw new ConflictException(
          'El pago no tiene cargos asociados para validar la selección. Reenviá el pago con una selección válida.',
        );
      }

      const lockedSelection = await this.validateResidentPaymentAllocationsForApproval(
        tx,
        tenantId,
        payment.buildingId,
        payment,
      );
      assertPaymentAllocationCurrencyMode(
        payment.currency,
        lockedSelection.map((selection) => ({ charge: selection.charge })),
      );
      const paidAt = dto.paidAt ? new Date(dto.paidAt) : new Date();
      const snapshot = await this.ensurePaymentFunctionalSnapshot(
        tx,
        tenantId,
        payment,
        paidAt,
      );
      const approvedPayment = await this.persistPaymentApproval(
        tx,
        tenantId,
        payment,
        membershipId,
        actorUserId,
        paidAt,
        snapshot,
      );

      approvedPaymentResult = approvedPayment;

      for (const allocation of payment.paymentAllocations) {
        await this.recalculateChargeStatus(allocation.chargeId, tx);
      }

      await this.tryReconcilePayment(payment.id, tx);
      const reconciledPayment = await tx.payment.findUnique({
        where: { id: payment.id },
      });
      if (reconciledPayment) {
        approvedPaymentResult = reconciledPayment;
      }

      return approvedPaymentResult;
    });

    // Send notification to resident about approval (outside transaction, using returned payment)
    if (approvedPaymentResult) {
      void this.sendPaymentReceivedNotification(tenantId, approvedPaymentResult, actorUserId);
      
      // Generate receipt for approved payment (async, non-blocking)
      void this.receiptService.ensureReceiptForPayment(tenantId, paymentId, actorUserId).catch((err) => {
        this.logger.error(`Failed to generate receipt for payment ${paymentId}: ${err.message}`);
      });
    }

    return this.sanitizePaymentForResponse(approvedPaymentResult!);
  }

  /**
   * Reject a payment at tenant level (any building)
   */
  async rejectPaymentTenant(
    tenantId: string,
    paymentId: string,
    userRoles: string[],
    membershipId: string,
    dto: RejectPaymentDto,
  ): Promise<PaymentDetailDto> {
    if (!this.validators.canReviewPayments(userRoles)) {
      this.validators.throwForbidden('payments', 'reject');
    }

    if (!dto.reason || dto.reason.trim().length === 0) {
      throw new BadRequestException('Rejection reason is required');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const payment = await this.lockSubmittedPaymentForApproval(
        tx,
        tenantId,
        paymentId,
      );

      if (payment.status !== PaymentStatus.SUBMITTED) {
        throw new BadRequestException(
          `Cannot reject payment in status ${payment.status}. Only SUBMITTED payments can be rejected.`,
        );
      }

      if (payment.canceledAt) {
        throw new BadRequestException('Cannot reject a canceled payment');
      }

      await this.releaseSubmittedPaymentAllocations(
        tx,
        paymentId,
        tenantId,
        payment.buildingId,
      );
      const rejectedPayment = await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: PaymentStatus.REJECTED,
          reviewedByMembershipId: membershipId,
          rejectionReason: dto.reason,
          rejectionComment: dto.comment || null,
          reviewedAt: new Date(),
          notes: this.mergeResidentResubmissionMarker(payment.notes, dto.notes),
          updatedAt: new Date(),
        },
      });

      await tx.paymentAuditLog.create({
        data: {
          tenantId,
          paymentId,
          action: PaymentAuditAction.REJECTED,
          membershipId,
          reason: dto.reason,
          comment: dto.comment || null,
          metadata: {
            amount: payment.amount,
            currency: payment.currency,
            method: payment.method,
            reference: payment.reference,
          },
        },
      });

      return rejectedPayment;
    });

    const actorUserId = await this.resolveMembershipUserId(tenantId, membershipId);
    void this.sendPaymentRejectedNotification(tenantId, result, dto.reason, actorUserId ?? undefined);

    return this.sanitizePaymentForResponse(result);
  }

  // ============================================================================
  // PAYMENT METRICS
  // ============================================================================

  /**
   * Get operational metrics for payment review
   */
  async getPaymentMetrics(
    tenantId: string,
    query: PaymentMetricsQueryDto,
  ): Promise<PaymentMetricsDto> {
    // Date range for metrics
    const dateFrom = query.dateFrom ? new Date(query.dateFrom) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const dateTo = query.dateTo ? new Date(query.dateTo) : new Date();

    // Build where clause for pending (SUBMITTED)
    const pendingWhere: Prisma.PaymentWhereInput = {
      tenantId,
      status: PaymentStatus.SUBMITTED,
      canceledAt: null,
    };
    if (query.buildingId) {
      pendingWhere.buildingId = query.buildingId;
    }

    // Get pending payments
    const pendingPayments = await this.prisma.payment.findMany({
      where: pendingWhere,
      select: { amount: true, createdAt: true, buildingId: true },
    });

    // Calculate backlog
    const backlogCount = pendingPayments.length;
    const backlogAmount = pendingPayments.reduce((sum, p) => sum + p.amount, 0);

    // Calculate aging
    const now = new Date();
    const ages = pendingPayments.map(p => {
      const created = new Date(p.createdAt);
      return Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
    });
    ages.sort((a, b) => a - b);
    const agingMedianDays = ages.length > 0 ? ages[Math.floor(ages.length / 2)] : 0;
    const agingP95Days = ages.length > 0 ? ages[Math.floor(ages.length * 0.95)] : 0;

    // Get reviewed payments (APPROVED + REJECTED) in date range
    const reviewedWhere: Prisma.PaymentWhereInput = {
      tenantId,
      status: { in: [PaymentStatus.APPROVED, PaymentStatus.REJECTED] },
      updatedAt: { gte: dateFrom, lte: dateTo },
      canceledAt: null,
    };
    if (query.buildingId) {
      reviewedWhere.buildingId = query.buildingId;
    }

    const reviewedPayments = await this.prisma.payment.findMany({
      where: reviewedWhere,
      select: { status: true, reference: true },
    });

    const totalReviewed = reviewedPayments.length;
    const approvedCount = reviewedPayments.filter(p => p.status === PaymentStatus.APPROVED).length;
    const rejectedCount = reviewedPayments.filter(p => p.status === PaymentStatus.REJECTED).length;

    const approvalRate = totalReviewed > 0 ? (approvedCount / totalReviewed) * 100 : 0;
    const rejectionRate = totalReviewed > 0 ? (rejectedCount / totalReviewed) * 100 : 0;

    // Rejection reasons (from reference field)
    const reasonCounts = new Map<string, number>();
    reviewedPayments
      .filter(p => p.status === PaymentStatus.REJECTED && p.reference)
      .forEach(p => {
        const reason = p.reference || 'OTRO';
        reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
      });
    const rejectionReasons = Array.from(reasonCounts.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count);

    // By building
    const buildings = await this.prisma.building.findMany({
      where: { tenantId, ...(query.buildingId ? { id: query.buildingId } : {}) },
      select: { id: true, name: true },
    });

    const buildingIds = buildings.map(b => b.id);
    const paymentsByBuilding = await this.prisma.payment.groupBy({
      by: ['buildingId', 'status'],
      where: {
        tenantId,
        buildingId: { in: buildingIds },
        canceledAt: null,
      },
      _count: true,
      _sum: { amount: true },
    });

    const byBuilding = buildings.map(b => {
      const pending = paymentsByBuilding.find(pb => pb.buildingId === b.id && pb.status === PaymentStatus.SUBMITTED);
      const approved = paymentsByBuilding.find(pb => pb.buildingId === b.id && pb.status === PaymentStatus.APPROVED);
      const rejected = paymentsByBuilding.find(pb => pb.buildingId === b.id && pb.status === PaymentStatus.REJECTED);
      return {
        buildingId: b.id,
        buildingName: b.name,
        pending: pending?._count || 0,
        pendingAmount: pending?._sum?.amount || 0,
        approved: approved?._count || 0,
        rejected: rejected?._count || 0,
      };
    });

    return {
      backlogCount,
      backlogAmount,
      agingMedianDays: agingMedianDays || 0,
      agingP95Days: agingP95Days || 0,
      totalReviewed,
      approvalRate,
      rejectionRate,
      rejectionReasons,
      byBuilding,
    };
  }

  // ============================================================================
  // PAYMENT AUDIT LOG
  // ============================================================================

  /**
   * Get audit history for a specific payment
   */
  async getPaymentAuditLog(
    tenantId: string,
    paymentId: string,
    query: { limit?: number },
  ): Promise<PaymentAuditLogDto[]> {
    // Validate payment belongs to tenant
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, tenantId },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    const logs = await this.prisma.paymentAuditLog.findMany({
      where: { paymentId },
      orderBy: { createdAt: 'desc' },
      take: query.limit || 20,
      include: {
        membership: {
          select: { id: true, user: { select: { name: true, email: true } } },
        },
      },
    });

    return logs.map(log => ({
      id: log.id,
      tenantId: log.tenantId,
      paymentId: log.paymentId,
      action: log.action,
      membershipId: log.membershipId || undefined,
      reason: log.reason || undefined,
      comment: log.comment || undefined,
      metadata: log.metadata as Record<string, unknown> | undefined,
      createdAt: log.createdAt,
      userName: log.membership?.user.name || undefined,
      userEmail: log.membership?.user.email || undefined,
    }));
  }

  /**
   * Check for potential duplicates (for admin review)
   */
  async checkPaymentDuplicate(
    tenantId: string,
    paymentId: string,
  ): Promise<PaymentDuplicateCheckResultDto> {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, tenantId },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    // Look for similar payments in last 48 hours
    const duplicateWindow = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const duplicate = await this.prisma.payment.findFirst({
      where: {
        tenantId,
        id: { not: paymentId }, // Exclude self
        unitId: payment.unitId ?? undefined,
        amount: payment.amount,
        reference: payment.reference,
        createdAt: { gte: duplicateWindow },
        status: { in: [PaymentStatus.SUBMITTED, PaymentStatus.APPROVED] },
      },
    });

    return {
      hasDuplicate: !!duplicate,
      duplicatePaymentId: duplicate?.id,
      duplicateAmount: duplicate?.amount,
      duplicateReference: duplicate?.reference || undefined,
      duplicateCreatedAt: duplicate?.createdAt,
    };
  }

  /**
   * [PHASE 2 QUICK #3] Send PAYMENT_RECEIVED notification
   * Fire-and-forget: logs errors but never throws
   */
  private async sendPaymentReceivedNotification(
    tenantId: string,
    payment: Payment,
    excludeUserId?: string,
  ): Promise<void> {
    try {
      // Load unit occupants if this payment is unit-scoped
      if (!payment.unitId) return;

      const unit = await this.prisma.unit.findUnique({
        where: { id: payment.unitId },
        include: {
          unitOccupants: {
            where: { endDate: null }, // Active only
            include: {
              member: { select: { id: true, user: { select: { id: true } } } },
            },
          },
        },
      });

      if (!unit) return;

      const recipientIds = new Set(
        unit.unitOccupants
          .map((occupant) => occupant.member?.user?.id)
          .filter((userId): userId is string => !!userId && userId !== excludeUserId),
      );

      // Send to all active residents
      for (const userId of recipientIds) {
        const amount = (payment.amount / 100).toFixed(2);
        await this.notificationsService.createNotification({
          tenantId,
          userId,
          type: 'PAYMENT_RECEIVED',
          title: 'Pago aprobado',
          body: `Tu pago de ${amount} ${payment.currency} ha sido aprobado y procesado correctamente.`,
          data: {
            paymentId: payment.id,
            paymentAmount: payment.amount / 100,
            paymentCurrency: payment.currency,
            reference: payment.reference || 'N/A',
            paidAt: payment.paidAt?.toISOString(),
          },
          deliveryMethods: ['IN_APP', 'EMAIL'],
        });
      }
    } catch (error) {
      // Fire-and-forget: log but never fail
      this.logger.error(
        `[FinanzasService] Failed to send payment received notification for payment ${payment.id}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /**
   * [PHASE 2 QUICK #4] Send PAYMENT_REJECTED notification
   * Fire-and-forget: logs errors but never throws
   */
  private async sendPaymentRejectedNotification(
    tenantId: string,
    payment: Payment,
    reason?: string,
    excludeUserId?: string,
  ): Promise<void> {
    try {
      // Load unit occupants if this payment is unit-scoped
      if (!payment.unitId) return;

      const unit = await this.prisma.unit.findUnique({
        where: { id: payment.unitId },
        include: {
          unitOccupants: {
            where: { endDate: null }, // Active only
            include: {
              member: { select: { id: true, user: { select: { id: true } } } },
            },
          },
        },
      });

      if (!unit) return;

      const recipientIds = new Set(
        unit.unitOccupants
          .map((occupant) => occupant.member?.user?.id)
          .filter((userId): userId is string => !!userId && userId !== excludeUserId),
      );

      // Send to all active residents
      for (const userId of recipientIds) {
        const amount = (payment.amount / 100).toFixed(2);
        await this.notificationsService.createNotification({
          tenantId,
          userId,
          type: 'PAYMENT_REJECTED',
          title: 'Pago rechazado',
          body: `Tu pago de ${amount} ${payment.currency} ha sido rechazado. Motivo: ${reason || 'No especificado'}. Por favor intenta nuevamente.`,
          data: {
            paymentId: payment.id,
            paymentAmount: payment.amount / 100,
            paymentCurrency: payment.currency,
            rejectionReason: reason || 'No especificado',
          },
          deliveryMethods: ['IN_APP', 'EMAIL'],
        });
      }
    } catch (error) {
      // Fire-and-forget: log but never fail
      this.logger.error(
        `[FinanzasService] Failed to send payment rejected notification for payment ${payment.id}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /**
   * Notify admins when a new payment is submitted by a resident
   * Fire-and-forget: logs errors but never throws
   */
  private async notifyAdminsOfPaymentSubmitted(
    tenantId: string,
    payment: Payment,
    actorUserId?: string,
  ): Promise<void> {
    try {
      const adminIds = await this.resolveAdministrativeRecipientIds(
        tenantId,
        payment.buildingId,
        payment.unitId,
        actorUserId ? [actorUserId] : [],
      );

      if (adminIds.length === 0) {
        this.logger.debug(`[FinanzasService] No admins found for tenant ${tenantId}, skipping notification`);
        return;
      }

      // Get the resident who submitted the payment
      const submittedByUser = await this.prisma.user.findUnique({
        where: { id: payment.createdByUserId },
        select: { name: true, email: true },
      });

      const unitLabel = payment.unitId 
        ? (await this.prisma.unit.findUnique({ where: { id: payment.unitId }, select: { label: true } }))?.label 
        : null;
      const buildingName = payment.buildingId 
        ? (await this.prisma.building.findUnique({ where: { id: payment.buildingId }, select: { name: true } }))?.name 
        : null;
      const amount = (payment.amount / 100).toFixed(2);

      this.logger.debug(`[FinanzasService] Notifying ${adminIds.length} admins about payment ${payment.id}`);

      for (const adminId of adminIds) {
        await this.notificationsService.createNotification({
          tenantId,
          userId: adminId,
          type: 'BUILDING_ALERT',
          title: '💰 Nuevo pago pendiente de revisión',
          body: `El residente ${submittedByUser?.name || submittedByUser?.email || 'unknown'} envió un pago de ${amount} ${payment.currency} para la unidad ${unitLabel || payment.unitId || 'N/A'}${buildingName ? ` en ${buildingName}` : ''}. Método: ${payment.method}. ${payment.proofFileId ? '✅ Tiene comprobante.' : '⚠️ Sin comprobante.'}`,
          data: {
            event: 'PAYMENT_SUBMITTED',
            paymentId: payment.id,
            paymentAmount: payment.amount / 100,
            paymentCurrency: payment.currency,
            paymentMethod: payment.method,
            unitLabel: unitLabel || payment.unitId,
            buildingName: buildingName,
            hasProof: !!payment.proofFileId,
            submittedBy: submittedByUser?.name || submittedByUser?.email,
          },
          deliveryMethods: ['IN_APP', 'EMAIL'],
        });
      }
    } catch (error) {
      // Fire-and-forget: log but never fail
      this.logger.error(
        `[FinanzasService] Failed to notify admins of payment submitted ${payment.id}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private async resolveAdministrativeRecipientIds(
    tenantId: string,
    buildingId?: string | null,
    unitId?: string | null,
    excludedUserIds: readonly string[] = [],
  ): Promise<string[]> {
    const adminMemberships = await this.prisma.membership.findMany({
      where: {
        tenantId,
        roles: {
          some: {
            role: { in: ['TENANT_ADMIN', 'TENANT_OWNER', 'OPERATOR'] },
            OR: [
              { scopeType: ScopeType.TENANT },
              ...(buildingId ? [{ scopeType: ScopeType.BUILDING, scopeBuildingId: buildingId }] : []),
              ...(unitId ? [{ scopeType: ScopeType.UNIT, scopeUnitId: unitId }] : []),
            ],
          },
        },
      },
      include: {
        user: { select: { id: true } },
      },
    });

    const excluded = new Set(excludedUserIds.filter((id): id is string => !!id));
    const recipientIds = new Set<string>();
    for (const userId of [
      ...adminMemberships.map((admin) => admin.user?.id),
    ]) {
      if (userId && !excluded.has(userId)) {
        recipientIds.add(userId);
      }
    }

    return [...recipientIds];
  }

  private async resolveMembershipUserId(
    tenantId: string,
    membershipId: string,
  ): Promise<string | null> {
    const membership = await this.prisma.membership.findFirst({
      where: { id: membershipId, tenantId },
      select: { userId: true },
    });

    return membership?.userId ?? null;
  }

  private async persistPaymentApproval(
    tx: Prisma.TransactionClient,
    tenantId: string,
    payment: PaymentWithAllocations,
    membershipId: string,
    actorUserId: string,
    paidAt: Date,
    snapshot: Record<string, unknown>,
  ): Promise<Payment> {
    const approvedAt = new Date();
    const approvedPayment = await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.APPROVED,
        paidAt,
        reviewedByMembershipId: membershipId,
        reviewedAt: approvedAt,
        approvedAt,
        approvedByUserId: actorUserId,
        updatedAt: new Date(),
        ...snapshot,
      },
    });

    await tx.paymentAuditLog.create({
      data: {
        tenantId,
        paymentId: payment.id,
        action: PaymentAuditAction.APPROVED,
        membershipId,
        reason: null,
        comment: null,
        metadata: {
          amount: payment.amount,
          currency: payment.currency,
          method: payment.method,
          reference: payment.reference,
          paidAt: paidAt.toISOString(),
          approvedByUserId: actorUserId,
        },
      },
    });

    return approvedPayment;
  }

  private async resolvePaymentReviewerUserId(
    tenantId: string,
    membershipId: string,
    requestedUserId?: string,
  ): Promise<string> {
    const membershipUserId = await this.resolveMembershipUserId(tenantId, membershipId);
    if (!membershipUserId) {
      throw new ConflictException('Reviewer membership is not valid for this tenant');
    }
    if (requestedUserId && requestedUserId !== membershipUserId) {
      throw new ForbiddenException('Reviewer membership does not belong to the authenticated user');
    }

    return membershipUserId;
  }

  /**
   * [PHASE 3 MEDIUM #9] Auto-create monthly expense periods
   * Runs on 1st of each month at 8am - creates next month's period for buildings
   */
  async autoCreateMonthlyExpensePeriods(): Promise<{ created: number }> {
    const now = new Date();
    const nextMonthDate = new Date(now.getFullYear(), now.getMonth() + 1);
    const year = nextMonthDate.getFullYear();
    const month = nextMonthDate.getMonth() + 1;

    // Find all buildings with expensePeriods
    const buildings = await this.prisma.building.findMany({
      include: {
        expensePeriods: {
          where: { year, month },
          take: 1,
        },
      },
    });

    let createdCount = 0;

    for (const building of buildings) {
      // Skip if period already exists for next month
      if (building.expensePeriods.length > 0) {
        continue;
      }

      // Get last period's total as baseline
      const lastPeriod = await this.prisma.expensePeriod.findFirst({
        where: { buildingId: building.id },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
      });

      const defaultTotalBigInt = lastPeriod?.totalToAllocate || 0n;
      const defaultTotal = typeof defaultTotalBigInt === 'bigint' ? Number(defaultTotalBigInt) : defaultTotalBigInt;

      // Create new period (due 15th of next month)
      const dueDate = new Date(year, month - 1, 15);

      const period = await this.prisma.expensePeriod.create({
        data: {
          tenantId: building.tenantId,
          buildingId: building.id,
          year,
          month,
          totalToAllocate: defaultTotal,
          dueDate,
          status: 'DRAFT',
          concept: `Expensas Comunes - ${String(month).padStart(2, '0')}/${year}`,
          currency: 'ARS',
        },
      });

      // Notify tenants (no specific admin contact in Building model, skip for now)
      // TODO: Could query Memberships with TENANT_ADMIN role if needed

      createdCount++;
    }

    return { created: createdCount };
  }

  /**
   * [PHASE 3 MEDIUM #10] Send payment reminders for charges due in 3 days
   * Runs daily at 10am - notifies residents of upcoming due dates
   */
  async sendPaymentReminders(): Promise<{ count: number }> {
    const now = new Date();
    const inThreeDays = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const startOfDay = new Date(inThreeDays.getFullYear(), inThreeDays.getMonth(), inThreeDays.getDate());
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

    const tenantIds = await this.prisma.tenant.findMany({ select: { id: true } });
    let reminderCount = 0;

    for (const tenant of tenantIds) {
      reminderCount += await this.sendPaymentRemindersForTenant(
        tenant.id,
        now,
        startOfDay,
        endOfDay,
      );
    }

    return { count: reminderCount };
  }

  private async sendPaymentRemindersForTenant(
    tenantId: string,
    now: Date,
    startOfDay: Date,
    endOfDay: Date,
  ): Promise<number> {
    const remindableCharges = await this.prisma.charge.findMany({
      where: {
        tenantId,
        status: { in: ['PENDING', 'PARTIAL'] },
        dueDate: {
          gte: startOfDay,
          lt: endOfDay,
        },
        reminderSentAt: null, // Only once per charge
        canceledAt: null,
      },
      include: {
        unit: {
          include: {
            unitOccupants: {
              where: { endDate: null },
              include: { member: { select: { user: { select: { id: true } } } } },
            },
            building: { select: { name: true } },
          },
        },
      },
    });

    let reminderCount = 0;

    for (const charge of remindableCharges) {
      // Mark reminder as sent
      await this.prisma.charge.update({
        where: { id: charge.id },
        data: { reminderSentAt: now },
      });

      // Notify residents
      const dueStr = charge.dueDate.toLocaleDateString('es-AR');
      const amount = (charge.amount / 100).toFixed(2);
      for (const occupant of charge.unit.unitOccupants) {
        if (occupant.member?.user?.id) {
          await this.notificationsService.createNotification({
            tenantId: charge.tenantId,
            userId: occupant.member.user.id,
            type: 'PAYMENT_REMINDER',
            title: 'Recordatorio: Pago vence en 3 días',
            body: `Recordatorio: Tu pago de ${amount} ${charge.currency} para ${charge.unit.label} vence el ${dueStr}. Realiza el pago ahora para evitar demoras.`,
            data: {
              chargeAmount: charge.amount / 100,
              chargeCurrency: charge.currency,
              unitLabel: charge.unit.label,
              dueDate: charge.dueDate.toISOString(),
            },
            deliveryMethods: ['IN_APP', 'EMAIL'],
          });
          reminderCount++;
        }
      }
    }

    return reminderCount;
  }

  /**
   * [PHASE 3 MEDIUM #11] Bulk validate all DRAFT expenses for a building
   * Allows admins to validate multiple expenses in a single API call
   * Useful when importing batches of expenses or after review period
   */
  async bulkValidateExpenses(
    tenantId: string,
    buildingId: string,
    periodId?: string,
    membershipId?: string,
  ): Promise<{ validatedCount: number; errorCount: number }> {
    // Build query for DRAFT expenses
    const where: Prisma.ExpenseWhereInput = {
      tenantId,
      buildingId,
      status: 'DRAFT',
      ...(periodId
        ? {
            OR: [
              { liquidationPeriod: periodId },
              { liquidationPeriod: null, period: periodId },
            ],
          }
        : {}),
    };

    const draftExpenses = await this.prisma.expense.findMany({
      where,
      select: { id: true },
    });

    let validatedCount = 0;
    let errorCount = 0;

    for (const expense of draftExpenses) {
      try {
        await this.expensesService.validateExpenseFromBulk(
          tenantId,
          expense.id,
          membershipId,
        );
        validatedCount++;
      } catch (error) {
        errorCount++;
        this.logger.error(
          'Failed to validate expense during bulk operation',
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    // Audit the bulk operation (fire-and-forget)
    void this.auditService.createLog({
      tenantId,
      actorMembershipId: membershipId,
      action: AuditAction.EXPENSE_VALIDATE,
      entityType: 'EXPENSE',
      entityId: buildingId,
      metadata: {
        validatedCount,
        errorCount,
        period: periodId || 'ALL',
        bulkOperation: true,
      },
    });

    return { validatedCount, errorCount };
  }

  /**
   * Retry generating receipt for an approved payment (if previous attempt failed)
   */
  async retryReceiptGeneration(
    tenantId: string,
    paymentId: string,
    userRoles: string[],
    excludeUserId?: string,
  ): Promise<{ success: boolean; receiptNumber?: string; error?: string }> {
    if (!this.validators.canReviewPayments(userRoles)) {
      this.validators.throwForbidden('payments', 'retry receipt');
    }

    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, tenantId },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    if (payment.status !== PaymentStatus.APPROVED) {
      throw new BadRequestException('Can only retry receipt generation for approved payments');
    }

    // Only retry if failed or no receipt exists
    if (payment.receiptStatus !== ReceiptStatus.FAILED && payment.receiptNumber) {
      return {
        success: true,
        receiptNumber: payment.receiptNumber,
      };
    }

    // Reset to PENDING before retry
    await this.prisma.payment.update({
      where: { id: paymentId },
      data: {
        receiptStatus: ReceiptStatus.PENDING,
        receiptError: null,
      },
    });

    // Try to generate receipt
    const result = await this.receiptService.ensureReceiptForPayment(tenantId, paymentId, excludeUserId);

    if (result) {
      return {
        success: true,
        receiptNumber: result.receiptNumber,
      };
    }

    // Check for error
    const updatedPayment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      select: { receiptError: true },
    });

    return {
      success: false,
      error: updatedPayment?.receiptError || 'Unknown error during receipt generation',
    };
  }
}
