import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import {
  TicketPriority,
  TicketStatus,
  SupportTicketCategory,
  SupportTicketPriority,
  SupportTicketStatus,
  DocumentVisibility,
  DocumentCategory,
  AuditAction,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

interface DemoSeedResult {
  success: boolean;
  summary: {
    buildingsCreated: number;
    unitsCreated: number;
    usersCreated: number;
    occupantsCreated: number;
    ticketsCreated: number;
    supportTicketsCreated: number;
    paymentsCreated: number;
    documentsCreated: number;
  };
}

@Injectable()
export class DemoSeedService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
  ) {}

  /**
   * Check if tenant can generate demo data
   * - Must not have existing buildings (to avoid duplicates)
   * - Returns reason if cannot generate
   */
  async canGenerateDemoData(tenantId: string): Promise<{
    canGenerate: boolean;
    reason?: string;
  }> {
    try {
      // Check if tenant has any buildings
      const buildingCount = await this.prisma.building.count({
        where: { tenantId },
      });

      if (buildingCount > 0) {
        return {
          canGenerate: false,
          reason: 'Tenant already has buildings. Demo data can only be generated once.',
        };
      }

      return { canGenerate: true };
    } catch (err) {
      return {
        canGenerate: false,
        reason: 'Error checking existing data',
      };
    }
  }

  /**
   * Generate realistic demo data for TRIAL tenant
   * Creates buildings, units, users, tickets, support tickets, payments, documents
   */
  async generateDemoData(tenantId: string, userId: string): Promise<DemoSeedResult> {
    const result: DemoSeedResult = {
      success: false,
      summary: {
        buildingsCreated: 0,
        unitsCreated: 0,
        usersCreated: 0,
        occupantsCreated: 0,
        ticketsCreated: 0,
        supportTicketsCreated: 0,
        paymentsCreated: 0,
        documentsCreated: 0,
      },
    };

    try {
      // Check if can generate
      const { canGenerate, reason } = await this.canGenerateDemoData(tenantId);
      if (!canGenerate) {
        throw new ConflictException(reason);
      }

      // Create building
      const building = await this.prisma.building.create({
        data: {
          tenantId,
          name: 'Demo Building - Reforma 123',
          address: 'Reforma 123, Mexico City, Mexico',
        },
      });
      result.summary.buildingsCreated = 1;

      // Create units
      const unitLabels = ['101', '102', '103', '201', '202'];
      const unitTypes = ['APARTMENT', 'APARTMENT', 'APARTMENT', 'PENTHOUSE', 'OFFICE'];
      const occupancyStatuses = ['OCCUPIED', 'VACANT', 'OCCUPIED', 'OCCUPIED', 'OCCUPIED'];

      const units = await Promise.all(
        unitLabels.map((label, idx) =>
          this.prisma.unit.create({
            data: {
              buildingId: building.id,
              code: `CODE-${label}`,
              label,
              unitType: unitTypes[idx],
              occupancyStatus: occupancyStatuses[idx],
            },
          }),
        ),
      );
      result.summary.unitsCreated = units.length;

      // Create demo users
      const demoUsers = [
        { email: 'demo.owner@buildingos.local', name: 'Demo Owner' },
        { email: 'demo.operator@buildingos.local', name: 'Demo Operator' },
        { email: 'demo.admin@buildingos.local', name: 'Demo Admin' },
        { email: 'demo.support@buildingos.local', name: 'Demo Support' },
        { email: 'demo.manager@buildingos.local', name: 'Demo Manager' },
      ];

      const users = await Promise.all(
        demoUsers.map((user) =>
          this.prisma.user.create({
            data: {
              email: `${tenantId}-${user.email}`,
              name: user.name,
              passwordHash: 'demo-hashed-password', // Demo users can't login
            },
          }),
        ),
      );
      result.summary.usersCreated = users.length;

      // Assign occupants to units
      const occupantAssignments = [
        { unitIndex: 0, userIndex: 0, role: 'OWNER' }, // Owner in 101
        { unitIndex: 2, userIndex: 0, role: 'RESIDENT' }, // Also in 103
        { unitIndex: 3, userIndex: 1, role: 'OWNER' }, // Manager in 201
        { unitIndex: 4, userIndex: 2, role: 'OWNER' }, // Admin in 202
      ];

      for (const assignment of occupantAssignments) {
        await this.prisma.unitOccupant.create({
          data: {
            unitId: units[assignment.unitIndex].id,
            userId: users[assignment.userIndex].id,
            role: assignment.role as any,
          },
        });
        result.summary.occupantsCreated++;
      }

      // Create tickets (building maintenance)
      const ticketTitles = [
        'Water leak in bathroom',
        'Paint peeling in living room',
        'Door lock needs replacement',
        'Elevator maintenance required',
        'AC unit not cooling',
        'Plumbing issue in kitchen',
        'Lightbulbs replacement needed',
        'Wall crack inspection',
        'Window seal repair',
        'Floor cleaning schedule',
      ];

      const ticketCategories = ['MAINTENANCE', 'REPAIR', 'CLEANING', 'INSPECTION', 'URGENT_REPAIR'];
      const priorities: TicketPriority[] = ['LOW', 'MEDIUM', 'HIGH'];
      const ticketStatuses: TicketStatus[] = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];

      const tickets = await Promise.all(
        ticketTitles.map((title, idx) =>
          this.prisma.ticket.create({
            data: {
              tenantId,
              buildingId: building.id,
              unitId: units[idx % units.length].id,
              createdByUserId: users[idx % users.length].id,
              assignedToMembershipId: null,
              title,
              description: `Demo ticket: ${title}. This is sample data for exploring the system.`,
              category: ticketCategories[idx % ticketCategories.length],
              priority: priorities[idx % priorities.length],
              status: ticketStatuses[idx % ticketStatuses.length],
              createdAt: new Date(Date.now() - idx * 86400000), // Staggered dates
              updatedAt: new Date(Date.now() - idx * 86400000),
            },
          }),
        ),
      );
      result.summary.ticketsCreated = tickets.length;

      // Create support tickets
      const supportTicketTitles = [
        'How to manage multiple buildings?',
        'Feature request: bulk operations',
        'Issue with payment processing',
        'Can we customize the branding?',
        'Training for new team members',
      ];

      const supportCategories: SupportTicketCategory[] = [
        'FEATURE_REQUEST',
        'BUG_REPORT',
        'BILLING',
        'TECHNICAL_SUPPORT',
      ];
      const supportPriorities: SupportTicketPriority[] = ['LOW', 'MEDIUM', 'HIGH'];
      const supportStatuses: SupportTicketStatus[] = ['OPEN', 'IN_PROGRESS', 'RESOLVED'];

      const supportTickets = await Promise.all(
        supportTicketTitles.map((title, idx) =>
          this.prisma.supportTicket.create({
            data: {
              tenantId,
              createdByUserId: users[idx % users.length].id,
              assignedToUserId: null,
              title,
              description: `Demo support ticket: ${title}. This is sample data for exploring the system.`,
              category: supportCategories[idx % supportCategories.length],
              priority: supportPriorities[idx % supportPriorities.length],
              status: supportStatuses[idx % supportStatuses.length],
              createdAt: new Date(Date.now() - idx * 86400000),
              updatedAt: new Date(Date.now() - idx * 86400000),
            },
          }),
        ),
      );
      result.summary.supportTicketsCreated = supportTickets.length;

      // Create payments (demo)
      const payments = await Promise.all([
        this.prisma.payment.create({
          data: {
            tenantId,
            buildingId: building.id,
            createdByUserId: users[0].id,
            reviewedByMembershipId: null,
            amount: 500000, // In cents: 5000
            method: 'TRANSFER',
            status: 'APPROVED',
            reference: 'DEMO-PAY-001',
            paidAt: new Date(Date.now() - 86400000),
          },
        }),
        this.prisma.payment.create({
          data: {
            tenantId,
            buildingId: building.id,
            createdByUserId: users[1].id,
            reviewedByMembershipId: null,
            amount: 250000, // In cents: 2500
            method: 'ONLINE',
            status: 'SUBMITTED',
            reference: 'DEMO-PAY-002',
          },
        }),
      ]);
      result.summary.paymentsCreated = payments.length;

      // Create documents
      const documentTitles = [
        'Building Regulations and Rules',
        'Insurance Certificate 2026',
        'Maintenance Schedule',
      ];

      const documentCategories: DocumentCategory[] = ['RULES', 'CONTRACT', 'BUDGET'];

      const documents = await Promise.all(
        documentTitles.map((title, idx) =>
          this.prisma.document.create({
            data: {
              tenantId,
              buildingId: building.id,
              createdByMembershipId: 'demo-membership-id',
              title,
              category: documentCategories[idx % documentCategories.length],
              visibility: 'RESIDENTS' as DocumentVisibility,
              fileId: `demo-file-${idx}`,
            },
          }),
        ),
      );
      result.summary.documentsCreated = documents.length;

      // Success: Audit the seed operation
      await this.auditService.createLog({
        tenantId,
        action: 'DEMO_SEED_CREATED' as AuditAction,
        entityType: 'Tenant',
        entityId: tenantId,
        actorUserId: userId,
        metadata: result.summary,
      });

      result.success = true;
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate demo data';
      console.error('[DemoSeedService] Error:', message);
      throw err;
    }
  }
}
