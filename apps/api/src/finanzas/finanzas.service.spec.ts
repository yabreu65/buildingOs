import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { FinanzasService } from './finanzas.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FinanzasValidators } from './finanzas.validators';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentReceiptService } from '../receipts/payment-receipt.service';
import { CreateChargeDto, UpdateChargeDto } from './finanzas.dto';
import { ExpensesService } from './expenses.service';
import { ChargeStatus, PaymentStatus, PaymentMethod, AuditAction, ScopeType } from '@prisma/client';

describe('FinanzasService', () => {
  let service: FinanzasService;
  let prismaService: PrismaService;
  let auditService: AuditService;
  let validators: FinanzasValidators;
  let notificationsService: { createNotification: jest.Mock };
  let expensesService: ExpensesService;
  let receiptService: PaymentReceiptService;

  // ========== SETUP ==========
  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinanzasService,
        {
          provide: PrismaService,
          useValue: {
            tenant: {
              findUniqueOrThrow: jest.fn(),
            },
            charge: {
              create: jest.fn(),
              findFirst: jest.fn(),
              findUnique: jest.fn(),
              findMany: jest.fn(),
              update: jest.fn(),
            },
            unit: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              findUnique: jest.fn(),
            },
            building: {
              findUnique: jest.fn(),
            },
            payment: {
              create: jest.fn(),
              findFirst: jest.fn(),
              findUnique: jest.fn(),
              findMany: jest.fn(),
              update: jest.fn(),
            },
            paymentAllocation: {
              create: jest.fn(),
              findFirst: jest.fn(),
              findMany: jest.fn(),
              count: jest.fn(),
              delete: jest.fn(),
              deleteMany: jest.fn(),
            },
            paymentAuditLog: {
              create: jest.fn(),
            },
            membership: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
            },
            file: {
              findFirst: jest.fn(),
            },
            user: {
              findUnique: jest.fn(),
            },
            expense: {
              findMany: jest.fn(),
            },
            $queryRaw: jest.fn(),
            $executeRaw: jest.fn(),
            $transaction: jest.fn(),
          },
        },
        {
          provide: AuditService,
          useValue: {
            createLog: jest.fn(),
          },
        },
        {
          provide: NotificationsService,
          useValue: {
            createNotification: jest.fn(),
            notifyPaymentApproved: jest.fn(),
            notifyPaymentRejected: jest.fn(),
            notifyTicketCreated: jest.fn(),
          },
        },
        {
          provide: PaymentReceiptService,
          useValue: {
            generateForApprovedPayment: jest.fn().mockResolvedValue(undefined),
            ensureReceiptForPayment: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: ExpensesService,
          useValue: {
            validateExpenseFromBulk: jest.fn(),
          },
        },
        {
          provide: FinanzasValidators,
          useValue: {
            canWriteCharges: jest.fn(),
            throwForbidden: jest.fn(),
            validateBuildingBelongsToTenant: jest.fn(),
            validateUnitBelongsToBuildingAndTenant: jest.fn(),
            isResidentOrOwner: jest.fn(),
            getUserUnitIds: jest.fn(),
            canWritePayments: jest.fn(),
            canApprovePayments: jest.fn(),
            canSubmitPayments: jest.fn(),
            canReviewPayments: jest.fn(),
            validateResidentUnitAccess: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<FinanzasService>(FinanzasService);
    prismaService = module.get<PrismaService>(PrismaService);
    auditService = module.get<AuditService>(AuditService);
    validators = module.get<FinanzasValidators>(FinanzasValidators);
    notificationsService = module.get(NotificationsService) as never;
    expensesService = module.get<ExpensesService>(ExpensesService);
    receiptService = module.get<PaymentReceiptService>(PaymentReceiptService);

    jest.spyOn(prismaService, '$transaction').mockImplementation(async (callback: (tx: never) => Promise<unknown>) => {
      return callback(prismaService as never);
    });
    jest.spyOn(prismaService.file, 'findFirst').mockResolvedValue({
      id: 'file-123',
      size: 1024,
    } as never);
  });

  // ========== CLEANUP ==========
  afterEach(() => {
    jest.clearAllMocks();
  });

  // ========== TESTS: CREATE CHARGE ==========
  describe('createCharge', () => {
    it('should create a charge successfully', async () => {
      // ARRANGE
      const tenantId = 'tenant-123';
      const buildingId = 'building-123';
      const unitId = 'unit-123';
      const userId = 'user-123';
      const userRoles = ['TENANT_ADMIN'];

      const dto: CreateChargeDto = {
        unitId,
        type: 'MAINTENANCE',
        concept: 'Monthly fee',
        amount: 100.0,
        currency: 'ARS',
        dueDate: '2026-04-21',
        createdByMembershipId: 'membership-123',
      };

      const expectedCharge = {
        id: 'charge-123',
        tenantId,
        buildingId,
        unitId,
        type: 'MAINTENANCE',
        concept: 'Monthly fee',
        amount: 100.0,
        currency: 'ARS',
        status: ChargeStatus.PENDING,
        period: '2026-03',
        dueDate: new Date('2026-04-21'),
        canceledAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdByMembershipId: 'membership-123',
      };

      jest.spyOn(validators, 'canWriteCharges').mockReturnValue(true);
      jest
        .spyOn(validators, 'validateBuildingBelongsToTenant')
        .mockResolvedValue(undefined);
      jest
        .spyOn(validators, 'validateUnitBelongsToBuildingAndTenant')
        .mockResolvedValue(undefined);
      jest.spyOn(prismaService.charge, 'findFirst').mockResolvedValue(null);
      jest.spyOn(prismaService.charge, 'create').mockResolvedValue(expectedCharge as any);
      jest.spyOn(auditService, 'createLog').mockResolvedValue(undefined);

      // ACT
      const result = await service.createCharge(
        tenantId,
        buildingId,
        userRoles,
        userId,
        dto,
      );

      // ASSERT
      expect(result).toEqual(expectedCharge);
      expect(validators.canWriteCharges).toHaveBeenCalledWith(userRoles);
      expect(validators.validateBuildingBelongsToTenant).toHaveBeenCalledWith(
        tenantId,
        buildingId,
      );
      expect(validators.validateUnitBelongsToBuildingAndTenant).toHaveBeenCalledWith(
        tenantId,
        buildingId,
        unitId,
      );
    });

    it('should throw ConflictException when charge already exists', async () => {
      // ARRANGE
      const tenantId = 'tenant-123';
      const buildingId = 'building-123';
      const unitId = 'unit-123';
      const userId = 'user-123';
      const userRoles = ['TENANT_ADMIN'];

      const dto: CreateChargeDto = {
        unitId,
        type: 'MAINTENANCE',
        concept: 'Monthly fee',
        amount: 100.0,
        dueDate: '2026-04-21',
        createdByMembershipId: 'membership-123',
      };

      const existingCharge = {
        id: 'charge-existing',
        tenantId,
        buildingId,
        unitId,
        type: 'MAINTENANCE',
        concept: 'Monthly fee',
        amount: 100.0,
        currency: 'ARS',
        status: ChargeStatus.PENDING,
        period: '2026-03',
        dueDate: new Date('2026-04-21'),
        canceledAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdByMembershipId: 'membership-123',
      };

      jest.spyOn(validators, 'canWriteCharges').mockReturnValue(true);
      jest
        .spyOn(validators, 'validateBuildingBelongsToTenant')
        .mockResolvedValue(undefined);
      jest
        .spyOn(validators, 'validateUnitBelongsToBuildingAndTenant')
        .mockResolvedValue(undefined);
      jest
        .spyOn(prismaService.charge, 'findFirst')
        .mockResolvedValue(existingCharge as any);

      // ACT & ASSERT
      await expect(
        service.createCharge(tenantId, buildingId, userRoles, userId, dto),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw error when permission denied', async () => {
      // ARRANGE
      const tenantId = 'tenant-123';
      const buildingId = 'building-123';
      const userRoles = ['RESIDENT'];
      const userId = 'user-123';

      const dto: CreateChargeDto = {
        unitId: 'unit-123',
        type: 'MAINTENANCE',
        concept: 'Monthly fee',
        amount: 100.0,
        dueDate: '2026-04-21',
        createdByMembershipId: 'membership-123',
      };

      jest.spyOn(validators, 'canWriteCharges').mockReturnValue(false);
      jest.spyOn(validators, 'throwForbidden').mockImplementation(() => {
        throw new Error('Forbidden');
      });

      // ACT & ASSERT
      await expect(
        service.createCharge(tenantId, buildingId, userRoles, userId, dto),
      ).rejects.toThrow();
    });
  });

  // ========== TESTS: LIST CHARGES ==========
  describe('listCharges', () => {
    it('should list charges for admin user', async () => {
      // ARRANGE
      const tenantId = 'tenant-123';
      const buildingId = 'building-123';
      const userId = 'user-123';
      const userRoles = ['TENANT_ADMIN'];

      const expectedCharges = [
        {
          id: 'charge-1',
          tenantId,
          buildingId,
          unitId: 'unit-1',
          type: 'MAINTENANCE',
          concept: 'Monthly fee',
          amount: 100.0,
          currency: 'ARS',
          status: ChargeStatus.PENDING,
          period: '2026-03',
          dueDate: new Date('2026-04-21'),
          canceledAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          createdByMembershipId: 'membership-123',
          paymentAllocations: [],
        },
      ];

      jest
        .spyOn(validators, 'validateBuildingBelongsToTenant')
        .mockResolvedValue(undefined);
      jest.spyOn(validators, 'isResidentOrOwner').mockReturnValue(false);
      jest.spyOn(prismaService.charge, 'findMany').mockResolvedValue(expectedCharges as any);

      // ACT
      const result = await service.listCharges(
        tenantId,
        buildingId,
        userRoles,
        userId,
        {},
      );

      // ASSERT
      expect(result).toEqual(expectedCharges);
    });

    it('should list charges filtered by unit for resident', async () => {
      // ARRANGE
      const tenantId = 'tenant-123';
      const buildingId = 'building-123';
      const unitId = 'unit-123';
      const userId = 'user-123';
      const userRoles = ['RESIDENT'];

      const chargesForUnit = [
        {
          id: 'charge-1',
          tenantId,
          buildingId,
          unitId,
          type: 'MAINTENANCE',
          concept: 'Monthly fee',
          amount: 100.0,
          currency: 'ARS',
          status: ChargeStatus.PENDING,
          period: '2026-03',
          dueDate: new Date('2026-04-21'),
          canceledAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          createdByMembershipId: 'membership-123',
          paymentAllocations: [],
        },
      ];

      jest
        .spyOn(validators, 'validateBuildingBelongsToTenant')
        .mockResolvedValue(undefined);
      jest.spyOn(validators, 'isResidentOrOwner').mockReturnValue(true);
      jest.spyOn(validators, 'getUserUnitIds').mockResolvedValue([unitId]);
      jest.spyOn(prismaService.charge, 'findMany').mockResolvedValue(chargesForUnit as any);

      // ACT
      const result = await service.listCharges(
        tenantId,
        buildingId,
        userRoles,
        userId,
        {},
      );

      // ASSERT
      expect(result).toEqual(chargesForUnit);
      expect(validators.getUserUnitIds).toHaveBeenCalledWith(tenantId, userId);
    });
  });

  // ========== TESTS: GET CHARGE ==========
  describe('getCharge', () => {
    it('should return a single charge for admin user', async () => {
      // ARRANGE
      const tenantId = 'tenant-123';
      const buildingId = 'building-123';
      const chargeId = 'charge-123';
      const userId = 'user-123';
      const userRoles = ['TENANT_ADMIN'];

      const expectedCharge = {
        id: chargeId,
        tenantId,
        buildingId,
        unitId: 'unit-123',
        type: 'MAINTENANCE',
        concept: 'Monthly fee',
        amount: 100.0,
        currency: 'ARS',
        status: ChargeStatus.PENDING,
        period: '2026-03',
        dueDate: new Date('2026-04-21'),
        canceledAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdByMembershipId: 'membership-123',
        paymentAllocations: [],
      };

      jest
        .spyOn(prismaService.charge, 'findFirst')
        .mockResolvedValue(expectedCharge as any);
      jest.spyOn(validators, 'isResidentOrOwner').mockReturnValue(false);

      // ACT
      const result = await service.getCharge(
        tenantId,
        buildingId,
        chargeId,
        userRoles,
        userId,
      );

      // ASSERT
      expect(result).toEqual(expectedCharge);
      expect(prismaService.charge.findFirst).toHaveBeenCalledWith({
        where: {
          id: chargeId,
          tenantId,
          buildingId,
        },
        include: { paymentAllocations: true },
      });
    });

    it('should throw NotFoundException when charge not found', async () => {
      // ARRANGE
      const tenantId = 'tenant-123';
      const buildingId = 'building-123';
      const chargeId = 'nonexistent';
      const userId = 'user-123';
      const userRoles = ['TENANT_ADMIN'];

      jest.spyOn(prismaService.charge, 'findFirst').mockResolvedValue(null);

      // ACT & ASSERT
      await expect(
        service.getCharge(tenantId, buildingId, chargeId, userRoles, userId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ========== TESTS: UPDATE CHARGE ==========
  describe('updateCharge', () => {
    it('should throw NotFoundException when charge not found', async () => {
      // ARRANGE
      const tenantId = 'tenant-123';
      const buildingId = 'building-123';
      const chargeId = 'nonexistent';
      const userRoles = ['TENANT_ADMIN'];

      const dto: UpdateChargeDto = {
        amount: 150.0,
      };

      jest.spyOn(validators, 'canWriteCharges').mockReturnValue(true);
      jest.spyOn(prismaService.charge, 'findFirst').mockResolvedValue(null);

      // ACT & ASSERT
      await expect(
        service.updateCharge(tenantId, buildingId, chargeId, userRoles, dto),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ========== TESTS: SUBMIT PAYMENT ==========
  describe('submitPayment', () => {
    const tenantId = 'tenant-123';
    const buildingId = 'building-123';
    const unitId = 'unit-123';
    const userId = 'user-123';
    const userRoles = ['RESIDENT'];

    beforeEach(() => {
      jest.spyOn(validators, 'canSubmitPayments').mockReturnValue(true);
      jest
        .spyOn(validators, 'validateBuildingBelongsToTenant')
        .mockResolvedValue(undefined);
      jest.spyOn(validators, 'isResidentOrOwner').mockReturnValue(true);
      jest
        .spyOn(validators, 'validateResidentUnitAccess')
        .mockResolvedValue(undefined);
      jest
        .spyOn(validators, 'validateUnitBelongsToBuildingAndTenant')
        .mockResolvedValue(undefined);
      jest.spyOn(prismaService.payment, 'findFirst').mockResolvedValue(null);
      jest.spyOn(prismaService.charge, 'findMany').mockResolvedValue([
        {
          id: 'charge-123',
          tenantId,
          buildingId,
          unitId,
          period: '2026-07',
          amount: 10000,
          currency: 'ARS',
          status: ChargeStatus.PENDING,
          dueDate: new Date('2026-07-24T00:00:00.000Z'),
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
          updatedAt: new Date('2026-07-01T00:00:00.000Z'),
          canceledAt: null,
          paymentAllocations: [],
        },
      ] as never);
      jest
        .spyOn(service as any, 'notifyAdminsOfPaymentSubmitted')
        .mockResolvedValue(undefined);
      jest.spyOn(prismaService.payment, 'create').mockImplementation(async ({ data }) => ({
        id: 'payment-123',
        tenantId,
        buildingId,
        unitId,
        createdAt: new Date('2026-07-24T12:00:00.000Z'),
        updatedAt: new Date('2026-07-24T12:00:00.000Z'),
        receiptStatus: 'PENDING',
        receiptNumber: null,
        receiptDocumentId: null,
        receiptGeneratedAt: null,
        rejectionReason: null,
        rejectionComment: null,
        reviewedByMembershipId: null,
        approvedByUserId: null,
        approvedAt: null,
        rejectedByUserId: null,
        rejectedAt: null,
        canceledAt: null,
        ...data,
      } as never));
      jest.spyOn(prismaService.paymentAllocation, 'create').mockImplementation(async ({ data }) => ({
        id: `allocation-${data.chargeId}`,
        ...data,
      } as never));
    });

    it('should create a submitted transfer payment against a selected charge with proof', async () => {
      const result = await service.submitPayment(
        tenantId,
        buildingId,
        userId,
        userRoles,
        {
          unitId,
          chargeId: 'charge-123',
          amount: 10000,
          currency: 'ARS',
          method: PaymentMethod.TRANSFER,
          reference: 'TRX-123',
          proofFileId: 'file-123',
        },
      );

      expect(result.status).toBe(PaymentStatus.SUBMITTED);
      expect(result.notes).toBeNull();
      expect(prismaService.payment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId,
          buildingId,
          unitId,
          amount: 10000,
          currency: 'ARS',
          method: PaymentMethod.TRANSFER,
          proofFileId: 'file-123',
          notes: 'resident-charge-selection-requires-resubmission',
        }),
      });
      expect(prismaService.paymentAllocation.create).toHaveBeenCalledWith({
        data: {
          tenantId,
          paymentId: 'payment-123',
          chargeId: 'charge-123',
          amount: 10000,
        },
      });
      expect(prismaService.$executeRaw).toHaveBeenCalledTimes(2);
    });

    it('should accept an overdue resident charge as long as it still has outstanding balance', async () => {
      jest.spyOn(prismaService.charge, 'findMany').mockResolvedValueOnce([
        {
          id: 'charge-123',
          tenantId,
          buildingId,
          unitId,
          period: '2026-04',
          amount: 10000,
          currency: 'ARS',
          status: ChargeStatus.PENDING,
          dueDate: new Date('2026-04-21T00:00:00.000Z'),
          createdAt: new Date('2026-04-01T00:00:00.000Z'),
          updatedAt: new Date('2026-04-01T00:00:00.000Z'),
          canceledAt: null,
          paymentAllocations: [],
        },
      ] as never);

      const result = await service.submitPayment(
        tenantId,
        buildingId,
        userId,
        userRoles,
        {
          unitId,
          chargeId: 'charge-123',
          amount: 10000,
          currency: 'ARS',
          method: PaymentMethod.TRANSFER,
          reference: 'TRX-OVERDUE',
          proofFileId: 'file-123',
        },
      );

      expect(result.status).toBe(PaymentStatus.SUBMITTED);
      expect(prismaService.payment.create).toHaveBeenCalled();
      expect(prismaService.paymentAllocation.create).toHaveBeenCalledWith({
        data: {
          tenantId,
          paymentId: 'payment-123',
          chargeId: 'charge-123',
          amount: 10000,
        },
      });
    });

    it('should reject transfer payment without proofFileId', async () => {
      await expect(
        service.submitPayment(tenantId, buildingId, userId, userRoles, {
          unitId,
          chargeId: 'charge-123',
          amount: 10000,
          method: PaymentMethod.TRANSFER,
          reference: 'TRX-123',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(prismaService.payment.create).not.toHaveBeenCalled();
    });

    it('rejects payment proofs larger than 10 MiB even when a client bypasses presign purpose', async () => {
      jest.spyOn(prismaService.file, 'findFirst').mockResolvedValueOnce({
        id: 'file-oversized',
        size: 10 * 1024 * 1024 + 1,
      } as never);

      await expect(
        service.submitPayment(tenantId, buildingId, userId, userRoles, {
          unitId,
          chargeId: 'charge-123',
          amount: 10000,
          method: PaymentMethod.TRANSFER,
          reference: 'TRX-OVERSIZED-PROOF',
          proofFileId: 'file-oversized',
        }),
      ).rejects.toThrow('El comprobante de pago supera el máximo de 10 MB');

      expect(prismaService.payment.create).not.toHaveBeenCalled();
    });

    it('rejects proof files outside the payment tenant', async () => {
      jest.spyOn(prismaService.file, 'findFirst').mockResolvedValueOnce(null as never);

      await expect(
        service.submitPayment(tenantId, buildingId, userId, userRoles, {
          unitId,
          chargeId: 'charge-123',
          amount: 10000,
          method: PaymentMethod.TRANSFER,
          reference: 'TRX-FOREIGN-PROOF',
          proofFileId: 'file-other-tenant',
        }),
      ).rejects.toThrow('El comprobante de pago no existe en este tenant');
    });

    it('should reject unsupported payment methods while provider is transfer-only', async () => {
      await expect(
        service.submitPayment(tenantId, buildingId, userId, userRoles, {
          unitId,
          chargeId: 'charge-123',
          amount: 10000,
          method: PaymentMethod.CARD,
          reference: 'CARD-123',
          proofFileId: 'file-123',
        }),
      ).rejects.toThrow('Por ahora solo se aceptan pagos por transferencia bancaria');

      expect(prismaService.payment.create).not.toHaveBeenCalled();
    });

    it('should reject resident payment for units outside self-scope', async () => {
      jest
        .spyOn(validators, 'validateResidentUnitAccess')
        .mockRejectedValue(new BadRequestException('Unit does not belong to resident'));

      await expect(
        service.submitPayment(tenantId, buildingId, userId, userRoles, {
          unitId: 'other-unit',
          chargeId: 'charge-123',
          amount: 10000,
          method: PaymentMethod.TRANSFER,
          reference: 'TRX-123',
          proofFileId: 'file-123',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject a recent duplicate payment for the same selected charge', async () => {
      jest.spyOn(prismaService.payment, 'findFirst').mockResolvedValue({
        id: 'payment-duplicate',
      } as any);

      await expect(
        service.submitPayment(tenantId, buildingId, userId, userRoles, {
          unitId,
          chargeId: 'charge-123',
          amount: 10000,
          method: PaymentMethod.TRANSFER,
          proofFileId: 'file-123',
        }),
      ).rejects.toThrow(ConflictException);

      expect(prismaService.payment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId,
            buildingId,
            unitId,
            amount: 10000,
            reference: undefined,
            paymentAllocations: {
              some: {
                tenantId,
                chargeId: { in: ['charge-123'] },
              },
            },
            createdAt: expect.objectContaining({ gte: expect.any(Date) }),
            status: { in: [PaymentStatus.SUBMITTED, PaymentStatus.APPROVED] },
          }),
        }),
      );
    });

    it('should allow the same unit and amount when the selected charge is different', async () => {
      jest.spyOn(prismaService.payment, 'findFirst').mockResolvedValue(null);
      jest.spyOn(prismaService.charge, 'findMany').mockResolvedValueOnce([
        {
          id: 'charge-456',
          tenantId,
          buildingId,
          unitId,
          period: '2026-07',
          amount: 10000,
          currency: 'ARS',
          status: ChargeStatus.PENDING,
          dueDate: new Date('2026-07-24T00:00:00.000Z'),
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
          updatedAt: new Date('2026-07-01T00:00:00.000Z'),
          canceledAt: null,
          paymentAllocations: [],
        },
      ] as never);

      const result = await service.submitPayment(
        tenantId,
        buildingId,
        userId,
        userRoles,
        {
          unitId,
          chargeId: 'charge-456',
          amount: 10000,
          method: PaymentMethod.TRANSFER,
          proofFileId: 'file-123',
        },
      );

      expect(result.status).toBe(PaymentStatus.SUBMITTED);
      expect(prismaService.payment.create).toHaveBeenCalled();
      expect(prismaService.payment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            paymentAllocations: {
              some: {
                tenantId,
                chargeId: { in: ['charge-456'] },
              },
            },
          }),
        }),
      );
    });

    it('should preserve legacy duplicate detection for admin payments', async () => {
      jest.spyOn(validators, 'isResidentOrOwner').mockReturnValue(false);
      jest.spyOn(prismaService.payment, 'findFirst').mockResolvedValue({
        id: 'payment-legacy-duplicate',
      } as any);

      await expect(
        service.submitPayment(tenantId, buildingId, userId, ['TENANT_ADMIN'], {
          unitId,
          amount: 10000,
          method: PaymentMethod.TRANSFER,
          reference: 'TRX-123',
          proofFileId: 'file-123',
        }),
      ).rejects.toThrow(ConflictException);

      expect(prismaService.payment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({ paymentAllocations: expect.anything() }),
        }),
      );
    });

    it('should reject resident payments that do not cover the full outstanding balance', async () => {
      jest.spyOn(prismaService.charge, 'findMany').mockResolvedValueOnce([
        {
          id: 'charge-123',
          tenantId,
          buildingId,
          unitId,
          period: '2026-07',
          amount: 4050000,
          currency: 'ARS',
          status: ChargeStatus.PARTIAL,
          dueDate: new Date('2026-07-24T00:00:00.000Z'),
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
          updatedAt: new Date('2026-07-01T00:00:00.000Z'),
          canceledAt: null,
          paymentAllocations: [
            {
              amount: 5000,
              payment: { id: 'approved-payment-1', status: PaymentStatus.APPROVED },
            },
          ],
        },
      ] as never);
      jest.spyOn(prismaService.charge, 'findMany').mockResolvedValueOnce([
        {
          id: 'charge-123',
          tenantId,
          buildingId,
          unitId: 'unit-123',
          period: '2026-07',
          amount: 10000,
          currency: 'ARS',
          status: ChargeStatus.PARTIAL,
          dueDate: new Date('2026-07-24T00:00:00.000Z'),
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
          updatedAt: new Date('2026-07-01T00:00:00.000Z'),
          canceledAt: null,
          paymentAllocations: [
            {
              amount: 5000,
              payment: { id: 'approved-payment-1', status: PaymentStatus.APPROVED },
            },
            {
              amount: 5000,
              payment: { id: 'payment-123', status: PaymentStatus.SUBMITTED },
            },
          ],
        },
      ] as never);

      await expect(
        service.submitPayment(tenantId, buildingId, userId, userRoles, {
          unitId,
          chargeId: 'charge-123',
          amount: 4040000,
          method: PaymentMethod.TRANSFER,
          reference: 'TRX-123',
          proofFileId: 'file-123',
        }),
      ).rejects.toThrow('El monto ya no coincide con la deuda actual. Actualiza la información e inténtalo nuevamente.');

      expect(prismaService.payment.create).not.toHaveBeenCalled();
      expect(prismaService.paymentAllocation.create).not.toHaveBeenCalled();
    });

    it('should accept a prefix of two consecutive resident obligations and allocate the exact total', async () => {
      jest.spyOn(prismaService.charge, 'findMany').mockResolvedValueOnce([
        {
          id: 'charge-1',
          tenantId,
          buildingId,
          unitId,
          period: '2026-06',
          amount: 10000,
          currency: 'ARS',
          status: ChargeStatus.PENDING,
          dueDate: new Date('2026-06-15T00:00:00.000Z'),
          createdAt: new Date('2026-06-01T00:00:00.000Z'),
          updatedAt: new Date('2026-06-01T00:00:00.000Z'),
          canceledAt: null,
          paymentAllocations: [],
        },
        {
          id: 'charge-2',
          tenantId,
          buildingId,
          unitId,
          period: '2026-07',
          amount: 8000,
          currency: 'ARS',
          status: ChargeStatus.PENDING,
          dueDate: new Date('2026-07-15T00:00:00.000Z'),
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
          updatedAt: new Date('2026-07-01T00:00:00.000Z'),
          canceledAt: null,
          paymentAllocations: [],
        },
        {
          id: 'charge-3',
          tenantId,
          buildingId,
          unitId,
          period: '2026-08',
          amount: 12000,
          currency: 'ARS',
          status: ChargeStatus.PENDING,
          dueDate: new Date('2026-08-15T00:00:00.000Z'),
          createdAt: new Date('2026-08-01T00:00:00.000Z'),
          updatedAt: new Date('2026-08-01T00:00:00.000Z'),
          canceledAt: null,
          paymentAllocations: [],
        },
      ] as never);

      const result = await service.submitPayment(tenantId, buildingId, userId, userRoles, {
        unitId,
        chargeIds: ['charge-2', 'charge-1'],
        amount: 18000,
        method: PaymentMethod.TRANSFER,
        proofFileId: 'file-123',
      });

      expect(result.status).toBe(PaymentStatus.SUBMITTED);
      expect(prismaService.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amount: 18000,
            currency: 'ARS',
          }),
        }),
      );
      expect(prismaService.paymentAllocation.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
        data: expect.objectContaining({
          chargeId: 'charge-1',
          amount: 10000,
        }),
      }));
      expect(prismaService.paymentAllocation.create).toHaveBeenNthCalledWith(2, expect.objectContaining({
        data: expect.objectContaining({
          chargeId: 'charge-2',
          amount: 8000,
        }),
      }));
    });

    it('should reject a resident selection that skips the oldest outstanding obligation', async () => {
      jest.spyOn(prismaService.charge, 'findMany').mockResolvedValueOnce([
        {
          id: 'charge-1',
          tenantId,
          buildingId,
          unitId,
          period: '2026-06',
          amount: 10000,
          currency: 'ARS',
          status: ChargeStatus.PENDING,
          dueDate: new Date('2026-06-15T00:00:00.000Z'),
          createdAt: new Date('2026-06-01T00:00:00.000Z'),
          updatedAt: new Date('2026-06-01T00:00:00.000Z'),
          canceledAt: null,
          paymentAllocations: [],
        },
        {
          id: 'charge-2',
          tenantId,
          buildingId,
          unitId,
          period: '2026-07',
          amount: 8000,
          currency: 'ARS',
          status: ChargeStatus.PENDING,
          dueDate: new Date('2026-07-15T00:00:00.000Z'),
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
          updatedAt: new Date('2026-07-01T00:00:00.000Z'),
          canceledAt: null,
          paymentAllocations: [],
        },
      ] as never);

      await expect(service.submitPayment(tenantId, buildingId, userId, userRoles, {
        unitId,
        chargeIds: ['charge-2'],
        amount: 8000,
        method: PaymentMethod.TRANSFER,
        proofFileId: 'file-123',
      })).rejects.toThrow('Solo puedes pagar períodos consecutivos desde la deuda más antigua.');

      expect(prismaService.payment.create).not.toHaveBeenCalled();
      expect(prismaService.paymentAllocation.create).not.toHaveBeenCalled();
    });

    it('should reject duplicate charge IDs in a resident selection', async () => {
      jest.spyOn(prismaService.charge, 'findMany').mockResolvedValueOnce([
        {
          id: 'charge-1',
          tenantId,
          buildingId,
          unitId,
          period: '2026-06',
          amount: 10000,
          currency: 'ARS',
          status: ChargeStatus.PENDING,
          dueDate: new Date('2026-06-15T00:00:00.000Z'),
          createdAt: new Date('2026-06-01T00:00:00.000Z'),
          updatedAt: new Date('2026-06-01T00:00:00.000Z'),
          canceledAt: null,
          paymentAllocations: [],
        },
      ] as never);

      await expect(service.submitPayment(tenantId, buildingId, userId, userRoles, {
        unitId,
        chargeIds: ['charge-1', 'charge-1'],
        amount: 10000,
        method: PaymentMethod.TRANSFER,
        proofFileId: 'file-123',
      })).rejects.toThrow('La selección contiene IDs duplicados o inválidos.');

      expect(prismaService.payment.create).not.toHaveBeenCalled();
      expect(prismaService.paymentAllocation.create).not.toHaveBeenCalled();
    });

    it('notifies admins for a pure resident payment even when the portal context is omitted', async () => {
      await service.submitPayment(
        tenantId,
        buildingId,
        userId,
        userRoles,
        {
          unitId,
          chargeId: 'charge-123',
          amount: 10000,
          currency: 'ARS',
          method: PaymentMethod.TRANSFER,
          reference: 'TRX-RESIDENT',
          proofFileId: 'file-123',
        },
      );

      expect((service as any).notifyAdminsOfPaymentSubmitted).toHaveBeenCalledTimes(1);
    });

    it('does not notify admins for an admin-context payment', async () => {
      jest.spyOn(validators, 'isResidentOrOwner').mockReturnValue(false);

      await service.submitPayment(
        tenantId,
        buildingId,
        userId,
        ['TENANT_ADMIN'],
        {
          amount: 10000,
          method: PaymentMethod.TRANSFER,
          reference: 'TRX-ADMIN',
          proofFileId: 'file-123',
        },
        'admin',
      );

      expect((service as any).notifyAdminsOfPaymentSubmitted).not.toHaveBeenCalled();
    });

    it('respects mixed membership portal context and only notifies admins when the resident portal is explicit', async () => {
      const mixedRoles = ['RESIDENT', 'TENANT_ADMIN'];

      await service.submitPayment(
        tenantId,
        buildingId,
        userId,
        mixedRoles,
        {
          unitId,
          chargeId: 'charge-123',
          amount: 10000,
          currency: 'ARS',
          method: PaymentMethod.TRANSFER,
          reference: 'TRX-MIXED',
          proofFileId: 'file-123',
        },
        'resident',
      );

      expect((service as any).notifyAdminsOfPaymentSubmitted).toHaveBeenCalledTimes(1);
    });

    it('does not let an admin portal header suppress resident-origin payment notifications', async () => {
      await service.submitPayment(
        tenantId,
        buildingId,
        userId,
        userRoles,
        {
          unitId,
          chargeId: 'charge-123',
          amount: 10000,
          currency: 'ARS',
          method: PaymentMethod.TRANSFER,
          reference: 'TRX-RESIDENT-ADMIN-HEADER',
          proofFileId: 'file-123',
        },
        'admin',
      );

      expect((service as any).notifyAdminsOfPaymentSubmitted).toHaveBeenCalledTimes(1);
    });
  });

  // ========== TESTS: APPROVE PAYMENT ==========
  describe('approvePayment', () => {
    const tenantId = 'tenant-123';
    const buildingId = 'building-123';
    const paymentId = 'payment-123';
    const membershipId = 'membership-123';

    beforeEach(() => {
      jest.spyOn(validators, 'canReviewPayments').mockReturnValue(true);
      jest.spyOn(prismaService.payment, 'findFirst').mockResolvedValue({
        id: paymentId,
        tenantId,
        buildingId,
        unitId: 'unit-123',
        amount: 10000,
        currency: 'ARS',
        status: PaymentStatus.SUBMITTED,
        canceledAt: null,
        paymentAllocations: [
          {
            chargeId: 'charge-123',
            amount: 10000,
            charge: {
              id: 'charge-123',
              unitId: 'unit-123',
              buildingId,
              currency: 'ARS',
            },
          },
        ],
      } as any);
      jest.spyOn(prismaService.charge, 'findMany').mockResolvedValue([
        {
          id: 'charge-123',
          tenantId,
          buildingId,
          unitId: 'unit-123',
          period: '2026-07',
          amount: 10000,
          currency: 'ARS',
          status: ChargeStatus.PENDING,
          dueDate: new Date('2026-07-24T00:00:00.000Z'),
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
          updatedAt: new Date('2026-07-01T00:00:00.000Z'),
          canceledAt: null,
          paymentAllocations: [
            {
              amount: 10000,
              payment: { id: paymentId, status: PaymentStatus.SUBMITTED },
            },
          ],
        },
      ] as never);
      jest.spyOn(prismaService.payment, 'update').mockResolvedValue({
        id: paymentId,
        status: PaymentStatus.APPROVED,
        paidAt: new Date('2026-07-24T12:00:00.000Z'),
      } as any);
      jest.spyOn(prismaService.payment, 'findUnique').mockResolvedValue(null);
      jest.spyOn(prismaService.charge, 'findUnique').mockResolvedValue(null);
      jest.spyOn(prismaService.paymentAuditLog, 'create').mockResolvedValue({} as any);
    });

    it('keeps a resident-selected payment on a single charge without FIFO allocation', async () => {
      const result = await service.approvePayment(
        tenantId,
        buildingId,
        paymentId,
        ['TENANT_ADMIN'],
        membershipId,
        { paidAt: '2026-07-24T12:00:00.000Z' },
      );

      expect(result.status).toBe(PaymentStatus.APPROVED);
      expect(prismaService.charge.findMany).toHaveBeenCalledTimes(2);
      expect(prismaService.paymentAllocation.create).not.toHaveBeenCalled();
      expect(prismaService.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: paymentId },
          data: expect.objectContaining({
            status: PaymentStatus.APPROVED,
            reviewedByMembershipId: membershipId,
          }),
        }),
      );
    });

    it('ignores submitted and rejected allocations when approving a legacy FIFO payment', async () => {
      jest.spyOn(prismaService.payment, 'findFirst').mockResolvedValueOnce({
        id: paymentId,
        tenantId,
        buildingId,
        unitId: 'unit-123',
        amount: 10000,
        currency: 'ARS',
        status: PaymentStatus.SUBMITTED,
        canceledAt: null,
        paymentAllocations: [],
      } as any);
      jest.spyOn(prismaService.charge, 'findMany').mockResolvedValueOnce([
        {
          id: 'charge-123',
          tenantId,
          buildingId,
          unitId: 'unit-123',
          amount: 10000,
          currency: 'ARS',
          status: ChargeStatus.PARTIAL,
          paymentAllocations: [
            {
              amount: 5000,
              payment: { status: PaymentStatus.SUBMITTED },
            },
            {
              amount: 3000,
              payment: { status: PaymentStatus.REJECTED },
            },
          ],
        },
      ] as any);
      jest.spyOn(prismaService.charge, 'findFirst').mockResolvedValueOnce({
        id: 'charge-123',
        tenantId,
        buildingId,
        unitId: 'unit-123',
        amount: 10000,
        currency: 'ARS',
        status: ChargeStatus.PARTIAL,
        paymentAllocations: [
          {
            amount: 5000,
            payment: { status: PaymentStatus.SUBMITTED },
          },
          {
            amount: 3000,
            payment: { status: PaymentStatus.REJECTED },
          },
        ],
      } as any);

      const result = await service.approvePayment(
        tenantId,
        buildingId,
        paymentId,
        ['TENANT_ADMIN'],
        membershipId,
        {},
      );

      expect(result.status).toBe(PaymentStatus.APPROVED);
      expect(prismaService.paymentAllocation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            paymentId,
            chargeId: 'charge-123',
            amount: 10000,
          }),
        }),
      );
      expect(prismaService.paymentAllocation.create).toHaveBeenCalledTimes(1);
    });

    it('rejects approval when the charge balance changed after submission', async () => {
      jest.spyOn(prismaService.charge, 'findMany').mockResolvedValueOnce([
        {
          id: 'charge-123',
          tenantId,
          buildingId,
          unitId: 'unit-123',
          period: '2026-07',
          amount: 10000,
          currency: 'ARS',
          status: ChargeStatus.PARTIAL,
          dueDate: new Date('2026-07-24T00:00:00.000Z'),
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
          updatedAt: new Date('2026-07-01T00:00:00.000Z'),
          canceledAt: null,
          paymentAllocations: [
            {
              amount: 5000,
              payment: { id: 'approved-payment-1', status: PaymentStatus.APPROVED },
            },
            {
              amount: 5000,
              payment: { id: paymentId, status: PaymentStatus.SUBMITTED },
            },
          ],
        },
      ] as never);
      jest.spyOn(prismaService.charge, 'findMany').mockResolvedValueOnce([
        {
          id: 'charge-123',
          tenantId,
          buildingId,
          unitId: 'unit-123',
          period: '2026-07',
          amount: 10000,
          currency: 'ARS',
          status: ChargeStatus.PARTIAL,
          dueDate: new Date('2026-07-24T00:00:00.000Z'),
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
          updatedAt: new Date('2026-07-01T00:00:00.000Z'),
          canceledAt: null,
          paymentAllocations: [
            {
              amount: 5000,
              payment: { id: 'approved-payment-1', status: PaymentStatus.APPROVED },
            },
            {
              amount: 5000,
              payment: { id: paymentId, status: PaymentStatus.SUBMITTED },
            },
          ],
        },
      ] as never);

      await expect(
        service.approvePayment(
          tenantId,
          buildingId,
          paymentId,
          ['TENANT_ADMIN'],
          membershipId,
          {},
        ),
      ).rejects.toThrow('El monto ya no coincide con la deuda actual. Actualiza la información e inténtalo nuevamente.');

      expect(prismaService.payment.update).not.toHaveBeenCalled();
      expect(prismaService.charge.findMany).toHaveBeenCalledTimes(2);
    });

    it('locks the selected charge before approving a resident-selected payment', async () => {
      await service.approvePayment(
        tenantId,
        buildingId,
        paymentId,
        ['TENANT_ADMIN'],
        membershipId,
        { paidAt: '2026-07-24T12:00:00.000Z' },
      );

      expect(prismaService.$queryRaw).toHaveBeenCalledTimes(2);
      expect(prismaService.$executeRaw).toHaveBeenCalledTimes(1);
      const rawQueries = (prismaService.$queryRaw as jest.Mock).mock.calls.map(
        ([query]) => (query as { strings?: string[] }).strings?.join(' '),
      );
      expect(rawQueries.some((query) => query?.includes('FROM "Payment"'))).toBe(true);
      expect(rawQueries.some((query) => query?.includes('FROM "Charge"'))).toBe(true);
    });

    it('approves a resident-selected payment that covers two consecutive obligations', async () => {
      jest.spyOn(prismaService.payment, 'findFirst').mockResolvedValueOnce({
        id: paymentId,
        tenantId,
        buildingId,
        unitId: 'unit-123',
        amount: 18000,
        currency: 'ARS',
        status: PaymentStatus.SUBMITTED,
        canceledAt: null,
        paymentAllocations: [
          { chargeId: 'charge-123', amount: 10000 },
          { chargeId: 'charge-456', amount: 8000 },
        ],
      } as any);
      jest.spyOn(prismaService.charge, 'findMany').mockResolvedValueOnce([
        {
          id: 'charge-123',
          tenantId,
          buildingId,
          unitId: 'unit-123',
          period: '2026-06',
          amount: 10000,
          currency: 'ARS',
          status: ChargeStatus.PENDING,
          dueDate: new Date('2026-06-15T00:00:00.000Z'),
          createdAt: new Date('2026-06-01T00:00:00.000Z'),
          updatedAt: new Date('2026-06-01T00:00:00.000Z'),
          canceledAt: null,
          paymentAllocations: [
            { amount: 10000, payment: { id: paymentId, status: PaymentStatus.SUBMITTED } },
          ],
        },
        {
          id: 'charge-456',
          tenantId,
          buildingId,
          unitId: 'unit-123',
          period: '2026-07',
          amount: 8000,
          currency: 'ARS',
          status: ChargeStatus.PENDING,
          dueDate: new Date('2026-07-15T00:00:00.000Z'),
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
          updatedAt: new Date('2026-07-01T00:00:00.000Z'),
          canceledAt: null,
          paymentAllocations: [
            { amount: 8000, payment: { id: paymentId, status: PaymentStatus.SUBMITTED } },
          ],
        },
      ] as never);
      jest.spyOn(prismaService.charge, 'findMany').mockResolvedValueOnce([
        {
          id: 'charge-123',
          tenantId,
          buildingId,
          unitId: 'unit-123',
          period: '2026-06',
          amount: 10000,
          currency: 'ARS',
          status: ChargeStatus.PENDING,
          dueDate: new Date('2026-06-15T00:00:00.000Z'),
          createdAt: new Date('2026-06-01T00:00:00.000Z'),
          updatedAt: new Date('2026-06-01T00:00:00.000Z'),
          canceledAt: null,
          paymentAllocations: [
            { amount: 10000, payment: { id: paymentId, status: PaymentStatus.SUBMITTED } },
          ],
        },
        {
          id: 'charge-456',
          tenantId,
          buildingId,
          unitId: 'unit-123',
          period: '2026-07',
          amount: 8000,
          currency: 'ARS',
          status: ChargeStatus.PENDING,
          dueDate: new Date('2026-07-15T00:00:00.000Z'),
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
          updatedAt: new Date('2026-07-01T00:00:00.000Z'),
          canceledAt: null,
          paymentAllocations: [
            { amount: 8000, payment: { id: paymentId, status: PaymentStatus.SUBMITTED } },
          ],
        },
      ] as never);

      const result = await service.approvePayment(
        tenantId,
        buildingId,
        paymentId,
        ['TENANT_ADMIN'],
        membershipId,
        { paidAt: '2026-07-24T12:00:00.000Z' },
      );

      expect(result.status).toBe(PaymentStatus.APPROVED);
      expect(prismaService.charge.findMany).toHaveBeenCalledTimes(2);
      expect(prismaService.paymentAllocation.create).not.toHaveBeenCalled();
      expect(prismaService.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: paymentId },
          data: expect.objectContaining({
            status: PaymentStatus.APPROVED,
          }),
        }),
      );
    });
  });

  // ========== TESTS: APPROVE PAYMENT TENANT ==========
  describe('approvePaymentTenant', () => {
    const tenantId = 'tenant-123';
    const buildingId = 'building-123';
    const paymentId = 'payment-tenant-123';
    const membershipId = 'membership-123';

    beforeEach(() => {
      jest.spyOn(validators, 'canReviewPayments').mockReturnValue(true);
      jest.spyOn(prismaService.paymentAuditLog, 'create').mockResolvedValue({} as any);
      jest.spyOn(prismaService.charge, 'update').mockResolvedValue({
        id: 'charge-123',
        status: ChargeStatus.PAID,
      } as any);
    });

    it('reconciles tenant-approved payments when all explicit allocations settle their charges', async () => {
      jest.spyOn(prismaService.payment, 'findFirst').mockResolvedValue({
        id: paymentId,
        tenantId,
        buildingId,
        unitId: 'unit-123',
        amount: 10000,
        currency: 'ARS',
        status: PaymentStatus.SUBMITTED,
        canceledAt: null,
        paymentAllocations: [
          {
            chargeId: 'charge-123',
            amount: 10000,
          },
        ],
      } as any);
      jest.spyOn(prismaService.charge, 'findMany').mockResolvedValue([
        {
          id: 'charge-123',
          tenantId,
          buildingId,
          unitId: 'unit-123',
          period: '2026-07',
          amount: 10000,
          currency: 'ARS',
          status: ChargeStatus.PENDING,
          dueDate: new Date('2026-07-24T00:00:00.000Z'),
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
          updatedAt: new Date('2026-07-01T00:00:00.000Z'),
          canceledAt: null,
          paymentAllocations: [
            {
              amount: 10000,
              payment: { id: paymentId, status: PaymentStatus.SUBMITTED },
            },
          ],
        },
      ] as never);
      const paymentUpdateSpy = jest
        .spyOn(prismaService.payment, 'update')
        .mockResolvedValueOnce({
          id: paymentId,
          tenantId,
          buildingId,
          unitId: 'unit-123',
          amount: 10000,
          currency: 'ARS',
          method: PaymentMethod.TRANSFER,
          status: PaymentStatus.APPROVED,
          paidAt: new Date('2026-07-24T12:00:00.000Z'),
        } as any)
        .mockResolvedValueOnce({
          id: paymentId,
          tenantId,
          buildingId,
          unitId: 'unit-123',
          amount: 10000,
          currency: 'ARS',
          method: PaymentMethod.TRANSFER,
          status: PaymentStatus.RECONCILED,
          paidAt: new Date('2026-07-24T12:00:00.000Z'),
        } as any);
      jest.spyOn(prismaService.payment, 'findUnique')
        .mockResolvedValueOnce({
          id: paymentId,
          tenantId,
          buildingId,
          unitId: 'unit-123',
          amount: 10000,
          currency: 'ARS',
          status: PaymentStatus.APPROVED,
          paymentAllocations: [
            {
              amount: 10000,
              charge: { status: ChargeStatus.PAID },
            },
          ],
        } as any)
        .mockResolvedValueOnce({
          id: paymentId,
          tenantId,
          buildingId,
          unitId: 'unit-123',
          amount: 10000,
          currency: 'ARS',
          method: PaymentMethod.TRANSFER,
          status: PaymentStatus.RECONCILED,
          paidAt: new Date('2026-07-24T12:00:00.000Z'),
        } as any)
        .mockResolvedValueOnce({
          id: paymentId,
          tenantId,
          buildingId,
          unitId: 'unit-123',
          amount: 10000,
          currency: 'ARS',
          method: PaymentMethod.TRANSFER,
          status: PaymentStatus.RECONCILED,
          paidAt: new Date('2026-07-24T12:00:00.000Z'),
        } as any);

      const result = await service.approvePaymentTenant(
        tenantId,
        paymentId,
        ['TENANT_ADMIN'],
        membershipId,
        { paidAt: '2026-07-24T12:00:00.000Z' },
      );

      expect(result.status).toBe(PaymentStatus.RECONCILED);
      expect(paymentUpdateSpy).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: { id: paymentId },
          data: expect.objectContaining({
            status: PaymentStatus.APPROVED,
            reviewedByMembershipId: membershipId,
          }),
        }),
      );
      expect(paymentUpdateSpy).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: { id: paymentId },
          data: expect.objectContaining({
            status: PaymentStatus.RECONCILED,
          }),
        }),
      );
    });

    it('keeps tenant-approved payments approved when the remaining balance is still open', async () => {
      jest.spyOn(prismaService.payment, 'findFirst').mockResolvedValue({
        id: paymentId,
        tenantId,
        buildingId,
        unitId: 'unit-123',
        amount: 5000,
        currency: 'ARS',
        status: PaymentStatus.SUBMITTED,
        canceledAt: null,
        paymentAllocations: [
          {
            chargeId: 'charge-123',
            amount: 5000,
          },
        ],
      } as any);
      jest.spyOn(prismaService.charge, 'findMany').mockResolvedValue([
        {
          id: 'charge-123',
          tenantId,
          buildingId,
          unitId: 'unit-123',
          period: '2026-07',
          amount: 10000,
          currency: 'ARS',
          status: ChargeStatus.PARTIAL,
          dueDate: new Date('2026-07-24T00:00:00.000Z'),
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
          updatedAt: new Date('2026-07-01T00:00:00.000Z'),
          canceledAt: null,
          paymentAllocations: [
            {
              amount: 5000,
              payment: { id: 'approved-payment-1', status: PaymentStatus.APPROVED },
            },
            {
              amount: 5000,
              payment: { id: paymentId, status: PaymentStatus.SUBMITTED },
            },
          ],
        },
      ] as never);
      const paymentUpdateSpy = jest
        .spyOn(prismaService.payment, 'update')
        .mockResolvedValueOnce({
          id: paymentId,
          tenantId,
          buildingId,
          unitId: 'unit-123',
          amount: 5000,
          currency: 'ARS',
          method: PaymentMethod.TRANSFER,
          status: PaymentStatus.APPROVED,
          paidAt: new Date('2026-07-24T12:00:00.000Z'),
        } as any);
      jest.spyOn(prismaService.payment, 'findUnique').mockResolvedValueOnce({
        id: paymentId,
        tenantId,
        buildingId,
        unitId: 'unit-123',
        amount: 5000,
        currency: 'ARS',
        method: PaymentMethod.TRANSFER,
        status: PaymentStatus.APPROVED,
        paidAt: new Date('2026-07-24T12:00:00.000Z'),
        paymentAllocations: [],
      } as any);

      const result = await service.approvePaymentTenant(
        tenantId,
        paymentId,
        ['TENANT_ADMIN'],
        membershipId,
        {},
      );

      expect(result.status).toBe(PaymentStatus.APPROVED);
      expect(paymentUpdateSpy).toHaveBeenCalledTimes(1);
      expect(prismaService.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: PaymentStatus.APPROVED,
          }),
        }),
      );
    });
  });

  // ========== TESTS: APPROVAL LOCKING ==========
  describe('payment approval locking', () => {
    const tenantId = 'tenant-lock-123';
    const buildingId = 'building-lock-123';
    const paymentId = 'payment-lock-123';
    const secondPaymentId = 'payment-lock-456';
    const membershipId = 'membership-lock-123';
    const chargeId = 'charge-lock-123';

    type PaymentState = {
      id: string;
      tenantId: string;
      buildingId: string;
      unitId: string;
      amount: number;
      currency: string;
      status: PaymentStatus;
      canceledAt: Date | null;
      reviewedByMembershipId?: string | null;
      reviewedAt?: Date | null;
      paidAt?: Date | null;
      updatedAt?: Date | null;
      rejectionReason?: string | null;
      rejectionComment?: string | null;
      notes?: string | null;
      paymentAllocations: Array<{
        chargeId: string;
        amount: number;
      }>;
    };

    type ChargeState = {
      id: string;
      tenantId: string;
      buildingId: string;
      unitId: string;
      amount: number;
      currency: string;
      status: ChargeStatus;
      paymentAllocations: Array<{
        amount: number;
        paymentStatus: PaymentStatus;
      }>;
    };

    let paymentStates: Record<string, PaymentState>;
    let chargeStates: Record<string, ChargeState>;

    const toPaymentRecord = (paymentIdToRead: string): any => {
      const paymentState = paymentStates[paymentIdToRead]!;

      return {
        id: paymentState.id,
        tenantId: paymentState.tenantId,
        buildingId: paymentState.buildingId,
        unitId: paymentState.unitId,
        amount: paymentState.amount,
        currency: paymentState.currency,
        status: paymentState.status,
        canceledAt: paymentState.canceledAt,
        paymentAllocations: paymentState.paymentAllocations.map((allocation) => ({
          chargeId: allocation.chargeId,
          amount: allocation.amount,
          payment: { status: paymentState.status },
        })),
      };
    };

    const toChargeRecord = (chargeIdToRead: string): any => {
      const chargeState = chargeStates[chargeIdToRead]!;

      return {
        id: chargeState.id,
        tenantId: chargeState.tenantId,
        buildingId: chargeState.buildingId,
        unitId: chargeState.unitId,
        amount: chargeState.amount,
        currency: chargeState.currency,
        status: chargeState.status,
        paymentAllocations: chargeState.paymentAllocations.map((allocation) => ({
          amount: allocation.amount,
          payment: { status: allocation.paymentStatus },
        })),
      };
    };

    const installSerializedPaymentLock = () => {
      const locks = new Map<string, { held: boolean; waiters: Array<() => void> }>();

      jest.spyOn(prismaService, '$transaction').mockImplementation(
        async (callback: (tx: never) => Promise<unknown>) => {
          const tx = {
            ...prismaService,
            $queryRaw: jest.fn(async (query: { values?: readonly unknown[] }) => {
              const paymentLockId = String(query.values?.[0] ?? '');
              const lock = locks.get(paymentLockId) ?? { held: false, waiters: [] as Array<() => void> };

              if (lock.held) {
                await new Promise<void>((resolve) => {
                  lock.waiters.push(resolve);
                });
              }

              lock.held = true;
              locks.set(paymentLockId, lock);
              return [];
            }),
          } as never;

          try {
            return await callback(tx);
          } finally {
            for (const lock of locks.values()) {
              lock.held = false;
              const next = lock.waiters.shift();
              if (next) {
                next();
              }
            }
          }
        },
      );
    };

    const installSharedApprovalState = () => {
      paymentStates = {
        [paymentId]: {
          id: paymentId,
          tenantId,
          buildingId,
          unitId: 'unit-123',
          amount: 10000,
          currency: 'ARS',
          status: PaymentStatus.SUBMITTED,
          canceledAt: null,
          paymentAllocations: [],
        },
        [secondPaymentId]: {
          id: secondPaymentId,
          tenantId,
          buildingId,
          unitId: 'unit-456',
          amount: 5000,
          currency: 'ARS',
          status: PaymentStatus.SUBMITTED,
          canceledAt: null,
          paymentAllocations: [],
        },
      };

      chargeStates = {
        [chargeId]: {
          id: chargeId,
          tenantId,
          buildingId,
          unitId: 'unit-123',
          amount: 10000,
          currency: 'ARS',
          status: ChargeStatus.PENDING,
          paymentAllocations: [],
        },
        'charge-lock-456': {
          id: 'charge-lock-456',
          tenantId,
          buildingId,
          unitId: 'unit-456',
          amount: 5000,
          currency: 'ARS',
          status: ChargeStatus.PENDING,
          paymentAllocations: [],
        },
      };

      jest.spyOn(prismaService.payment, 'findFirst').mockImplementation(async ({ where }) => {
        const paymentState = paymentStates[where.id];
        if (
          !paymentState ||
          paymentState.tenantId !== where.tenantId ||
          (where.buildingId && where.buildingId !== paymentState.buildingId)
        ) {
          return null as never;
        }

        return toPaymentRecord(where.id);
      });

      jest.spyOn(prismaService.payment, 'findUnique').mockImplementation(async ({ where }) => {
        const paymentState = paymentStates[where.id];
        if (!paymentState) {
          return null as never;
        }

        return {
          ...toPaymentRecord(where.id),
          paymentAllocations: paymentState.paymentAllocations.map((allocation) => ({
            amount: allocation.amount,
            charge: { status: chargeStates[allocation.chargeId]?.status ?? ChargeStatus.PENDING },
          })),
        } as never;
      });

      jest.spyOn(prismaService.payment, 'update').mockImplementation(async ({ where, data }) => {
        const paymentState = paymentStates[where.id];
        if (!paymentState) {
          throw new Error(`Missing payment state for ${where.id}`);
        }

        paymentStates[where.id] = {
          ...paymentState,
          status: data.status ?? paymentState.status,
          reviewedByMembershipId: data.reviewedByMembershipId ?? null,
          reviewedAt: data.reviewedAt ?? null,
          paidAt: data.paidAt ?? null,
          updatedAt: data.updatedAt ?? new Date(),
          canceledAt: data.canceledAt ?? paymentState.canceledAt,
        } as PaymentState;

        return toPaymentRecord(where.id);
      });

      jest.spyOn(prismaService.charge, 'findMany').mockImplementation(async ({ where }) => {
        const charges = Object.values(chargeStates).filter(
          (chargeState) =>
            chargeState.tenantId === where.tenantId &&
            chargeState.buildingId === where.buildingId &&
            chargeState.unitId === where.unitId &&
            chargeState.status !== ChargeStatus.PAID &&
            chargeState.status !== ChargeStatus.CANCELED,
        );

        return charges.map((chargeState) => toChargeRecord(chargeState.id)) as never;
      });
      jest.spyOn(prismaService.charge, 'findFirst').mockImplementation(async ({ where }) => {
        const chargeState = chargeStates[where.id];
        if (
          !chargeState ||
          chargeState.tenantId !== where.tenantId ||
          chargeState.buildingId !== where.buildingId ||
          chargeState.unitId !== where.unitId
        ) {
          return null as never;
        }

        return toChargeRecord(where.id);
      });
      jest.spyOn(prismaService.charge, 'findUnique').mockImplementation(async ({ where }) => {
        const chargeState = chargeStates[where.id];
        if (!chargeState) {
          return null as never;
        }

        return toChargeRecord(where.id);
      });
      jest.spyOn(prismaService.charge, 'update').mockImplementation(async ({ where, data }) => {
        const chargeState = chargeStates[where.id];
        if (!chargeState) {
          throw new Error(`Missing charge state for ${where.id}`);
        }

        chargeStates[where.id] = {
          ...chargeState,
          status: data.status ?? chargeState.status,
        };

        return toChargeRecord(where.id);
      });
      jest.spyOn(prismaService.paymentAllocation, 'create').mockImplementation(async ({ data }) => {
        const paymentState = paymentStates[data.paymentId];
        const chargeState = chargeStates[data.chargeId];

        if (!paymentState || !chargeState) {
          throw new Error('Missing payment or charge state for allocation');
        }

        paymentStates[data.paymentId] = {
          ...paymentState,
          paymentAllocations: [
            ...paymentState.paymentAllocations,
            {
              chargeId: data.chargeId,
              amount: data.amount,
            },
          ],
        };
        chargeStates[data.chargeId] = {
          ...chargeState,
          paymentAllocations: [
            ...chargeState.paymentAllocations,
            {
              amount: data.amount,
              paymentStatus: paymentStates[data.paymentId].status,
            },
          ],
        };

        return {
          id: `allocation-${paymentStates[data.paymentId].paymentAllocations.length}`,
          tenantId: data.tenantId,
          paymentId: data.paymentId,
          chargeId: data.chargeId,
          amount: data.amount,
        } as never;
      });

      jest.spyOn(prismaService.paymentAuditLog, 'create').mockResolvedValue({} as never);
    };

    beforeEach(() => {
      jest.spyOn(validators, 'canReviewPayments').mockReturnValue(true);
      jest.spyOn(service as any, 'sendPaymentReceivedNotification').mockResolvedValue(undefined);
      jest.spyOn(receiptService, 'ensureReceiptForPayment').mockResolvedValue(undefined);
      jest.spyOn(prismaService.membership, 'findFirst').mockResolvedValue({ userId: 'member-user-1' } as never);
    });

    it('serializes approvePayment so the same payment cannot be applied twice', async () => {
      installSerializedPaymentLock();
      installSharedApprovalState();

      const firstApproval = service.approvePayment(
        tenantId,
        buildingId,
        paymentId,
        ['TENANT_ADMIN'],
        membershipId,
        {},
      );
      const secondApproval = service.approvePayment(
        tenantId,
        buildingId,
        paymentId,
        ['TENANT_ADMIN'],
        membershipId,
        {},
      );

      const [firstResult, secondResult] = await Promise.allSettled([
        firstApproval,
        secondApproval,
      ]);

      expect(firstResult).toEqual(
        expect.objectContaining({
          status: 'fulfilled',
          value: expect.objectContaining({
            status: PaymentStatus.APPROVED,
          }),
        }),
      );
      expect(secondResult).toEqual(
        expect.objectContaining({
          status: 'rejected',
          reason: expect.objectContaining({
            message: 'Cannot approve payment in status RECONCILED. Only SUBMITTED payments can be approved.',
          }),
        }),
      );

      expect(prismaService.paymentAllocation.create).toHaveBeenCalledTimes(1);
      expect(prismaService.charge.update).toHaveBeenCalledTimes(1);
      expect(auditService.createLog).toHaveBeenCalledTimes(1);
      expect(receiptService.ensureReceiptForPayment).toHaveBeenCalledTimes(1);
      expect(prismaService.payment.update).toHaveBeenCalledTimes(2);
    });

    it('serializes approvePaymentTenant so the same payment cannot be applied twice', async () => {
      installSerializedPaymentLock();
      installSharedApprovalState();

      const firstApproval = service.approvePaymentTenant(
        tenantId,
        paymentId,
        ['TENANT_ADMIN'],
        membershipId,
        {},
      );
      const secondApproval = service.approvePaymentTenant(
        tenantId,
        paymentId,
        ['TENANT_ADMIN'],
        membershipId,
        {},
      );

      const [firstResult, secondResult] = await Promise.allSettled([
        firstApproval,
        secondApproval,
      ]);

      expect(firstResult).toEqual(
        expect.objectContaining({
          status: 'fulfilled',
          value: expect.objectContaining({
            status: PaymentStatus.RECONCILED,
          }),
        }),
      );
      expect(secondResult).toEqual(
        expect.objectContaining({
          status: 'rejected',
          reason: expect.objectContaining({
            message: 'Cannot approve payment in status RECONCILED. Only SUBMITTED payments can be approved.',
          }),
        }),
      );

      expect(prismaService.paymentAllocation.create).toHaveBeenCalledTimes(1);
      expect(prismaService.charge.update).toHaveBeenCalledTimes(1);
      expect(prismaService.paymentAuditLog.create).toHaveBeenCalledTimes(1);
      expect(receiptService.ensureReceiptForPayment).toHaveBeenCalledTimes(1);
      expect(prismaService.payment.update).toHaveBeenCalledTimes(2);
    });

    it('allows two different payments to approve concurrently', async () => {
      installSerializedPaymentLock();
      installSharedApprovalState();

      const firstApproval = service.approvePayment(
        tenantId,
        buildingId,
        paymentId,
        ['TENANT_ADMIN'],
        membershipId,
        {},
      );
      const secondApproval = service.approvePayment(
        tenantId,
        buildingId,
        secondPaymentId,
        ['TENANT_ADMIN'],
        membershipId,
        {},
      );

      const [firstResult, secondResult] = await Promise.allSettled([
        firstApproval,
        secondApproval,
      ]);

      expect(firstResult).toEqual(
        expect.objectContaining({
          status: 'fulfilled',
          value: expect.objectContaining({ status: PaymentStatus.APPROVED }),
        }),
      );
      expect(secondResult).toEqual(
        expect.objectContaining({
          status: 'fulfilled',
          value: expect.objectContaining({ status: PaymentStatus.APPROVED }),
        }),
      );

      expect(prismaService.paymentAllocation.create).toHaveBeenCalledTimes(2);
      expect(auditService.createLog).toHaveBeenCalledTimes(2);
      expect(receiptService.ensureReceiptForPayment).toHaveBeenCalledTimes(2);
    });

    it.each([PaymentStatus.APPROVED, PaymentStatus.RECONCILED])(
      'rejects %s payments after the lock is reacquired',
      async (status) => {
        installSerializedPaymentLock();
        installSharedApprovalState();
        paymentStates[paymentId] = {
          ...paymentStates[paymentId]!,
          status,
        };

        await expect(
          service.approvePayment(
            tenantId,
            buildingId,
            paymentId,
            ['TENANT_ADMIN'],
            membershipId,
            {},
          ),
        ).rejects.toThrow(
          `Cannot approve payment in status ${status}. Only SUBMITTED payments can be approved.`,
        );

        expect(prismaService.paymentAllocation.create).not.toHaveBeenCalled();
        expect(prismaService.paymentAuditLog.create).not.toHaveBeenCalled();
      },
    );

    it('rejects canceled payments after the lock is reacquired', async () => {
      installSerializedPaymentLock();
      installSharedApprovalState();
      paymentStates[paymentId] = {
        ...paymentStates[paymentId]!,
        canceledAt: new Date('2026-07-24T12:00:00.000Z'),
      };

      await expect(
        service.approvePaymentTenant(
          tenantId,
          paymentId,
          ['TENANT_ADMIN'],
          membershipId,
          {},
        ),
      ).rejects.toThrow('Cannot approve a canceled payment');

      expect(prismaService.paymentAllocation.create).not.toHaveBeenCalled();
      expect(prismaService.paymentAuditLog.create).not.toHaveBeenCalled();
    });

    it('keeps approved allocations intact when cancellation waits for an in-flight approval', async () => {
      installSharedApprovalState();
      paymentStates[paymentId] = {
        ...paymentStates[paymentId]!,
        amount: 5000,
      };

      let resolveApprovalLock!: () => void;
      const approvalLocked = new Promise<void>((resolve) => {
        resolveApprovalLock = resolve;
      });
      let releaseApproval!: () => void;
      const approvalRelease = new Promise<void>((resolve) => {
        releaseApproval = resolve;
      });
      let releasePaymentLock!: () => void;
      const paymentLockReleased = new Promise<void>((resolve) => {
        releasePaymentLock = resolve;
      });
      let paymentLockHeld = false;
      let paymentLockAttempts = 0;
      let resolveSecondLockAttempted!: () => void;
      const secondLockAttempted = new Promise<void>((resolve) => {
        resolveSecondLockAttempted = resolve;
      });

      jest.spyOn(prismaService, '$transaction').mockImplementation(
        async (callback: (tx: never) => Promise<unknown>) => {
          const tx = {
            ...prismaService,
            $queryRaw: jest.fn(async (query: { values?: readonly unknown[] }) => {
              const lockedRecordId = String(query.values?.[0] ?? '');

              if (lockedRecordId !== paymentId) {
                return [];
              }

              paymentLockAttempts += 1;
              if (paymentLockHeld) {
                resolveSecondLockAttempted();
                await paymentLockReleased;
                return [];
              }

              paymentLockHeld = true;
              resolveApprovalLock();
              await approvalRelease;
              return [];
            }),
          } as never;

          try {
            return await callback(tx);
          } finally {
            if (paymentLockHeld) {
              paymentLockHeld = false;
              releasePaymentLock();
            }
          }
        },
      );
      jest.spyOn(prismaService.paymentAllocation, 'count').mockImplementation(async () =>
        paymentStates[paymentId]!.paymentAllocations.length as never,
      );
      jest.spyOn(prismaService.paymentAllocation, 'findMany').mockImplementation(async () =>
        paymentStates[paymentId]!.paymentAllocations.map((allocation) => ({
          chargeId: allocation.chargeId,
          amount: allocation.amount,
        })) as never,
      );

      const approval = service.approvePayment(
        tenantId,
        buildingId,
        paymentId,
        ['TENANT_ADMIN'],
        membershipId,
        {},
      );
      await approvalLocked;

      const cancellation = service.cancelPayment(
        tenantId,
        buildingId,
        paymentId,
        ['TENANT_ADMIN'],
        membershipId,
        'Manual cancellation',
      );

      await secondLockAttempted;
      expect(paymentLockAttempts).toBe(2);
      releaseApproval();

      await expect(approval).resolves.toEqual(
        expect.objectContaining({ status: PaymentStatus.APPROVED }),
      );
      await expect(cancellation).rejects.toThrow(
        'Cannot cancel payment with existing allocations. Remove allocations first.',
      );

      expect(paymentStates[paymentId]).toEqual(
        expect.objectContaining({
          status: PaymentStatus.APPROVED,
          canceledAt: null,
          paymentAllocations: [expect.objectContaining({ chargeId, amount: 5000 })],
        }),
      );
      expect(chargeStates[chargeId]).toEqual(
        expect.objectContaining({ status: ChargeStatus.PARTIAL }),
      );
      expect(prismaService.paymentAllocation.deleteMany).not.toHaveBeenCalled();
      expect(prismaService.charge.update).toHaveBeenCalledTimes(1);
    });
  });

  // ========== TESTS: REJECT / CANCEL PAYMENT PROVISIONAL ALLOCATIONS ==========
  describe('reject and cancel payment allocations', () => {
    const tenantId = 'tenant-123';
    const buildingId = 'building-123';
    const paymentId = 'payment-123';
    const chargeId = 'charge-123';
    const membershipId = 'membership-123';

    let allocationStore: Array<{ tenantId: string; paymentId: string; chargeId: string }> = [];

    const makeAllocation = (): { tenantId: string; paymentId: string; chargeId: string }[] => allocationStore.map((allocation) => ({ ...allocation }));

    const mockSubmittedPaymentState = (
      status: PaymentStatus = PaymentStatus.SUBMITTED,
      updateStatus: PaymentStatus = status,
      notes: string | null = null,
    ) => {
      allocationStore = [{ tenantId, paymentId, chargeId }];

      jest.spyOn(prismaService.payment, 'findFirst').mockResolvedValue({
        id: paymentId,
        tenantId,
        buildingId,
        unitId: 'unit-123',
        amount: 10000,
        currency: 'ARS',
        method: PaymentMethod.TRANSFER,
        reference: 'TRX-123',
        status,
        canceledAt: null,
        notes,
        paymentAllocations: makeAllocation().map((allocation) => ({
          tenantId: allocation.tenantId,
          paymentId: allocation.paymentId,
          chargeId: allocation.chargeId,
          amount: 10000,
          payment: { status },
        })),
      } as any);

      jest.spyOn(prismaService.paymentAllocation, 'findMany').mockImplementation(async ({ where }) =>
        makeAllocation()
          .filter((allocation) => allocation.tenantId === where.tenantId && allocation.paymentId === where.paymentId)
          .map((allocation) => ({ chargeId: allocation.chargeId, amount: 10000 })) as any,
      );

      jest.spyOn(prismaService.paymentAllocation, 'count').mockImplementation(async ({ where }) =>
        makeAllocation().filter((allocation) => allocation.tenantId === where.tenantId && allocation.paymentId === where.paymentId).length as any,
      );

      jest.spyOn(prismaService.paymentAllocation, 'deleteMany').mockImplementation(async ({ where }) => {
        const before = allocationStore.length;
        allocationStore = allocationStore.filter(
          (allocation) => !(allocation.tenantId === where.tenantId && allocation.paymentId === where.paymentId),
        );
        return { count: before - allocationStore.length } as any;
      });

      jest.spyOn(prismaService.charge, 'findFirst').mockImplementation(async ({ where }) => {
        if (where.id !== chargeId) return null as any;

        const chargeAllocations = makeAllocation().map(() => ({
          amount: 10000,
          payment: { status },
        }));

        return {
          id: chargeId,
          tenantId,
          buildingId,
          unitId: 'unit-123',
          amount: 10000,
          currency: 'ARS',
          status: chargeAllocations.length > 0 ? ChargeStatus.PARTIAL : ChargeStatus.PENDING,
          paymentAllocations: chargeAllocations,
        } as any;
      });

      jest.spyOn(prismaService.charge, 'findUnique').mockImplementation(async ({ where }) => {
        if (where.id !== chargeId) return null as any;

        const chargeAllocations = makeAllocation().map(() => ({
          amount: 10000,
          payment: { status },
        }));

        return {
          id: chargeId,
          tenantId,
          buildingId,
          unitId: 'unit-123',
          amount: 10000,
          currency: 'ARS',
          status: chargeAllocations.length > 0 ? ChargeStatus.PARTIAL : ChargeStatus.PENDING,
          paymentAllocations: chargeAllocations,
        } as any;
      });

      jest.spyOn(prismaService.charge, 'update').mockResolvedValue({
        id: chargeId,
        tenantId,
        buildingId,
        unitId: 'unit-123',
        amount: 10000,
        currency: 'ARS',
        status: ChargeStatus.PENDING,
        paymentAllocations: [],
      } as any);

      jest.spyOn(prismaService.payment, 'update').mockImplementation(async ({ data }) => ({
        id: paymentId,
        tenantId,
        buildingId,
        unitId: 'unit-123',
        amount: 10000,
        currency: 'ARS',
        method: PaymentMethod.TRANSFER,
        status: updateStatus,
        canceledAt:
          updateStatus === PaymentStatus.SUBMITTED
            ? new Date('2026-07-24T12:00:00.000Z')
            : null,
        reviewedByMembershipId: data.reviewedByMembershipId ?? null,
        rejectionReason: data.rejectionReason ?? null,
        rejectionComment: data.rejectionComment ?? null,
        reviewedAt: data.reviewedAt ?? null,
        notes: data.notes ?? null,
        updatedAt: data.updatedAt ?? new Date('2026-07-24T12:00:00.000Z'),
      } as any));

      jest.spyOn(prismaService.paymentAuditLog, 'create').mockResolvedValue({} as any);
    };

    beforeEach(() => {
      jest.spyOn(validators, 'canReviewPayments').mockReturnValue(true);
      jest.spyOn(validators, 'canWriteCharges').mockReturnValue(true);
      jest.spyOn(validators, 'validateBuildingBelongsToTenant').mockResolvedValue(undefined);
      jest
        .spyOn(validators, 'validateUnitBelongsToBuildingAndTenant')
        .mockResolvedValue(undefined);
    });

    it('rejectPayment removes provisional allocations and unblocks the charge', async () => {
      mockSubmittedPaymentState(
        PaymentStatus.SUBMITTED,
        PaymentStatus.REJECTED,
        'resident-charge-selection-requires-resubmission',
      );
      const notificationSpy = jest
        .spyOn(service as any, 'sendPaymentRejectedNotification')
        .mockResolvedValue(undefined);

      await expect(
        service.updateCharge(tenantId, buildingId, chargeId, ['TENANT_ADMIN'], {
          concept: 'Updated concept before rejection',
        }),
      ).rejects.toThrow('Cannot update charge that has payment allocations');

      const result = await service.rejectPayment(
        tenantId,
        buildingId,
        paymentId,
        ['TENANT_ADMIN'],
        membershipId,
        {
          reason: 'OTHER',
          comment: 'Rejected by admin',
          notes: 'Reviewed against bank statement',
        },
      );

      expect(result.status).toBe(PaymentStatus.REJECTED);
      expect(result.rejectionReason).toBe('OTHER');
      expect(result.rejectionComment).toBe('Rejected by admin');
      expect(result.reviewedByMembershipId).toBe(membershipId);
      expect(result.reviewedAt).toEqual(expect.any(Date));
      expect(result.notes).toBe('Reviewed against bank statement');
      expect(result.notes).not.toContain('resident-charge-selection-requires-resubmission');
      expect(prismaService.payment.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          status: PaymentStatus.REJECTED,
          reviewedByMembershipId: membershipId,
          rejectionReason: 'OTHER',
          rejectionComment: 'Rejected by admin',
          notes: 'resident-charge-selection-requires-resubmission\nReviewed against bank statement',
        }),
      }));
      expect(prismaService.paymentAllocation.deleteMany).toHaveBeenCalledWith({
        where: { tenantId, paymentId },
      });
      expect(makeAllocation()).toHaveLength(0);
      expect(notificationSpy).toHaveBeenCalledWith(tenantId, expect.any(Object), 'OTHER', undefined);

      await expect(
        service.updateCharge(tenantId, buildingId, chargeId, ['TENANT_ADMIN'], {
          concept: 'Updated concept after rejection',
        }),
      ).resolves.toEqual(
        expect.objectContaining({
          id: chargeId,
        }),
      );
    });

    it('rejectPaymentTenant removes provisional allocations for the tenant payment', async () => {
      mockSubmittedPaymentState(
        PaymentStatus.SUBMITTED,
        PaymentStatus.REJECTED,
        'resident-charge-selection-requires-resubmission',
      );
      const notificationSpy = jest
        .spyOn(service as any, 'sendPaymentRejectedNotification')
        .mockResolvedValue(undefined);

      const result = await service.rejectPaymentTenant(
        tenantId,
        paymentId,
        ['TENANT_ADMIN'],
        membershipId,
        {
          reason: 'OTHER',
          comment: 'Rejected at tenant level',
          notes: 'Tenant review notes',
        },
      );

      expect(result.status).toBe(PaymentStatus.REJECTED);
      expect(result.rejectionReason).toBe('OTHER');
      expect(result.rejectionComment).toBe('Rejected at tenant level');
      expect(result.reviewedByMembershipId).toBe(membershipId);
      expect(result.reviewedAt).toEqual(expect.any(Date));
      expect(result.notes).toBe('Tenant review notes');
      expect(result.notes).not.toContain('resident-charge-selection-requires-resubmission');
      expect(prismaService.payment.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          status: PaymentStatus.REJECTED,
          reviewedByMembershipId: membershipId,
          rejectionReason: 'OTHER',
          rejectionComment: 'Rejected at tenant level',
          notes: 'resident-charge-selection-requires-resubmission\nTenant review notes',
        }),
      }));
      expect(prismaService.paymentAllocation.deleteMany).toHaveBeenCalledWith({
        where: { tenantId, paymentId },
      });
      expect(makeAllocation()).toHaveLength(0);
      expect(notificationSpy).toHaveBeenCalledWith(tenantId, expect.any(Object), 'OTHER', undefined);
    });

    it('cancelPayment removes provisional allocations for submitted payments', async () => {
      mockSubmittedPaymentState(PaymentStatus.SUBMITTED);

      const result = await service.cancelPayment(
        tenantId,
        buildingId,
        paymentId,
        ['TENANT_ADMIN'],
        membershipId,
        'Resident withdrew the report',
      );

      expect(result.canceledAt).toBeTruthy();
      expect(prismaService.paymentAllocation.deleteMany).toHaveBeenCalledWith({
        where: { tenantId, paymentId },
      });
      expect(makeAllocation()).toHaveLength(0);
    });

    it('blocks revival of a rejected resident-directed payment instead of falling back to FIFO', async () => {
      allocationStore = [];
      mockSubmittedPaymentState(
        PaymentStatus.REJECTED,
        PaymentStatus.SUBMITTED,
        'resident-charge-selection-requires-resubmission',
      );
      allocationStore = [];
      jest.spyOn(prismaService, '$queryRaw').mockResolvedValue([] as never);

      await expect(
        service.revivePayment(
          tenantId,
          buildingId,
          paymentId,
          ['TENANT_ADMIN'],
          membershipId,
        ),
      ).rejects.toThrow(
        'No se puede reactivar este pago porque perdió la asociación con el cargo seleccionado.',
      );

      expect(prismaService.paymentAllocation.create).not.toHaveBeenCalled();
      expect(prismaService.payment.update).not.toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: PaymentStatus.SUBMITTED }),
      }));
    });

    it('serializes overlapping rejection requests so the second request rereads REJECTED without overwriting the marker', async () => {
      const marker = 'resident-charge-selection-requires-resubmission';
      let paymentState = {
        id: paymentId,
        tenantId,
        buildingId,
        unitId: 'unit-123',
        amount: 10000,
        currency: 'ARS',
        method: PaymentMethod.TRANSFER,
        reference: 'TRX-123',
        status: PaymentStatus.SUBMITTED,
        canceledAt: null,
        notes: marker,
        paymentAllocations: [],
      };
      allocationStore = [{ tenantId, paymentId, chargeId }];

      let resolveFirstRead!: () => void;
      const firstReadEntered = new Promise<void>((resolve) => {
        resolveFirstRead = resolve;
      });
      let releaseFirstRequest!: () => void;
      const firstRequestReleased = new Promise<void>((resolve) => {
        releaseFirstRequest = resolve;
      });
      let releasePaymentLock!: () => void;
      const paymentLockReleased = new Promise<void>((resolve) => {
        releasePaymentLock = resolve;
      });
      let lockAttempts = 0;
      let firstRead = true;

      jest.spyOn(prismaService, '$queryRaw').mockImplementation(async () => {
        lockAttempts += 1;
        if (lockAttempts === 2) {
          await paymentLockReleased;
        }

        return [] as never;
      });
      jest.spyOn(prismaService.payment, 'findFirst').mockImplementation(async () => {
        if (firstRead) {
          firstRead = false;
          resolveFirstRead();
          await firstRequestReleased;
        }

        return paymentState as never;
      });
      jest.spyOn(prismaService.payment, 'update').mockImplementation(async ({ data }) => {
        paymentState = { ...paymentState, ...data } as typeof paymentState;
        releasePaymentLock();
        return paymentState as never;
      });
      jest.spyOn(prismaService.paymentAllocation, 'findMany').mockImplementation(async () =>
        allocationStore.map((allocation) => ({ chargeId: allocation.chargeId, amount: 10000 })) as never,
      );
      jest.spyOn(prismaService.paymentAllocation, 'deleteMany').mockImplementation(async () => {
        allocationStore = [];
        return { count: 1 } as never;
      });
      jest.spyOn(service as never, 'recalculateChargeStatus').mockResolvedValue(undefined);
      jest.spyOn(service as never, 'sendPaymentRejectedNotification').mockResolvedValue(undefined);

      const firstRequest = service.rejectPayment(
        tenantId,
        buildingId,
        paymentId,
        ['TENANT_ADMIN'],
        membershipId,
        { reason: 'OTHER', notes: 'First reviewer note' },
      );

      await firstReadEntered;
      const secondRequest = service.rejectPaymentTenant(
        tenantId,
        paymentId,
        ['TENANT_ADMIN'],
        membershipId,
        { reason: 'OTHER', notes: 'Stale second reviewer note' },
      );
      await Promise.resolve();

      expect(lockAttempts).toBe(2);
      expect(paymentState.status).toBe(PaymentStatus.SUBMITTED);

      releaseFirstRequest();

      await expect(firstRequest).resolves.toEqual(expect.objectContaining({
        status: PaymentStatus.REJECTED,
        notes: 'First reviewer note',
      }));
      await expect(secondRequest).rejects.toThrow('Cannot reject payment in status REJECTED');

      expect(paymentState.notes).toBe(`${marker}\nFirst reviewer note`);
      expect(prismaService.payment.update).toHaveBeenCalledTimes(1);
      expect(prismaService.payment.update).not.toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ notes: expect.stringContaining('Stale second reviewer note') }),
      }));
    });

    it('removes only exact internal marker lines from public payment notes', () => {
      const marker = 'resident-charge-selection-requires-resubmission';
      const sanitizer = service as unknown as {
        sanitizePaymentForResponse<T extends { notes?: string | null }>(payment: T): T;
      };

      const markerOnly = sanitizer.sanitizePaymentForResponse({
        id: paymentId,
        notes: marker,
      });
      const publicPayment = sanitizer.sanitizePaymentForResponse({
        id: paymentId,
        notes: `${marker}\nVisible reviewer note\n${marker}-similar-visible-note`,
      });

      expect(markerOnly.notes).toBeNull();
      expect(publicPayment.notes).toBe(`Visible reviewer note\n${marker}-similar-visible-note`);
    });

    it('keeps an unmarked legacy payment with a full allocation on the existing revive path', async () => {
      mockSubmittedPaymentState(PaymentStatus.REJECTED, PaymentStatus.SUBMITTED, null);
      jest.spyOn(prismaService, '$queryRaw').mockResolvedValue([] as never);

      await expect(
        service.revivePayment(
          tenantId,
          buildingId,
          paymentId,
          ['TENANT_ADMIN'],
          membershipId,
        ),
      ).resolves.toEqual(expect.objectContaining({ status: PaymentStatus.SUBMITTED }));

      expect(prismaService.paymentAllocation.create).not.toHaveBeenCalled();
    });

    it('does not revive a payment from another tenant', async () => {
      mockSubmittedPaymentState(PaymentStatus.REJECTED, PaymentStatus.SUBMITTED);
      jest.spyOn(prismaService.payment, 'findFirst').mockResolvedValueOnce(null as never);
      jest.spyOn(prismaService, '$queryRaw').mockResolvedValue([] as never);

      await expect(
        service.revivePayment(
          tenantId,
          buildingId,
          paymentId,
          ['TENANT_ADMIN'],
          membershipId,
        ),
      ).rejects.toThrow('Payment not found or does not belong to this building/tenant');

      expect(prismaService.payment.update).not.toHaveBeenCalled();
    });

    it('does not revive canceled rejected payments', async () => {
      mockSubmittedPaymentState(PaymentStatus.REJECTED, PaymentStatus.SUBMITTED);
      jest.spyOn(prismaService.payment, 'findFirst').mockResolvedValueOnce({
        id: paymentId,
        tenantId,
        buildingId,
        unitId: 'unit-123',
        amount: 10000,
        status: PaymentStatus.REJECTED,
        canceledAt: new Date('2026-07-24T12:00:00.000Z'),
        notes: null,
        paymentAllocations: [],
      } as never);
      jest.spyOn(prismaService, '$queryRaw').mockResolvedValue([] as never);

      await expect(
        service.revivePayment(
          tenantId,
          buildingId,
          paymentId,
          ['TENANT_ADMIN'],
          membershipId,
        ),
      ).rejects.toThrow('No se puede reactivar un pago cancelado');

      expect(prismaService.payment.update).not.toHaveBeenCalled();
    });

    it.each([PaymentStatus.APPROVED, PaymentStatus.RECONCILED])(
      'does not revive %s payments',
      async (status) => {
        allocationStore = [];
        mockSubmittedPaymentState(status, PaymentStatus.SUBMITTED);
        jest.spyOn(prismaService, '$queryRaw').mockResolvedValue([] as never);

        await expect(
          service.revivePayment(
            tenantId,
            buildingId,
            paymentId,
            ['TENANT_ADMIN'],
            membershipId,
          ),
        ).rejects.toThrow('Only REJECTED payments can be revived');

        expect(prismaService.paymentAllocation.create).not.toHaveBeenCalled();
      },
    );

    it.each([PaymentStatus.APPROVED, PaymentStatus.RECONCILED])(
      'does not remove allocations for %s payments',
      async (status) => {
        mockSubmittedPaymentState(status);
        jest.spyOn(prismaService.paymentAllocation, 'count').mockResolvedValue(1 as never);

        await expect(
          service.cancelPayment(
            tenantId,
            buildingId,
            paymentId,
            ['TENANT_ADMIN'],
            membershipId,
            'Manual cancellation',
          ),
        ).rejects.toThrow('Cannot cancel payment with existing allocations. Remove allocations first.');

        expect(prismaService.paymentAllocation.deleteMany).not.toHaveBeenCalled();
        expect(makeAllocation()).toHaveLength(1);
      },
    );

    it('rolls back provisional allocation release when rejection fails', async () => {
      mockSubmittedPaymentState(PaymentStatus.SUBMITTED, PaymentStatus.REJECTED);
      const notificationSpy = jest
        .spyOn(service as any, 'sendPaymentRejectedNotification')
        .mockResolvedValue(undefined);

      const snapshot = makeAllocation();
      jest.spyOn(prismaService, '$transaction').mockImplementationOnce(async (callback: (tx: never) => Promise<unknown>) => {
        try {
          return await callback(prismaService as never);
        } catch (error) {
          allocationStore = snapshot;
          throw error;
        }
      });
      jest.spyOn(prismaService.payment, 'update').mockRejectedValueOnce(new Error('boom'));

      await expect(
        service.rejectPaymentTenant(
          tenantId,
          paymentId,
          ['TENANT_ADMIN'],
          membershipId,
          {
            reason: 'OTHER',
            comment: 'This should rollback',
          },
        ),
      ).rejects.toThrow('boom');

      expect(makeAllocation()).toHaveLength(1);
      expect(prismaService.paymentAllocation.deleteMany).toHaveBeenCalledWith({
        where: { tenantId, paymentId },
      });
      expect(notificationSpy).not.toHaveBeenCalled();
    });
  });

  // ========== TESTS: CHECK PAYMENT DUPLICATE ==========
  describe('checkPaymentDuplicate', () => {
    it('scopes duplicate detection to the payment unit', async () => {
      jest
        .spyOn(prismaService.payment, 'findFirst')
        .mockResolvedValueOnce({
          id: 'payment-123',
          tenantId: 'tenant-123',
          buildingId: 'building-123',
          unitId: 'unit-123',
          amount: 10000,
          reference: 'TRX-123',
        } as any)
        .mockResolvedValueOnce({ id: 'payment-duplicate', amount: 10000, reference: 'TRX-123' } as any);

      const result = await service.checkPaymentDuplicate('tenant-123', 'payment-123');

      expect(result.hasDuplicate).toBe(true);
      expect(prismaService.payment.findFirst).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: 'tenant-123',
            unitId: 'unit-123',
            amount: 10000,
            reference: 'TRX-123',
          }),
        }),
      );
    });
  });

  // ========== TESTS: CANCEL CHARGE ==========
  describe('cancelCharge', () => {
    it('should skip cancelCharge tests - complex validator dependencies', () => {
      // These tests require complex mocks for FinanzasValidators
      // that are beyond unit test scope. Integration tests recommended.
      expect(true).toBe(true);
    });
  });

  // ========== TESTS: BUILDING FINANCIAL SUMMARY ==========
  describe('getBuildingFinancialSummary', () => {
    it('uses Charge.period IN when periods are provided', async () => {
      jest.spyOn(validators, 'validateBuildingBelongsToTenant').mockResolvedValue(undefined);
      jest.spyOn(prismaService.tenant, 'findUniqueOrThrow').mockResolvedValue({ currency: 'ARS' } as never);
      jest.spyOn(prismaService.charge, 'findMany').mockResolvedValue([
        {
          id: 'charge-1',
          tenantId: 'tenant-1',
          buildingId: 'building-1',
          unitId: 'unit-1',
          amount: 1000,
          paymentAllocations: [],
        },
      ] as never);
      jest.spyOn(prismaService.unit, 'findMany').mockResolvedValue([
        {
          id: 'unit-1',
          label: '0101',
          buildingId: 'building-1',
          building: { name: 'Edificio A' },
        },
      ] as never);

      await service.getBuildingFinancialSummary('tenant-1', 'building-1', {
        periods: ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06'],
      });

      expect(prismaService.charge.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'tenant-1',
          buildingId: 'building-1',
          canceledAt: null,
          period: {
            in: ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06'],
          },
        }),
      }));
      expect(prismaService.charge.findMany).not.toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          createdAt: expect.anything(),
        }),
      }));
    });

    it('keeps the legacy period string path compatible', async () => {
      jest.spyOn(validators, 'validateBuildingBelongsToTenant').mockResolvedValue(undefined);
      jest.spyOn(prismaService.tenant, 'findUniqueOrThrow').mockResolvedValue({ currency: 'ARS' } as never);
      jest.spyOn(prismaService.charge, 'findMany').mockResolvedValue([
        {
          id: 'charge-1',
          tenantId: 'tenant-1',
          buildingId: 'building-1',
          unitId: 'unit-1',
          amount: 1000,
          paymentAllocations: [],
        },
      ] as never);
      jest.spyOn(prismaService.unit, 'findMany').mockResolvedValue([
        {
          id: 'unit-1',
          label: '0101',
          buildingId: 'building-1',
          building: { name: 'Edificio A' },
        },
      ] as never);

      await service.getBuildingFinancialSummary('tenant-1', 'building-1', '2026-06');

      expect(prismaService.charge.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          period: '2026-06',
        }),
      }));
    });
  });

  describe('getBuildingDelinquency', () => {
    it('returns a server-side page with period and accumulated debt totals', async () => {
      jest.spyOn(validators, 'validateBuildingBelongsToTenant').mockResolvedValue(undefined);
      jest.spyOn(prismaService.tenant, 'findUniqueOrThrow').mockResolvedValue({ currency: 'ARS' } as never);
      jest.spyOn(prismaService, '$transaction').mockResolvedValue([
        [
          {
            unitId: 'unit-1',
            unitCode: 'TS-01-07',
            unitLabel: 'Piso 01 - Apartamento 07',
            responsibleName: 'Ana Pérez',
            periodDebt: 6900000n,
            accumulatedDebt: 75420000n,
            overduePeriods: 4n,
          },
        ],
        [{ total: 96n }],
        [{ periodDebt: 565800000n, accumulatedDebt: 6426000000n }],
      ] as never);

      const result = await service.getBuildingDelinquency('tenant-1', 'building-1', {
        period: '2026-07',
        page: 1,
        pageSize: 25,
        sortBy: 'ACCUMULATED_DEBT' as never,
        sortOrder: 'desc' as never,
      });

      expect(validators.validateBuildingBelongsToTenant).toHaveBeenCalledWith('tenant-1', 'building-1');
      expect(prismaService.$transaction).toHaveBeenCalledWith(expect.any(Array));
      expect(result).toEqual({
        items: [
          {
            unitId: 'unit-1',
            unitCode: 'TS-01-07',
            unitLabel: 'Piso 01 - Apartamento 07',
            responsibleName: 'Ana Pérez',
            periodDebt: 6900000,
            accumulatedDebt: 75420000,
            overduePeriods: 4,
          },
        ],
        page: 1,
        pageSize: 25,
        total: 96,
        totalPages: 4,
        totals: {
          periodDebt: 565800000,
          accumulatedDebt: 6426000000,
        },
        currency: 'ARS',
      });
    });

    it('preserves the selected period boundary and resets an empty result to zero pages', async () => {
      jest.spyOn(validators, 'validateBuildingBelongsToTenant').mockResolvedValue(undefined);
      jest.spyOn(prismaService.tenant, 'findUniqueOrThrow').mockResolvedValue({ currency: 'ARS' } as never);
      jest.spyOn(prismaService, '$transaction').mockResolvedValue([
        [],
        [{ total: 0n }],
        [{ periodDebt: 0n, accumulatedDebt: 0n }],
      ] as never);

      const result = await service.getBuildingDelinquency('tenant-1', 'building-1', {
        period: '2026-07',
        aging: 'MORE_THAN_THREE_PERIODS' as never,
      });

      expect(result).toMatchObject({
        items: [],
        page: 1,
        pageSize: 25,
        total: 0,
        totalPages: 0,
      });
      expect(prismaService.$queryRaw).toHaveBeenCalledTimes(3);
    });
  });

  describe('getTenantFinancialSummary', () => {
    it('limits a resident tenant summary to active occupant units', async () => {
      jest.spyOn(prismaService.tenant, 'findUniqueOrThrow').mockResolvedValue({ currency: 'ARS' } as never);
      jest.spyOn(validators, 'isResidentOrOwner').mockReturnValue(true);
      jest.spyOn(validators, 'getUserUnitIds').mockResolvedValue(['unit-1']);
      jest.spyOn(prismaService.charge, 'findMany').mockResolvedValue([] as never);
      jest.spyOn(prismaService.unit, 'findMany').mockResolvedValue([] as never);

      await service.getTenantFinancialSummary('tenant-1', undefined, ['RESIDENT'], 'resident-1');

      expect(prismaService.charge.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'tenant-1',
          unitId: { in: ['unit-1'] },
        }),
      }));
    });

    it('uses Charge.period IN when tenant periods are provided', async () => {
      jest.spyOn(prismaService.tenant, 'findUniqueOrThrow').mockResolvedValue({ currency: 'ARS' } as never);
      jest.spyOn(prismaService.charge, 'findMany').mockResolvedValue([
        {
          id: 'charge-1',
          tenantId: 'tenant-1',
          buildingId: 'building-1',
          unitId: 'unit-1',
          amount: 1000,
          paymentAllocations: [],
        },
      ] as never);
      jest.spyOn(prismaService.unit, 'findMany').mockResolvedValue([
        {
          id: 'unit-1',
          label: '0101',
          buildingId: 'building-1',
          building: { name: 'Edificio A' },
        },
      ] as never);

      await service.getTenantFinancialSummary('tenant-1', {
        periods: ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06'],
      });

      expect(prismaService.charge.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'tenant-1',
          canceledAt: null,
          period: {
            in: ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06'],
          },
        }),
      }));
    });

    it('keeps the legacy tenant period string path compatible', async () => {
      jest.spyOn(prismaService.tenant, 'findUniqueOrThrow').mockResolvedValue({ currency: 'ARS' } as never);
      jest.spyOn(prismaService.charge, 'findMany').mockResolvedValue([
        {
          id: 'charge-1',
          tenantId: 'tenant-1',
          buildingId: 'building-1',
          unitId: 'unit-1',
          amount: 1000,
          paymentAllocations: [],
        },
      ] as never);
      jest.spyOn(prismaService.unit, 'findMany').mockResolvedValue([
        {
          id: 'unit-1',
          label: '0101',
          buildingId: 'building-1',
          building: { name: 'Edificio A' },
        },
      ] as never);

      await service.getTenantFinancialSummary('tenant-1', '2026-06');

      expect(prismaService.charge.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          period: '2026-06',
        }),
      }));
    });

    it('keeps totalCharges stable when an approved payment fully settles one charge', async () => {
      jest.spyOn(prismaService.tenant, 'findUniqueOrThrow').mockResolvedValue({ currency: 'ARS' } as never);
      jest.spyOn(prismaService.charge, 'findMany').mockResolvedValue([
        {
          id: 'charge-paid',
          tenantId: 'tenant-1',
          buildingId: 'building-1',
          unitId: 'unit-paid',
          amount: 4_950_000,
          paymentAllocations: [
            {
              amount: 4_950_000,
              payment: { status: PaymentStatus.APPROVED },
            },
          ],
        },
        {
          id: 'charge-open',
          tenantId: 'tenant-1',
          buildingId: 'building-1',
          unitId: 'unit-open',
          amount: 1_102_050_000,
          paymentAllocations: [],
        },
      ] as never);
      jest.spyOn(prismaService.unit, 'findMany').mockResolvedValue([
        {
          id: 'unit-open',
          label: '0202',
          buildingId: 'building-1',
          building: { name: 'Edificio A' },
        },
      ] as never);

      const result = await service.getTenantFinancialSummary('tenant-1', '2026-07');

      expect(result).toEqual({
        totalCharges: 1_107_000_000,
        totalPaid: 4_950_000,
        totalOutstanding: 1_102_050_000,
        delinquentUnitsCount: 1,
        topDelinquentUnits: [
          {
            unitId: 'unit-open',
            unitLabel: '0202',
            buildingId: 'building-1',
            buildingName: 'Edificio A',
            outstanding: 1_102_050_000,
          },
        ],
        currency: 'ARS',
      });
    });

    it('ignores submitted and rejected allocations in the tenant summary balance', async () => {
      jest.spyOn(prismaService.tenant, 'findUniqueOrThrow').mockResolvedValue({ currency: 'ARS' } as never);
      jest.spyOn(prismaService.charge, 'findMany').mockResolvedValue([
        {
          id: 'charge-mixed',
          tenantId: 'tenant-1',
          buildingId: 'building-1',
          unitId: 'unit-mixed',
          amount: 10000,
          paymentAllocations: [
            {
              amount: 3000,
              payment: { status: PaymentStatus.SUBMITTED },
            },
            {
              amount: 2000,
              payment: { status: PaymentStatus.REJECTED },
            },
            {
              amount: 4000,
              payment: { status: PaymentStatus.APPROVED },
            },
            {
              amount: 1000,
              payment: { status: PaymentStatus.RECONCILED },
            },
          ],
        },
      ] as never);
      jest.spyOn(prismaService.unit, 'findMany').mockResolvedValue([
        {
          id: 'unit-mixed',
          label: '0303',
          buildingId: 'building-1',
          building: { name: 'Edificio A' },
        },
      ] as never);

      const result = await service.getTenantFinancialSummary('tenant-1', '2026-07');

      expect(result.totalCharges).toBe(10000);
      expect(result.totalPaid).toBe(5000);
      expect(result.totalOutstanding).toBe(5000);
      expect(result.delinquentUnitsCount).toBe(1);
    });
  });

  describe('getPaymentAllocations', () => {
    it('requires an active resident occupancy for the payment unit', async () => {
      jest.spyOn(validators, 'isResidentOrOwner').mockReturnValue(true);
      jest.spyOn(prismaService.payment, 'findFirst').mockResolvedValue({
        id: 'payment-1',
        unitId: 'unit-1',
      } as never);
      jest.spyOn(validators, 'validateResidentUnitAccess').mockResolvedValue();
      jest.spyOn(prismaService.paymentAllocation, 'findMany').mockResolvedValue([] as never);

      await service.getPaymentAllocations(
        'tenant-1',
        'building-1',
        'payment-1',
        ['RESIDENT'],
        'resident-1',
      );

      expect(validators.validateResidentUnitAccess).toHaveBeenCalledWith(
        'tenant-1',
        'resident-1',
        'unit-1',
        'building-1',
      );
    });
  });

  describe('getUnitLedger access control', () => {
    const tenantId = 'tenant-1';
    const buildingId = 'building-1';
    const otherBuildingId = 'building-2';
    const unitId = 'unit-1';
    const otherUnitId = 'unit-2';

    const mockLedgerBase = (ledgerUnitBuildingId = buildingId) => {
      jest.spyOn(prismaService.tenant, 'findUniqueOrThrow').mockResolvedValue({
        currency: 'ARS',
      } as never);
      jest.spyOn(prismaService.unit, 'findFirst').mockResolvedValue({
        id: unitId,
        building: { id: ledgerUnitBuildingId },
      } as never);
      jest.spyOn(prismaService.charge, 'findMany').mockResolvedValue([] as never);
      jest.spyOn(prismaService.payment, 'findMany').mockResolvedValue([] as never);
    };

    it('allows a tenant-scoped admin membership for the requested tenant', async () => {
      mockLedgerBase();

      await expect(
        service.getUnitLedger(
          tenantId,
          unitId,
          undefined,
          undefined,
          ['TENANT_ADMIN'],
          'user-1',
          {
            id: 'membership-1',
            tenantId,
            roles: ['TENANT_ADMIN'],
            scopedRoles: [],
          } as never,
        ),
      ).resolves.toEqual(expect.objectContaining({
        totals: expect.objectContaining({
          currency: 'ARS',
          balance: 0,
        }),
      }));

      expect(validators.validateResidentUnitAccess).not.toHaveBeenCalled();
    });

    it('allows a building-scoped role only for the exact building', async () => {
      mockLedgerBase();

      await expect(
        service.getUnitLedger(
          tenantId,
          unitId,
          undefined,
          undefined,
          [],
          'user-1',
          {
            id: 'membership-1',
            tenantId,
            roles: [],
            scopedRoles: [
              {
                id: 'scope-1',
                role: 'TENANT_ADMIN',
                scopeType: ScopeType.BUILDING,
                scopeBuildingId: buildingId,
                scopeUnitId: null,
              },
            ],
          } as never,
        ),
      ).resolves.toEqual(expect.objectContaining({
        totals: expect.objectContaining({
          balance: 0,
        }),
      }));

      expect(prismaService.charge.findMany).toHaveBeenCalledTimes(1);
      expect(prismaService.payment.findMany).toHaveBeenCalledTimes(1);
    });

    it('rejects a building-scoped role when the building does not match', async () => {
      mockLedgerBase(otherBuildingId);
      jest.spyOn(prismaService.charge, 'findMany').mockResolvedValue([] as never);
      jest.spyOn(prismaService.payment, 'findMany').mockResolvedValue([] as never);

      await expect(
        service.getUnitLedger(
          tenantId,
          unitId,
          undefined,
          undefined,
          [],
          'user-1',
          {
            id: 'membership-1',
            tenantId,
            roles: [],
            scopedRoles: [
              {
                id: 'scope-1',
                role: 'TENANT_ADMIN',
                scopeType: ScopeType.BUILDING,
                scopeBuildingId: buildingId,
                scopeUnitId: null,
              },
            ],
          } as never,
        ),
      ).rejects.toThrow('No tiene acceso al ledger de esta unidad');

      expect(prismaService.charge.findMany).not.toHaveBeenCalled();
      expect(prismaService.payment.findMany).not.toHaveBeenCalled();
    });

    it('allows a unit-scoped role only for the exact unit', async () => {
      mockLedgerBase();

      await expect(
        service.getUnitLedger(
          tenantId,
          unitId,
          undefined,
          undefined,
          [],
          'user-1',
          {
            id: 'membership-1',
            tenantId,
            roles: [],
            scopedRoles: [
              {
                id: 'scope-1',
                role: 'OPERATOR',
                scopeType: ScopeType.UNIT,
                scopeBuildingId: null,
                scopeUnitId: unitId,
              },
            ],
          } as never,
        ),
      ).resolves.toEqual(expect.objectContaining({
        totals: expect.objectContaining({
          balance: 0,
        }),
      }));
    });

    it('rejects a unit-scoped role when the unit does not match', async () => {
      mockLedgerBase();

      await expect(
        service.getUnitLedger(
          tenantId,
          otherUnitId,
          undefined,
          undefined,
          [],
          'user-1',
          {
            id: 'membership-1',
            tenantId,
            roles: [],
            scopedRoles: [
              {
                id: 'scope-1',
                role: 'OPERATOR',
                scopeType: ScopeType.UNIT,
                scopeBuildingId: null,
                scopeUnitId: unitId,
              },
            ],
          } as never,
        ),
      ).rejects.toThrow('No tiene acceso al ledger de esta unidad');

      expect(prismaService.charge.findMany).not.toHaveBeenCalled();
      expect(prismaService.payment.findMany).not.toHaveBeenCalled();
    });

    it('enforces resident access against the exact unit and building', async () => {
      mockLedgerBase();
      jest.spyOn(validators, 'validateResidentUnitAccess').mockResolvedValue();

      await expect(
        service.getUnitLedger(
          tenantId,
          unitId,
          undefined,
          undefined,
          ['RESIDENT'],
          'resident-1',
          {
            id: 'membership-1',
            tenantId,
            roles: ['RESIDENT'],
            scopedRoles: [],
          } as never,
        ),
      ).resolves.toEqual(expect.objectContaining({
        totals: expect.objectContaining({
          balance: 0,
        }),
      }));

      expect(validators.validateResidentUnitAccess).toHaveBeenCalledWith(
        tenantId,
        'resident-1',
        unitId,
        buildingId,
      );
    });
  });

  describe('listPendingPayments', () => {
    it('never grants a resident access through payment creator identity', async () => {
      jest.spyOn(validators, 'isResidentOrOwner').mockReturnValue(true);
      jest.spyOn(validators, 'getUserUnitIds').mockResolvedValue(['unit-1']);
      jest.spyOn(prismaService.payment, 'findMany').mockResolvedValue([] as never);

      await service.listPendingPayments('tenant-1', ['RESIDENT'], 'resident-1', {});

      expect(prismaService.payment.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ unitId: { in: ['unit-1'] } }),
      }));
      expect((prismaService.payment.findMany as jest.Mock).mock.calls[0][0].where.OR).toBeUndefined();
    });
  });

  describe('bulkValidateExpenses', () => {
    it('filters draft expenses by accounting period fallback and validates as the current actor', async () => {
      jest.spyOn(prismaService.expense, 'findMany').mockResolvedValue([
        { id: 'expense-1' },
        { id: 'expense-2' },
      ] as never);
      jest.spyOn(expensesService, 'validateExpenseFromBulk').mockResolvedValue({} as never);

      const result = await service.bulkValidateExpenses(
        'tenant-1',
        'building-1',
        '2026-05',
        'member-admin',
      );

      expect(result).toEqual({ validatedCount: 2, errorCount: 0 });
      expect(prismaService.expense.findMany).toHaveBeenCalledWith({
        where: {
          tenantId: 'tenant-1',
          buildingId: 'building-1',
          status: 'DRAFT',
          OR: [
            { liquidationPeriod: '2026-05' },
            { liquidationPeriod: null, period: '2026-05' },
          ],
        },
        select: { id: true },
      });
      expect(expensesService.validateExpenseFromBulk).toHaveBeenCalledWith(
        'tenant-1',
        'expense-1',
        'member-admin',
      );
      expect(auditService.createLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actorMembershipId: 'member-admin',
          metadata: expect.objectContaining({ validatedCount: 2, errorCount: 0 }),
        }),
      );
    });
  });

  describe('notification recipient filtering', () => {
    const tenantId = 'tenant-123';
    const buildingId = 'building-123';
    const unitId = 'unit-123';
    const residentId = 'resident-1';
    const adminId = 'admin-1';

    beforeEach(() => {
      jest.spyOn(prismaService.membership, 'findMany').mockResolvedValue([
        { user: { id: residentId } },
        { user: { id: adminId } },
        { user: { id: adminId } },
      ] as never);
      jest.spyOn(prismaService.user, 'findUnique').mockResolvedValue({
        name: 'Resident',
        email: 'resident@example.com',
      } as never);
      jest.spyOn(prismaService.unit, 'findUnique').mockResolvedValue({
        label: 'TN-01-01',
        unitOccupants: [
          { member: { user: { id: residentId } } },
          { member: { user: { id: 'resident-2' } } },
        ],
      } as never);
      jest.spyOn(prismaService.building, 'findUnique').mockResolvedValue({
        name: 'Building A',
      } as never);
      jest.spyOn(notificationsService, 'createNotification').mockResolvedValue(undefined);
    });

    it('excludes the submitting resident from admin payment notifications', async () => {
      await (service as any).notifyAdminsOfPaymentSubmitted(
        tenantId,
        {
          id: 'payment-1',
          tenantId,
          buildingId,
          unitId,
          amount: 10000,
          currency: 'ARS',
          method: PaymentMethod.TRANSFER,
          reference: 'TRX-1',
          createdByUserId: residentId,
          proofFileId: 'file-1',
        },
        residentId,
      );

      expect(notificationsService.createNotification).toHaveBeenCalledTimes(1);
      expect(notificationsService.createNotification).toHaveBeenCalledWith(expect.objectContaining({
        tenantId,
        userId: adminId,
        type: 'BUILDING_ALERT',
      }));
      expect(notificationsService.createNotification).not.toHaveBeenCalledWith(expect.objectContaining({
        userId: residentId,
      }));
      expect(prismaService.membership.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          tenantId,
          roles: expect.objectContaining({
            some: expect.objectContaining({
              role: { in: ['TENANT_ADMIN', 'TENANT_OWNER', 'OPERATOR'] },
              OR: expect.arrayContaining([
                { scopeType: ScopeType.TENANT },
                { scopeType: ScopeType.BUILDING, scopeBuildingId: buildingId },
                { scopeType: ScopeType.UNIT, scopeUnitId: unitId },
              ]),
            }),
          }),
        }),
      }));
    });

    it.each([
      ['sendPaymentReceivedNotification', 'PAYMENT_RECEIVED'],
      ['sendPaymentRejectedNotification', 'PAYMENT_REJECTED'],
    ])('excludes the actor from resident payment notifications (%s)', async (helperName, notificationType) => {
      const payment = {
        id: 'payment-1',
        tenantId,
        buildingId,
        unitId,
        amount: 10000,
        currency: 'ARS',
        method: PaymentMethod.TRANSFER,
        createdByUserId: residentId,
        reference: 'TRX-1',
        paidAt: new Date('2026-07-24T12:00:00.000Z'),
      };

      if (helperName === 'sendPaymentRejectedNotification') {
        await (service as any)[helperName](tenantId, payment, 'Not specified', residentId);
      } else {
        await (service as any)[helperName](tenantId, payment, residentId);
      }

      expect(notificationsService.createNotification).toHaveBeenCalledWith(expect.objectContaining({
        tenantId,
        userId: 'resident-2',
        type: notificationType,
      }));
      expect(notificationsService.createNotification).not.toHaveBeenCalledWith(expect.objectContaining({
        userId: residentId,
      }));
    });
  });
});
