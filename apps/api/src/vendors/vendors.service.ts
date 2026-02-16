import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { VendorsValidators } from './vendors.validators';
import { CreateVendorDto } from './dto/create-vendor.dto';
import { UpdateVendorDto } from './dto/update-vendor.dto';

/**
 * VendorsService: Business logic for vendor management
 *
 * Responsibilities:
 * 1. CRUD operations for vendors, quotes, work orders
 * 2. Scope validation via VendorsValidators
 * 3. Consistent error handling (404 for cross-tenant access)
 * 4. Business rule enforcement (state machines, transitions)
 */
@Injectable()
export class VendorsService {
  constructor(
    private prisma: PrismaService,
    private validators: VendorsValidators,
  ) {}

  // ============================================================================
  // VENDORS CRUD
  // ============================================================================

  /**
   * List all vendors for a tenant
   * Validates: none (tenant-level operation)
   */
  async listVendors(tenantId: string) {
    return await this.prisma.vendor.findMany({
      where: { tenantId },
      include: {
        assignments: {
          include: {
            building: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get a single vendor by ID
   * Validates: vendor belongs to tenant (404 if not)
   */
  async getVendor(tenantId: string, vendorId: string) {
    // Validate vendor belongs to tenant
    await this.validators.validateVendorBelongsToTenant(tenantId, vendorId);

    return await this.prisma.vendor.findUnique({
      where: { id: vendorId },
      include: {
        assignments: {
          include: {
            building: true,
          },
        },
        quotes: {
          include: {
            vendor: true,
            building: true,
            ticket: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        workOrders: {
          include: {
            building: true,
            ticket: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });
  }

  /**
   * Create a new vendor
   * Validates: none required
   */
  async createVendor(tenantId: string, dto: CreateVendorDto) {
    // Check for duplicate name in tenant
    const existing = await this.prisma.vendor.findFirst({
      where: {
        tenantId,
        name: dto.name,
      },
    });

    if (existing) {
      throw new BadRequestException(
        `Vendor with name "${dto.name}" already exists in this tenant`,
      );
    }

    return await this.prisma.vendor.create({
      data: {
        tenantId,
        name: dto.name,
        taxId: dto.taxId,
        email: dto.email,
        phone: dto.phone,
        notes: dto.notes,
      },
    });
  }

  /**
   * Update a vendor
   * Validates: vendor belongs to tenant (404 if not)
   */
  async updateVendor(tenantId: string, vendorId: string, dto: UpdateVendorDto) {
    // Validate vendor belongs to tenant
    await this.validators.validateVendorBelongsToTenant(tenantId, vendorId);

    // Check for duplicate name if changing it
    if (dto.name) {
      const existing = await this.prisma.vendor.findFirst({
        where: {
          tenantId,
          name: dto.name,
          id: { not: vendorId },
        },
      });

      if (existing) {
        throw new BadRequestException(
          `Another vendor with name "${dto.name}" already exists`,
        );
      }
    }

    return await this.prisma.vendor.update({
      where: { id: vendorId },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.taxId !== undefined && { taxId: dto.taxId }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
    });
  }

  /**
   * Delete a vendor
   * Validates: vendor belongs to tenant (404 if not)
   * NOTE: Prisma will prevent deletion if vendor has quotes or assignments (RESTRICT constraint)
   */
  async deleteVendor(tenantId: string, vendorId: string) {
    // Validate vendor belongs to tenant
    await this.validators.validateVendorBelongsToTenant(tenantId, vendorId);

    // Try to delete (will fail with constraint error if vendor has quotes/assignments)
    try {
      return await this.prisma.vendor.delete({
        where: { id: vendorId },
      });
    } catch (error: any) {
      if (error.code === 'P2014') {
        // Foreign key constraint error
        throw new BadRequestException(
          `Cannot delete vendor: it has associated quotes or assignments. Delete those first.`,
        );
      }
      throw error;
    }
  }

  // ============================================================================
  // VENDOR ASSIGNMENTS CRUD
  // ============================================================================

  /**
   * List all vendor assignments for a building
   * Validates: building belongs to tenant
   */
  async listVendorAssignments(tenantId: string, buildingId: string) {
    // Validate building
    await this.validators.validateBuildingBelongsToTenant(tenantId, buildingId);

    return await this.prisma.vendorAssignment.findMany({
      where: { tenantId, buildingId },
      include: {
        vendor: true,
        building: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get a single vendor assignment
   * Validates: assignment belongs to tenant (404 if not)
   */
  async getVendorAssignment(tenantId: string, assignmentId: string) {
    // Validate assignment
    await this.validators.validateVendorAssignmentBelongsToTenant(
      tenantId,
      assignmentId,
    );

    return await this.prisma.vendorAssignment.findUnique({
      where: { id: assignmentId },
      include: {
        vendor: true,
        building: true,
      },
    });
  }

  /**
   * Create a vendor assignment
   * Validates: vendor and building belong to tenant
   */
  async createVendorAssignment(
    tenantId: string,
    buildingId: string,
    vendorId: string,
    serviceType: string,
  ) {
    // Validate vendor and building
    await this.validators.validateVendorAndBuildingBelongToTenant(
      tenantId,
      vendorId,
      buildingId,
    );

    // Check for duplicate assignment
    const existing = await this.prisma.vendorAssignment.findFirst({
      where: {
        vendorId,
        buildingId,
        serviceType,
      },
    });

    if (existing) {
      throw new BadRequestException(
        `This vendor is already assigned to this building for ${serviceType} service`,
      );
    }

    return await this.prisma.vendorAssignment.create({
      data: {
        tenantId,
        vendorId,
        buildingId,
        serviceType,
      },
      include: {
        vendor: true,
        building: true,
      },
    });
  }

  /**
   * Delete a vendor assignment
   * Validates: assignment belongs to tenant (404 if not)
   */
  async deleteVendorAssignment(tenantId: string, assignmentId: string) {
    // Validate assignment
    await this.validators.validateVendorAssignmentBelongsToTenant(
      tenantId,
      assignmentId,
    );

    return await this.prisma.vendorAssignment.delete({
      where: { id: assignmentId },
      include: {
        vendor: true,
        building: true,
      },
    });
  }

  // ============================================================================
  // QUOTES CRUD (scope validation included)
  // ============================================================================

  /**
   * List all quotes for a building
   * Validates: building belongs to tenant
   */
  async listQuotes(
    tenantId: string,
    buildingId: string,
  ) {
    // Validate building
    await this.validators.validateBuildingBelongsToTenant(tenantId, buildingId);

    return await this.prisma.quote.findMany({
      where: {
        tenantId,
        buildingId,
      },
      include: {
        vendor: true,
        ticket: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get a single quote
   * Validates: quote and associated ticket belong to tenant/building (404 if not)
   */
  async getQuote(tenantId: string, buildingId: string, quoteId: string) {
    // Validate quote scope
    await this.validators.validateQuoteScope(tenantId, buildingId, quoteId);

    return await this.prisma.quote.findUnique({
      where: { id: quoteId },
      include: {
        vendor: true,
        building: true,
        ticket: true,
        file: true,
      },
    });
  }

  // ============================================================================
  // WORK ORDERS CRUD (scope validation included)
  // ============================================================================

  /**
   * List all work orders for a building
   * Validates: building belongs to tenant
   */
  async listWorkOrders(
    tenantId: string,
    buildingId: string,
  ) {
    // Validate building
    await this.validators.validateBuildingBelongsToTenant(tenantId, buildingId);

    return await this.prisma.workOrder.findMany({
      where: {
        tenantId,
        buildingId,
      },
      include: {
        vendor: true,
        ticket: true,
        assignedTo: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get a single work order
   * Validates: work order and associated ticket belong to tenant/building (404 if not)
   */
  async getWorkOrder(tenantId: string, buildingId: string, workOrderId: string) {
    // Validate work order scope
    await this.validators.validateWorkOrderScope(tenantId, buildingId, workOrderId);

    return await this.prisma.workOrder.findUnique({
      where: { id: workOrderId },
      include: {
        vendor: true,
        building: true,
        ticket: true,
        assignedTo: true,
      },
    });
  }
}
