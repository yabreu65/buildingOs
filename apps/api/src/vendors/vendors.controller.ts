import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  Request,
  Query,
  ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BuildingAccessGuard } from '../tenancy/building-access.guard';
import { VendorsService } from './vendors.service';
import { VendorsValidators } from './vendors.validators';
import { CreateVendorDto, UpdateVendorDto } from './dto';

/**
 * VendorsController: Vendors, Quotes, and WorkOrders management
 *
 * Routes:
 * - /vendors (tenant-level: list all vendors in tenant)
 * - /buildings/:buildingId/vendors/* (building-scoped routes)
 *
 * Security:
 * 1. JwtAuthGuard: Requires valid JWT token
 * 2. BuildingAccessGuard: Validates building belongs to user's tenant (for building-scoped routes)
 *    - Populates req.tenantId automatically
 * 3. Service layer validates vendor/building/quote/workorder scope
 * 4. RBAC: Permissions checked before operations (vendors.read, vendors.write, etc.)
 *
 * Validation Flow:
 * 1. JWT validated (JwtAuthGuard)
 * 2. Building found and user has membership (BuildingAccessGuard) [for building-scoped routes]
 * 3. User roles checked for permission (vendors.read/write, etc.)
 * 4. Scope validation in service (vendor/quote/workorder belongs to tenant)
 * 5. Returns 404 for cross-tenant access, 403 for permission denied
 *
 * RBAC Rules:
 * - vendors.read: list/view vendors (TENANT_ADMIN, TENANT_OWNER)
 * - vendors.write: create/update/delete vendors (TENANT_ADMIN only)
 * - quotes.read: list/view quotes (TENANT_ADMIN, OPERATOR, TENANT_OWNER)
 * - quotes.write: create/update quotes (TENANT_ADMIN, OPERATOR)
 * - quotes.approve: approve/reject quotes (TENANT_ADMIN, TENANT_OWNER)
 * - workorders.read: list/view work orders (TENANT_ADMIN, OPERATOR, TENANT_OWNER)
 * - workorders.write: create/update work orders (TENANT_ADMIN, OPERATOR)
 * - workorders.execute: change status (TENANT_ADMIN, OPERATOR)
 */

@Controller()
@UseGuards(JwtAuthGuard)
export class VendorsController {
  constructor(
    private vendorsService: VendorsService,
    private validators: VendorsValidators,
  ) {}

  // ============================================================================
  // TENANT-LEVEL VENDORS (Read-only from tenant dashboard)
  // ============================================================================

  /**
   * GET /vendors
   * List all vendors in the tenant
   * Permission: vendors.read
   */
  @Get('vendors')
  async listVendors(@Request() req: any) {
    const tenantId = req.user.tenantId; // From JWT context
    const userRoles = req.user.roles || [];

    // Check permission
    if (!this.validators.canAccessVendors(userRoles, 'read')) {
      this.validators.throwForbidden('vendors', 'view');
    }

    return await this.vendorsService.listVendors(tenantId);
  }

  /**
   * GET /vendors/:vendorId
   * Get a single vendor
   * Permission: vendors.read
   */
  @Get('vendors/:vendorId')
  async getVendor(@Param('vendorId') vendorId: string, @Request() req: any) {
    const tenantId = req.user.tenantId;
    const userRoles = req.user.roles || [];

    // Check permission
    if (!this.validators.canAccessVendors(userRoles, 'read')) {
      this.validators.throwForbidden('vendors', 'view');
    }

    return await this.vendorsService.getVendor(tenantId, vendorId);
  }

  /**
   * POST /vendors
   * Create a new vendor
   * Permission: vendors.write (TENANT_ADMIN only)
   */
  @Post('vendors')
  async createVendor(
    @Body() dto: CreateVendorDto,
    @Request() req: any,
  ) {
    const tenantId = req.user.tenantId;
    const userRoles = req.user.roles || [];

    // Check permission
    if (!this.validators.canAccessVendors(userRoles, 'write')) {
      this.validators.throwForbidden('vendors', 'create');
    }

    return await this.vendorsService.createVendor(tenantId, dto);
  }

  /**
   * PATCH /vendors/:vendorId
   * Update a vendor
   * Permission: vendors.write
   */
  @Patch('vendors/:vendorId')
  async updateVendor(
    @Param('vendorId') vendorId: string,
    @Body() dto: UpdateVendorDto,
    @Request() req: any,
  ) {
    const tenantId = req.user.tenantId;
    const userRoles = req.user.roles || [];

    // Check permission
    if (!this.validators.canAccessVendors(userRoles, 'write')) {
      this.validators.throwForbidden('vendors', 'update');
    }

    return await this.vendorsService.updateVendor(tenantId, vendorId, dto);
  }

  /**
   * DELETE /vendors/:vendorId
   * Delete a vendor
   * Permission: vendors.write
   */
  @Delete('vendors/:vendorId')
  async deleteVendor(@Param('vendorId') vendorId: string, @Request() req: any) {
    const tenantId = req.user.tenantId;
    const userRoles = req.user.roles || [];

    // Check permission
    if (!this.validators.canAccessVendors(userRoles, 'write')) {
      this.validators.throwForbidden('vendors', 'delete');
    }

    return await this.vendorsService.deleteVendor(tenantId, vendorId);
  }

  // ============================================================================
  // BUILDING-SCOPED ROUTES (Vendor Assignments, Quotes, WorkOrders)
  // ============================================================================

  /**
   * GET /buildings/:buildingId/vendors/assignments
   * List vendor assignments for a building
   * Permission: vendors.read
   */
  @Get('buildings/:buildingId/vendors/assignments')
  @UseGuards(BuildingAccessGuard)
  async listVendorAssignments(
    @Param('buildingId') buildingId: string,
    @Request() req: any,
  ) {
    const tenantId = req.tenantId; // From BuildingAccessGuard
    const userRoles = req.user.roles || [];

    // Check permission
    if (!this.validators.canAccessVendors(userRoles, 'read')) {
      this.validators.throwForbidden('vendor assignments', 'view');
    }

    return await this.vendorsService.listVendorAssignments(tenantId, buildingId);
  }

  /**
   * GET /buildings/:buildingId/vendors/assignments/:assignmentId
   * Get a single vendor assignment
   * Permission: vendors.read
   */
  @Get('buildings/:buildingId/vendors/assignments/:assignmentId')
  @UseGuards(BuildingAccessGuard)
  async getVendorAssignment(
    @Param('buildingId') buildingId: string,
    @Param('assignmentId') assignmentId: string,
    @Request() req: any,
  ) {
    const tenantId = req.tenantId;
    const userRoles = req.user.roles || [];

    // Check permission
    if (!this.validators.canAccessVendors(userRoles, 'read')) {
      this.validators.throwForbidden('vendor assignments', 'view');
    }

    return await this.vendorsService.getVendorAssignment(tenantId, assignmentId);
  }

  /**
   * POST /buildings/:buildingId/vendors/assignments
   * Create a vendor assignment
   * Permission: vendors.write
   *
   * Body: { vendorId, serviceType }
   */
  @Post('buildings/:buildingId/vendors/assignments')
  @UseGuards(BuildingAccessGuard)
  async createVendorAssignment(
    @Param('buildingId') buildingId: string,
    @Body() dto: { vendorId: string; serviceType: string },
    @Request() req: any,
  ) {
    const tenantId = req.tenantId;
    const userRoles = req.user.roles || [];

    // Check permission
    if (!this.validators.canAccessVendors(userRoles, 'write')) {
      this.validators.throwForbidden('vendor assignments', 'create');
    }

    return await this.vendorsService.createVendorAssignment(
      tenantId,
      buildingId,
      dto.vendorId,
      dto.serviceType,
    );
  }

  /**
   * DELETE /buildings/:buildingId/vendors/assignments/:assignmentId
   * Delete a vendor assignment
   * Permission: vendors.write
   */
  @Delete('buildings/:buildingId/vendors/assignments/:assignmentId')
  @UseGuards(BuildingAccessGuard)
  async deleteVendorAssignment(
    @Param('buildingId') buildingId: string,
    @Param('assignmentId') assignmentId: string,
    @Request() req: any,
  ) {
    const tenantId = req.tenantId;
    const userRoles = req.user.roles || [];

    // Check permission
    if (!this.validators.canAccessVendors(userRoles, 'write')) {
      this.validators.throwForbidden('vendor assignments', 'delete');
    }

    return await this.vendorsService.deleteVendorAssignment(tenantId, assignmentId);
  }

  // ============================================================================
  // QUOTES
  // ============================================================================

  /**
   * GET /buildings/:buildingId/quotes
   * List all quotes for a building
   * Permission: quotes.read
   */
  @Get('buildings/:buildingId/quotes')
  @UseGuards(BuildingAccessGuard)
  async listQuotes(
    @Param('buildingId') buildingId: string,
    @Request() req?: any,
  ) {
    const tenantId = req.tenantId;
    const userRoles = req.user.roles || [];

    // Check permission
    if (!this.validators.canManageQuotes(userRoles, 'read')) {
      this.validators.throwForbidden('quotes', 'view');
    }

    return await this.vendorsService.listQuotes(tenantId, buildingId);
  }

  /**
   * GET /buildings/:buildingId/quotes/:quoteId
   * Get a single quote
   * Permission: quotes.read
   */
  @Get('buildings/:buildingId/quotes/:quoteId')
  @UseGuards(BuildingAccessGuard)
  async getQuote(
    @Param('buildingId') buildingId: string,
    @Param('quoteId') quoteId: string,
    @Request() req: any,
  ) {
    const tenantId = req.tenantId;
    const userRoles = req.user.roles || [];

    // Check permission
    if (!this.validators.canManageQuotes(userRoles, 'read')) {
      this.validators.throwForbidden('quotes', 'view');
    }

    return await this.vendorsService.getQuote(tenantId, buildingId, quoteId);
  }

  /**
   * POST /buildings/:buildingId/quotes
   * Create a new quote
   * Permission: quotes.write
   *
   * Body: { vendorId, ticketId?, amount, currency?, status?, fileId?, notes? }
   */
  @Post('buildings/:buildingId/quotes')
  @UseGuards(BuildingAccessGuard)
  async createQuote(
    @Param('buildingId') buildingId: string,
    @Body() dto: { vendorId: string; ticketId?: string; amount: number; currency?: string; status?: string; fileId?: string; notes?: string },
    @Request() req: any,
  ) {
    const tenantId = req.tenantId;
    const userRoles = req.user.roles || [];

    // Check permission
    if (!this.validators.canManageQuotes(userRoles, 'write')) {
      this.validators.throwForbidden('quotes', 'create');
    }

    return await this.vendorsService.createQuote(tenantId, buildingId, dto);
  }

  /**
   * PATCH /buildings/:buildingId/quotes/:quoteId
   * Update a quote
   * Permission: quotes.write (for status/amount changes)
   * Permission: quotes.approve (for approval status)
   *
   * Body: { vendorId?, amount?, currency?, status?, fileId?, notes? }
   */
  @Patch('buildings/:buildingId/quotes/:quoteId')
  @UseGuards(BuildingAccessGuard)
  async updateQuote(
    @Param('buildingId') buildingId: string,
    @Param('quoteId') quoteId: string,
    @Body() dto: { vendorId?: string; amount?: number; currency?: string; status?: string; fileId?: string | null; notes?: string | null },
    @Request() req: any,
  ) {
    const tenantId = req.tenantId;
    const userRoles = req.user.roles || [];

    // For approval status, check quotes.approve permission
    if (dto.status && ['APPROVED', 'REJECTED'].includes(dto.status)) {
      if (!this.validators.canManageQuotes(userRoles, 'approve')) {
        this.validators.throwForbidden('quotes', 'approve');
      }
    } else {
      // For other updates, check quotes.write
      if (!this.validators.canManageQuotes(userRoles, 'write')) {
        this.validators.throwForbidden('quotes', 'update');
      }
    }

    return await this.vendorsService.updateQuote(tenantId, buildingId, quoteId, dto);
  }

  // ============================================================================
  // WORK ORDERS
  // ============================================================================

  /**
   * POST /buildings/:buildingId/work-orders
   * Create a new work order
   * Permission: workorders.write
   *
   * Body: { ticketId?, vendorId?, assignedToMembershipId?, description?, scheduledFor? }
   */
  @Post('buildings/:buildingId/work-orders')
  @UseGuards(BuildingAccessGuard)
  async createWorkOrder(
    @Param('buildingId') buildingId: string,
    @Body() dto: { ticketId?: string; vendorId?: string; assignedToMembershipId?: string; description?: string; scheduledFor?: string },
    @Request() req: any,
  ) {
    const tenantId = req.tenantId;
    const userRoles = req.user.roles || [];

    // Check permission
    if (!this.validators.canManageWorkOrders(userRoles, 'write')) {
      this.validators.throwForbidden('work orders', 'create');
    }

    return await this.vendorsService.createWorkOrder(tenantId, buildingId, {
      ...dto,
      scheduledFor: dto.scheduledFor ? new Date(dto.scheduledFor) : undefined,
    });
  }

  /**
   * GET /buildings/:buildingId/work-orders
   * List all work orders for a building
   * Permission: workorders.read
   */
  @Get('buildings/:buildingId/work-orders')
  @UseGuards(BuildingAccessGuard)
  async listWorkOrders(
    @Param('buildingId') buildingId: string,
    @Request() req?: any,
  ) {
    const tenantId = req.tenantId;
    const userRoles = req.user.roles || [];

    // Check permission
    if (!this.validators.canManageWorkOrders(userRoles, 'read')) {
      this.validators.throwForbidden('work orders', 'view');
    }

    return await this.vendorsService.listWorkOrders(tenantId, buildingId);
  }

  /**
   * GET /buildings/:buildingId/work-orders/:workOrderId
   * Get a single work order
   * Permission: workorders.read
   */
  @Get('buildings/:buildingId/work-orders/:workOrderId')
  @UseGuards(BuildingAccessGuard)
  async getWorkOrder(
    @Param('buildingId') buildingId: string,
    @Param('workOrderId') workOrderId: string,
    @Request() req: any,
  ) {
    const tenantId = req.tenantId;
    const userRoles = req.user.roles || [];

    // Check permission
    if (!this.validators.canManageWorkOrders(userRoles, 'read')) {
      this.validators.throwForbidden('work orders', 'view');
    }

    return await this.vendorsService.getWorkOrder(tenantId, buildingId, workOrderId);
  }

  /**
   * PATCH /buildings/:buildingId/work-orders/:workOrderId
   * Update a work order
   * Permission: workorders.write (for regular updates)
   * Permission: workorders.execute (for status changes)
   *
   * Body: { status?, vendorId?, assignedToMembershipId?, description?, scheduledFor? }
   */
  @Patch('buildings/:buildingId/work-orders/:workOrderId')
  @UseGuards(BuildingAccessGuard)
  async updateWorkOrder(
    @Param('buildingId') buildingId: string,
    @Param('workOrderId') workOrderId: string,
    @Body() dto: { status?: string; vendorId?: string | null; assignedToMembershipId?: string | null; description?: string; scheduledFor?: string | null },
    @Request() req: any,
  ) {
    const tenantId = req.tenantId;
    const userRoles = req.user.roles || [];

    // For status changes, check execute permission
    if (dto.status) {
      if (!this.validators.canManageWorkOrders(userRoles, 'execute')) {
        this.validators.throwForbidden('work orders', 'change status');
      }
    } else {
      // For other updates, check write
      if (!this.validators.canManageWorkOrders(userRoles, 'write')) {
        this.validators.throwForbidden('work orders', 'update');
      }
    }

    return await this.vendorsService.updateWorkOrder(tenantId, buildingId, workOrderId, {
      ...dto,
      scheduledFor: dto.scheduledFor ? new Date(dto.scheduledFor) : undefined,
    });
  }
}
