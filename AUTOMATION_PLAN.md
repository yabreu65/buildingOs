# BuildingOS Automation Plan: 15 Automations in 14 Days

**Status:** Ready to execute
**Start Date:** [Today]
**End Date:** [Today + 14 days]
**Owner:** Development Team
**Reviewers:** Product, QA

---

## Executive Summary

This plan implements 15 automation features to reduce administrative workload by ~70% across finance, communications, tickets, and operations. Infrastructure is already in place (ScheduleModule, NotificationsService, AuditService); most work is integration/wiring existing systems.

**Outcome:** Admins move from "clickety-click for everything" to "system runs, admin handles exceptions only."

---

## 📅 Weekly Timeline

```
WEEK 1 (Days 1-7): Infrastructure + Quick Wins
├─ Days 1-2: Core scheduling infrastructure
├─ Days 2-5: 7 notification injections + audit logging
└─ Days 5-7: Testing + PR#1 merge

WEEK 2 (Days 8-14): Medium + Hard Features
├─ Days 6-8: 5 cron jobs (overdue, reminders, periods, escalation, bulk validation)
├─ Days 9-12: 3 hard features (import, recurring, email reports)
└─ Day 14: Final testing + deployment
```

---

## 🏗️ PHASE 1: INFRASTRUCTURE (Days 1-2, ~10 hours)

### Day 1.1: Create CronJobsService

**Purpose:** Centralize ALL cron jobs in one injectable service to avoid scattered `@Cron` decorators.

**Files to Create:**
- `apps/api/src/shared/scheduling/cron-jobs.service.ts` (NEW)
- `apps/api/src/shared/scheduling/cron-jobs.module.ts` (NEW)

**Files to Modify:**
- `apps/api/src/app.module.ts` (import CronJobsModule as @Global())

**Implementation Detail:**

```typescript
// apps/api/src/shared/scheduling/cron-jobs.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CommunicationsService } from '@/communications/communications.service';
import { FinanzasService } from '@/finanzas/finanzas.service';
import { TicketsService } from '@/tickets/tickets.service';

@Injectable()
export class CronJobsService {
  private readonly logger = new Logger(CronJobsService.name);
  private readonly maxRetries = 3;

  constructor(
    private communicationsService: CommunicationsService,
    private finanzasService: FinanzasService,
    private ticketsService: TicketsService,
  ) {}

  /**
   * Safe wrapper for all cron jobs
   * - Logs start/end/duration
   * - Catches errors without failing (fire-and-forget pattern)
   * - Returns success count or error details
   */
  private async runWithErrorHandling<T>(
    jobName: string,
    fn: () => Promise<T>,
  ): Promise<{ success: boolean; data?: T; error?: string; durationMs: number }> {
    const startTime = Date.now();
    try {
      this.logger.log(`[CRON] Starting: ${jobName}`);
      const result = await fn();
      const durationMs = Date.now() - startTime;
      this.logger.log(`[CRON] Completed: ${jobName} in ${durationMs}ms`);
      return { success: true, data: result, durationMs };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[CRON] Failed: ${jobName} after ${durationMs}ms — ${errorMsg}`,
        error instanceof Error ? error.stack : '',
      );
      // Fire-and-forget: log but don't throw
      return { success: false, error: errorMsg, durationMs };
    }
  }

  // =========================================================================
  // CRON JOBS (inherit this for all future jobs)
  // =========================================================================

  /**
   * Every 5 minutes: Dispatch SCHEDULED communications
   * Fixes broken feature where scheduled comms never send
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async dispatchScheduledCommunications() {
    return this.runWithErrorHandling('dispatchScheduledCommunications', async () => {
      const count = await this.communicationsService.dispatchScheduledCommunications();
      return { dispatchedCount: count };
    });
  }

  // TODO: Add remaining 14 cron jobs here (see sections below)
}
```

**Files to Create:**

```typescript
// apps/api/src/shared/scheduling/cron-jobs.module.ts

import { Module, Global } from '@nestjs/common';
import { CronJobsService } from './cron-jobs.service';

@Global()
@Module({
  providers: [CronJobsService],
  exports: [CronJobsService],
})
export class CronJobsModule {}
```

**Modify `app.module.ts`:**

```typescript
import { ScheduleModule } from '@nestjs/schedule';
import { CronJobsModule } from '@/shared/scheduling/cron-jobs.module';

@Module({
  imports: [
    ScheduleModule.forRoot(), // ✅ Already loaded
    CronJobsModule,          // ✅ Add this
    // ... rest
  ],
})
export class AppModule {}
```

**Tests:**
- [ ] Verify service loads on app startup
- [ ] No TypeScript errors
- [ ] `npm run build` passes

**Effort:** 2 hours
**Status:** ⬜ Pending

---

### Day 1.2: Create Notification Template System (optional enhancement)

**Purpose:** Standardize notification payloads and email templates.

**Files to Create:**
- `apps/api/src/notifications/notification-templates.ts` (NEW)

**Why:** Ensures consistency across 15 features, makes template updates easier later.

```typescript
// apps/api/src/notifications/notification-templates.ts

export const NotificationTemplates = {
  CHARGE_PUBLISHED: {
    title: 'Nuevo cargo registrado',
    emailSubject: '{{buildingName}} - Cargo por {{period}}',
    emailTemplate: `
      <p>Hola {{residentName}},</p>
      <p>Se ha registrado un nuevo cargo en tu unidad <strong>{{unitLabel}}</strong>:</p>
      <ul>
        <li><strong>Monto:</strong> {{amount}} {{currency}}</li>
        <li><strong>Período:</strong> {{period}}</li>
        <li><strong>Vencimiento:</strong> {{dueDate}}</li>
      </ul>
      <p><a href="{{appUrl}}/finanzas">Ver detalles en BuildingOS</a></p>
    `,
  },
  PAYMENT_RECEIVED: {
    title: 'Pago aprobado',
    emailSubject: 'Tu pago de {{amount}} ha sido aprobado',
    // ... etc
  },
  // ... continue for all 15 types
};
```

**Tests:**
- [ ] All 15 notification types have templates defined
- [ ] No undefined variables in templates

**Effort:** 1 hour
**Status:** ⬜ Pending

---

## ⚡ PHASE 2: QUICK WINS (Days 2-5, ~21 hours)

These are mostly wiring existing services together. All notification types already exist in `notifications.types.ts`.

### QUICK #1: Scheduled Communications Dispatcher

**Files to Modify:**
- `apps/api/src/communications/communications.service.ts` (add `dispatchScheduledCommunications()` method)
- `apps/api/src/shared/scheduling/cron-jobs.service.ts` (add cron call above, completed in Day 1.1)

**Implementation:**

```typescript
// In communications.service.ts, add this method:

async dispatchScheduledCommunications(): Promise<number> {
  const scheduled = await this.prisma.communication.findMany({
    where: {
      status: 'SCHEDULED',
      scheduledAt: {
        lte: new Date(), // scheduledAt <= now
      },
    },
  });

  let dispatchedCount = 0;
  for (const comm of scheduled) {
    try {
      await this.sendCommunication(comm.id);
      dispatchedCount++;
    } catch (error) {
      this.logger.error(
        `Failed to dispatch communication ${comm.id}`,
        error instanceof Error ? error.stack : '',
      );
    }
  }

  return dispatchedCount;
}

/**
 * Helper: send a communication (transition SCHEDULED → SENT, trigger email/push)
 */
private async sendCommunication(commId: string) {
  const comm = await this.prisma.communication.update({
    where: { id: commId },
    data: { status: 'SENT', sentAt: new Date() },
  });

  // TODO: Call email service, web push service
  // if (comm.sendEmail) await emailService.send(...)
  // if (comm.sendWebPush) await pushService.send(...)
}
```

**Test:**
- [ ] Create a communication with `status: SCHEDULED, scheduledAt: now - 1 minute`
- [ ] Run cron manually (via admin endpoint or test)
- [ ] Verify communication transitioned to SENT
- [ ] Verify email sent (check email service mock)

**Files:** 2
**Effort:** 1.5 hours
**Dependency:** Day 1.1 complete
**Status:** ⬜ Pending

---

### QUICK #2-4: Notification Injections (Charges, Payments, Tickets)

**Files to Modify:**
- `apps/api/src/finanzas/liquidations.service.ts`
- `apps/api/src/finanzas/expense-period.service.ts`
- `apps/api/src/finanzas/finanzas.service.ts`
- `apps/api/src/tickets/tickets.service.ts`

**Day 2 (2 hours): Charge Publication Notifications**

```typescript
// In liquidations.service.ts - publishLiquidation() method

async publishLiquidation(liquidationId: string) {
  const liquidation = await this.prisma.liquidation.update({
    where: { id: liquidationId },
    data: { status: 'PUBLISHED', publishedAt: new Date() },
    include: {
      charges: {
        include: {
          unit: {
            include: {
              occupants: { include: { user: true } },
            },
          },
        },
      },
      building: true,
    },
  });

  // ✅ NEW: Notify all residents of the charges
  for (const charge of liquidation.charges) {
    for (const occupant of charge.unit.occupants) {
      if (occupant.user) {
        await this.notificationsService.createNotification({
          type: 'CHARGE_PUBLISHED',
          recipientId: occupant.user.id,
          data: {
            chargeAmount: charge.amount,
            chargeCurrency: charge.currency,
            dueDate: charge.dueDate.toISOString(),
            buildingName: liquidation.building.name,
            unitLabel: charge.unit.label,
            period: liquidation.period,
          },
          tenantId: liquidation.tenantId,
        });
      }
    }
  }

  return liquidation;
}
```

**Day 2-3 (2 hours): Payment Notifications**

```typescript
// In finanzas.service.ts

async approvePayment(buildingId: string, paymentId: string, approvedBy?: string) {
  const payment = await this.prisma.payment.update({
    where: { id: paymentId },
    data: {
      status: 'APPROVED',
      reviewedAt: new Date(),
      reviewedByUserId: approvedBy,
    },
    include: {
      unit: {
        include: {
          occupants: { include: { user: true } },
        },
      },
    },
  });

  // ✅ NEW: Notify resident payment was approved
  if (payment.unit.occupants.length > 0 && payment.unit.occupants[0]?.user) {
    await this.notificationsService.createNotification({
      type: 'PAYMENT_RECEIVED',
      recipientId: payment.unit.occupants[0].user.id,
      data: {
        paymentAmount: payment.amount,
        paymentCurrency: payment.currency,
        reference: payment.reference || 'N/A',
      },
      tenantId: payment.tenantId,
    });
  }

  return payment;
}

async rejectPayment(buildingId: string, paymentId: string, reason: string) {
  const payment = await this.prisma.payment.update({
    where: { id: paymentId },
    data: {
      status: 'REJECTED',
      rejectionReason: reason,
      rejectedAt: new Date(),
    },
    include: {
      unit: {
        include: {
          occupants: { include: { user: true } },
        },
      },
    },
  });

  // ✅ NEW: Notify resident payment was rejected
  if (payment.unit.occupants.length > 0 && payment.unit.occupants[0]?.user) {
    await this.notificationsService.createNotification({
      type: 'PAYMENT_REJECTED',
      recipientId: payment.unit.occupants[0].user.id,
      data: {
        paymentAmount: payment.amount,
        rejectionReason: reason,
      },
      tenantId: payment.tenantId,
    });
  }

  return payment;
}
```

**Day 3 (1.5 hours): Ticket Notifications**

```typescript
// In tickets.service.ts - updateTicketStatus() method

async updateTicketStatus(buildingId: string, ticketId: string, newStatus: TicketStatus) {
  const ticket = await this.prisma.ticket.update({
    where: { id: ticketId },
    data: { status: newStatus, updatedAt: new Date() },
    include: {
      createdByUser: true,
    },
  });

  // ✅ NEW: Notify resident of status change
  if (ticket.createdByUser) {
    await this.notificationsService.createNotification({
      type: 'TICKET_STATUS_CHANGED',
      recipientId: ticket.createdByUser.id,
      data: {
        ticketId: ticket.id,
        ticketTitle: ticket.title,
        newStatus: newStatus,
        buildingId,
      },
      tenantId: ticket.tenantId,
    });
  }

  return ticket;
}

async addCommentToTicket(buildingId: string, ticketId: string, comment: CreateCommentInput, userId: string) {
  const result = await this.prisma.ticketComment.create({
    data: {
      ticketId,
      body: comment.body,
      authorId: userId,
      createdAt: new Date(),
    },
    include: {
      ticket: { include: { createdByUser: true } },
    },
  });

  // ✅ NEW: Notify ticket creator (resident) that a comment was added
  if (result.ticket.createdByUser && result.ticket.createdByUser.id !== userId) {
    await this.notificationsService.createNotification({
      type: 'TICKET_COMMENT_ADDED',
      recipientId: result.ticket.createdByUser.id,
      data: {
        ticketId: result.ticket.id,
        ticketTitle: result.ticket.title,
        commentPreview: comment.body.substring(0, 100),
      },
      tenantId: result.ticket.tenantId,
    });
  }

  return result;
}
```

**Tests:**
- [ ] Create charge → publish liquidation → verify notification in DB
- [ ] Verify email sent with correct template
- [ ] Approve payment → verify PAYMENT_RECEIVED notification
- [ ] Reject payment → verify PAYMENT_REJECTED notification
- [ ] Update ticket status → verify TICKET_STATUS_CHANGED notification
- [ ] Add comment → verify TICKET_COMMENT_ADDED notification

**Files:** 4
**Effort:** ~5.5 hours total
**Dependency:** Day 1.1 complete, NotificationsService must exist and be injectable
**Status:** ⬜ Pending

---

### QUICK #5: Occupant Assignment Notification

**Files to Modify:**
- `apps/api/src/buildings/occupants.service.ts`

```typescript
async assignOccupant(unitId: string, userId: string, role: string = 'RESIDENT') {
  // ... existing logic ...

  const occupant = await this.prisma.unitOccupant.create({
    data: { unitId, userId, role },
    include: { user: true, unit: true },
  });

  // ✅ NEW: Notify the new occupant
  await this.notificationsService.createNotification({
    type: 'OCCUPANT_ASSIGNED',
    recipientId: userId,
    data: {
      unitLabel: occupant.unit.label,
      buildingName: occupant.unit.building?.name || 'Your Building',
      role,
    },
    tenantId: occupant.unit.tenantId,
  });

  return occupant;
}
```

**Test:**
- [ ] Assign occupant → verify OCCUPANT_ASSIGNED notification created
- [ ] Email sent with welcome message

**Files:** 1
**Effort:** 1 hour
**Status:** ⬜ Pending

---

### QUICK #6: Document Visibility Notification

**Files to Modify:**
- `apps/api/src/documents/documents.service.ts`

```typescript
async createDocument(createDto: CreateDocumentDto) {
  const document = await this.prisma.document.create({
    data: { ...createDto },
    include: { building: true },
  });

  // ✅ NEW: Notify residents if document is marked RESIDENTS-visible
  if (createDto.visibility === 'RESIDENTS' && createDto.buildingId) {
    const residents = await this.prisma.unitOccupant.findMany({
      where: {
        unit: { buildingId: createDto.buildingId },
      },
      include: { user: true },
    });

    for (const occupant of residents) {
      if (occupant.user) {
        await this.notificationsService.createNotification({
          type: 'DOCUMENT_SHARED',
          recipientId: occupant.user.id,
          data: {
            documentTitle: createDto.title,
            category: createDto.category,
            buildingName: document.building?.name || 'Your Building',
          },
          tenantId: createDto.tenantId,
        });
      }
    }
  }

  return document;
}
```

**Test:**
- [ ] Upload document with visibility=RESIDENTS → verify notifications for all unit occupants
- [ ] Upload document with visibility=PRIVATE → verify no notifications

**Files:** 1
**Effort:** 0.5 hours
**Status:** ⬜ Pending

---

### QUICK #7: Audit Logging for Tickets & Documents

**Files to Modify:**
- `apps/api/src/tickets/tickets.service.ts`
- `apps/api/src/documents/documents.service.ts`

**For Tickets:**

```typescript
// In tickets.service.ts - add audit calls to status changes

async updateTicketStatus(buildingId: string, ticketId: string, newStatus: TicketStatus, userId: string) {
  const ticket = await this.prisma.ticket.update({
    where: { id: ticketId },
    data: { status: newStatus, updatedAt: new Date() },
  });

  // ✅ NEW: Audit this action
  await this.auditService.createLog({
    tenantId: ticket.tenantId,
    action: 'TICKET_STATUS_CHANGED',
    entityType: 'TICKET',
    entityId: ticketId,
    actorUserId: userId,
    metadata: { oldStatus: ticket.status, newStatus },
  });

  return ticket;
}
```

**For Documents:**

```typescript
// In documents.service.ts

async createDocument(createDto: CreateDocumentDto, userId: string) {
  const document = await this.prisma.document.create({
    data: { ...createDto },
  });

  // ✅ NEW: Audit upload
  await this.auditService.createLog({
    tenantId: createDto.tenantId,
    action: 'DOCUMENT_CREATED',
    entityType: 'DOCUMENT',
    entityId: document.id,
    actorUserId: userId,
    metadata: { category: document.category, size: document.fileSize },
  });

  return document;
}

async deleteDocument(documentId: string, userId: string) {
  const document = await this.prisma.document.findUnique({ where: { id: documentId } });

  await this.prisma.document.delete({ where: { id: documentId } });

  // ✅ NEW: Audit deletion
  await this.auditService.createLog({
    tenantId: document.tenantId,
    action: 'DOCUMENT_DELETED',
    entityType: 'DOCUMENT',
    entityId: documentId,
    actorUserId: userId,
    metadata: { category: document.category },
  });
}
```

**Test:**
- [ ] Update ticket status → verify TICKET_STATUS_CHANGED in audit_logs table
- [ ] Upload document → verify DOCUMENT_CREATED in audit_logs
- [ ] Delete document → verify DOCUMENT_DELETED in audit_logs

**Files:** 2
**Effort:** 2 hours
**Status:** ⬜ Pending

---

## ✅ END OF WEEK 1

**Deliverable: PR #1**

**Includes:**
- CronJobsService + CronJobsModule infrastructure
- Scheduled communications dispatcher (QUICK #1)
- 5 notification injections (QUICK #2-6)
- 7 audit logging enhancements (QUICK #7)

**Testing Checklist:**
- [ ] npm run build passes (0 TypeScript errors)
- [ ] All E2E tests for notifications pass
- [ ] Cronjob runs without errors (check logs)
- [ ] Audit logs are created and queryable
- [ ] Email templates render correctly

**Estimated Effort:** ~21 hours
**Status:** ⬜ Pending

---

## 📆 PHASE 3: MEDIUM FEATURES (Days 6-8, ~30 hours)

### MEDIUM #8: Auto-Overdue Detection

**Purpose:** Daily cron that finds charges past due date and notifies residents + admins.

**Files to Create:**
- New cron method in `CronJobsService`

**Files to Modify:**
- `apps/api/src/finanzas/finanzas.service.ts` (add `detectAndNotifyOverdueCharges()`)
- `apps/api/src/shared/scheduling/cron-jobs.service.ts` (add cron decorator)

**Implementation:**

```typescript
// In finanzas.service.ts

async detectAndNotifyOverdueCharges(): Promise<{ count: number }> {
  const overdue = await this.prisma.charge.findMany({
    where: {
      status: { in: ['PENDING', 'PARTIAL'] },
      dueDate: { lt: new Date() },
      overdueSince: null, // Only process once
    },
    include: {
      unit: {
        include: {
          occupants: { include: { user: true } },
          building: true,
        },
      },
    },
  });

  let notifiedCount = 0;

  for (const charge of overdue) {
    // Mark as overdue
    await this.prisma.charge.update({
      where: { id: charge.id },
      data: { overdueSince: new Date() },
    });

    // Notify residents
    for (const occupant of charge.unit.occupants) {
      if (occupant.user) {
        await this.notificationsService.createNotification({
          type: 'PAYMENT_OVERDUE',
          recipientId: occupant.user.id,
          data: {
            chargeAmount: charge.amount,
            chargeCurrency: charge.currency,
            unitLabel: charge.unit.label,
            buildingName: charge.unit.building?.name || 'Your Building',
            daysOverdue: Math.floor((Date.now() - charge.dueDate.getTime()) / (1000 * 60 * 60 * 24)),
          },
          tenantId: charge.tenantId,
        });
        notifiedCount++;
      }
    }

    // Notify building admins
    await this.notificationsService.createNotification({
      type: 'DELINQUENT_UNIT',
      recipientId: charge.unit.building.adminUserId, // Adjust based on actual admin field
      data: {
        unitLabel: charge.unit.label,
        chargeAmount: charge.amount,
      },
      tenantId: charge.tenantId,
    });
  }

  return { count: notifiedCount };
}
```

**In CronJobsService:**

```typescript
@Cron('0 9 * * *') // 9am daily
async detectAndNotifyOverdueCharges() {
  return this.runWithErrorHandling('detectAndNotifyOverdueCharges', async () => {
    return await this.finanzasService.detectAndNotifyOverdueCharges();
  });
}
```

**Test:**
- [ ] Create charge with dueDate = yesterday
- [ ] Run cron manually
- [ ] Verify charge has `overdueSince` set
- [ ] Verify PAYMENT_OVERDUE notification created

**Files:** 2
**Effort:** 2-3 hours
**Status:** ⬜ Pending

---

### MEDIUM #9: Auto-Create Monthly ExpensePeriod

**Purpose:** First of every month, automatically create next month's ExpensePeriod in DRAFT state.

**Files to Modify:**
- `apps/api/src/finanzas/finanzas.service.ts` (add `autoCreateMonthlyExpensePeriods()`)
- `apps/api/src/shared/scheduling/cron-jobs.service.ts` (add cron decorator)

**Implementation:**

```typescript
// In finanzas.service.ts

async autoCreateMonthlyExpensePeriods(): Promise<{ created: number }> {
  const now = new Date();
  const nextMonth = `${now.getFullYear()}-${String(now.getMonth() + 2).padStart(2, '0')}`;

  // Find all buildings with allocation mode enabled
  const buildings = await this.prisma.building.findMany({
    where: {
      allocationMode: 'BY_CATEGORY_RANGE_M2_COEFFICIENT',
    },
    include: {
      expensePeriods: {
        where: { period: nextMonth },
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

    // Get last period's total to use as default
    const lastPeriod = await this.prisma.expensePeriod.findFirst({
      where: { buildingId: building.id },
      orderBy: { period: 'desc' },
    });

    const defaultTotal = lastPeriod?.totalToAllocate || 0;

    // Auto-calculate due date (e.g., 15th of next month)
    const dueDate = new Date(now.getFullYear(), now.getMonth() + 1, 15);

    const period = await this.prisma.expensePeriod.create({
      data: {
        buildingId: building.id,
        period: nextMonth,
        totalToAllocate: defaultTotal,
        dueDate,
        status: 'DRAFT',
      },
    });

    // Notify building admins
    await this.notificationsService.createNotification({
      type: 'EXPENSE_PERIOD_CREATED',
      recipientId: building.adminUserId, // Adjust based on actual admin field
      data: {
        buildingName: building.name,
        period: nextMonth,
        suggestedTotal: defaultTotal,
      },
      tenantId: building.tenantId,
    });

    createdCount++;
  }

  return { created: createdCount };
}
```

**In CronJobsService:**

```typescript
@Cron('0 8 1 * *') // 8am, 1st of every month
async autoCreateMonthlyExpensePeriods() {
  return this.runWithErrorHandling('autoCreateMonthlyExpensePeriods', async () => {
    return await this.finanzasService.autoCreateMonthlyExpensePeriods();
  });
}
```

**Test:**
- [ ] Manually set system date to 1st of month
- [ ] Run cron
- [ ] Verify new ExpensePeriod created in DRAFT state with next month's period code
- [ ] Verify admin received notification

**Files:** 2
**Effort:** 3 hours
**Status:** ⬜ Pending

---

### MEDIUM #10: 3-Day Payment Reminder

**Purpose:** Daily cron that finds charges due in exactly 3 days and sends reminders.

**Files to Modify:**
- `apps/api/src/finanzas/finanzas.service.ts` (add `sendPaymentReminders()`)
- `apps/api/src/shared/scheduling/cron-jobs.service.ts` (add cron decorator)

**Implementation:**

```typescript
// In finanzas.service.ts

async sendPaymentReminders(): Promise<{ count: number }> {
  const now = new Date();
  const inThreeDays = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const startOfDay = new Date(inThreeDays.getFullYear(), inThreeDays.getMonth(), inThreeDays.getDate());
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

  // Find charges due in exactly 3 days
  const remindableCharges = await this.prisma.charge.findMany({
    where: {
      status: { in: ['PENDING', 'PARTIAL'] },
      dueDate: {
        gte: startOfDay,
        lt: endOfDay,
      },
      reminderSentAt: null, // Only once per charge
    },
    include: {
      unit: {
        include: {
          occupants: { include: { user: true } },
          building: true,
        },
      },
    },
  });

  let reminderCount = 0;

  for (const charge of remindableCharges) {
    // Mark reminder as sent
    await this.prisma.charge.update({
      where: { id: charge.id },
      data: { reminderSentAt: new Date() },
    });

    // Notify residents
    for (const occupant of charge.unit.occupants) {
      if (occupant.user) {
        await this.notificationsService.createNotification({
          type: 'PAYMENT_REMINDER',
          recipientId: occupant.user.id,
          data: {
            chargeAmount: charge.amount,
            chargeCurrency: charge.currency,
            unitLabel: charge.unit.label,
            dueDate: charge.dueDate.toISOString(),
          },
          tenantId: charge.tenantId,
        });
        reminderCount++;
      }
    }
  }

  return { count: reminderCount };
}
```

**In CronJobsService:**

```typescript
@Cron('0 10 * * *') // 10am daily
async sendPaymentReminders() {
  return this.runWithErrorHandling('sendPaymentReminders', async () => {
    return await this.finanzasService.sendPaymentReminders();
  });
}
```

**Test:**
- [ ] Create charge with dueDate = today + 3 days
- [ ] Run cron on day 3
- [ ] Verify PAYMENT_REMINDER notification created
- [ ] Verify `reminderSentAt` is set (won't send twice)

**Files:** 2
**Effort:** 1.5 hours
**Status:** ⬜ Pending

---

### MEDIUM #11: Bulk Expense Validation Endpoint

**Purpose:** Allow admins to validate all DRAFT expenses for a period in one action.

**Files to Modify:**
- `apps/api/src/finanzas/finanzas.controller.ts` (add new endpoint)
- `apps/api/src/finanzas/finanzas.service.ts` (add service method)

**Implementation:**

```typescript
// In finanzas.controller.ts

@Patch(':buildingId/expenses/validate-all')
@UseGuards(JwtGuard, TenantGuard)
async bulkValidateExpenses(
  @Param('buildingId') buildingId: string,
  @Query('periodId') periodId: string,
  @Request() req: any,
) {
  // Authorization: TENANT_ADMIN or OPERATOR only
  const userRoles = req.user.roles || [];
  if (!['TENANT_ADMIN', 'TENANT_OWNER', 'OPERATOR'].some(r => userRoles.includes(r))) {
    throw new ForbiddenException('Only admins can validate expenses');
  }

  const result = await this.finanzasService.bulkValidateExpenses(buildingId, periodId);
  return result;
}
```

**In finanzas.service.ts:**

```typescript
async bulkValidateExpenses(buildingId: string, periodId?: string): Promise<{ validatedCount: number; errorCount: number }> {
  const where: any = {
    buildingId,
    status: 'DRAFT',
  };

  if (periodId) {
    where.periodId = periodId;
  }

  const draftExpenses = await this.prisma.expense.findMany({ where });

  let validatedCount = 0;
  let errorCount = 0;

  // Validate all in parallel
  const results = await Promise.allSettled(
    draftExpenses.map(exp =>
      this.prisma.expense.update({
        where: { id: exp.id },
        data: { status: 'VALIDATED' },
      }),
    ),
  );

  results.forEach(result => {
    if (result.status === 'fulfilled') {
      validatedCount++;
    } else {
      errorCount++;
      this.logger.error('Failed to validate expense', result.reason);
    }
  });

  // Audit
  await this.auditService.createLog({
    tenantId: req.user.tenantId,
    action: 'EXPENSE_BULK_VALIDATED',
    entityType: 'EXPENSE',
    entityId: buildingId,
    metadata: { validatedCount, errorCount, periodId },
  });

  return { validatedCount, errorCount };
}
```

**Test:**
- [ ] Create 10 DRAFT expenses
- [ ] Call `PATCH /buildings/:id/expenses/validate-all`
- [ ] Verify all 10 transitioned to VALIDATED
- [ ] Verify response shows validatedCount=10

**Files:** 2
**Effort:** 2 hours
**Status:** ⬜ Pending

---

### MEDIUM #12: URGENT Ticket Escalation

**Purpose:** Hourly cron that finds high-priority unassigned tickets and escalates.

**Files to Modify:**
- `apps/api/src/tickets/tickets.service.ts` (add `escalateUrgentTickets()`)
- `apps/api/src/shared/scheduling/cron-jobs.service.ts` (add cron decorator)

**Implementation:**

```typescript
// In tickets.service.ts

async escalateUrgentTickets(): Promise<{ escalatedCount: number }> {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

  // Find OPEN tickets that are HIGH/URGENT, unassigned, created >2 hours ago
  const escalatable = await this.prisma.ticket.findMany({
    where: {
      status: 'OPEN',
      priority: { in: ['HIGH', 'URGENT'] },
      assigneeId: null,
      createdAt: { lt: twoHoursAgo },
      escalatedAt: null, // Only once
    },
    include: {
      building: true,
    },
  });

  let escalatedCount = 0;

  for (const ticket of escalatable) {
    // Mark as escalated
    await this.prisma.ticket.update({
      where: { id: ticket.id },
      data: { escalatedAt: new Date() },
    });

    // Notify building admins
    await this.notificationsService.createNotification({
      type: 'URGENT_TICKET_UNASSIGNED',
      recipientId: ticket.building.adminUserId, // Adjust based on actual admin field
      data: {
        ticketId: ticket.id,
        ticketTitle: ticket.title,
        ticketPriority: ticket.priority,
        hoursWaiting: Math.floor((Date.now() - ticket.createdAt.getTime()) / (1000 * 60 * 60)),
      },
      tenantId: ticket.tenantId,
    });

    escalatedCount++;
  }

  return { escalatedCount };
}
```

**In CronJobsService:**

```typescript
@Cron('0 * * * *') // Every hour at :00
async escalateUrgentTickets() {
  return this.runWithErrorHandling('escalateUrgentTickets', async () => {
    return await this.ticketsService.escalateUrgentTickets();
  });
}
```

**Test:**
- [ ] Create URGENT ticket without assignment, createdAt = 2+ hours ago
- [ ] Run cron
- [ ] Verify ticket has `escalatedAt` set
- [ ] Verify admin received URGENT_TICKET_UNASSIGNED notification

**Files:** 2
**Effort:** 1.5 hours
**Status:** ⬜ Pending

---

## ✅ END OF MEDIUM FEATURES (Week 1-2 boundary)

**Deliverable: PR #2**

**Includes:**
- 5 cron jobs (overdue, reminders, monthly periods, bulk validation, escalation)
- All run independently, fire-and-forget, logged

**Testing Checklist:**
- [ ] Each cron tested in isolation (manual trigger via admin endpoint)
- [ ] Notifications sent correctly
- [ ] No database locks or blocking
- [ ] Audit logs created for bulk actions

**Estimated Effort:** ~30 hours total
**Status:** ⬜ Pending

---

## 🔧 PHASE 4: HARD FEATURES (Days 9-13, ~48 hours)

### HARD #13: Complete Excel/CSV Expense Import

**Purpose:** Finish backend implementation of bulk expense import from file.

**Current State:**
- Frontend modal exists: `ExpenseImportModal.tsx` ✅
- DTO exists: `expense-import.dto.ts` ✅
- Backend handler: partial or missing

**Files to Create/Modify:**
- `apps/api/src/finanzas/expense-import.service.ts` (NEW)
- `apps/api/src/finanzas/finanzas.controller.ts` (add endpoint or fix existing)

**Implementation:**

```typescript
// apps/api/src/finanzas/expense-import.service.ts

import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '@/shared/prisma/prisma.service';
import { ExpenseImportRow, ExpenseImportResult } from './expense-import.dto';
import { AuditService } from '@/shared/audit/audit.service';

@Injectable()
export class ExpenseImportService {
  private readonly logger = new Logger(ExpenseImportService.name);

  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
  ) {}

  async importExpensesFromRows(
    tenantId: string,
    buildingId: string,
    period: string,
    rows: ExpenseImportRow[],
    userId: string,
  ): Promise<ExpenseImportResult> {
    const errors: { rowIndex: number; reason: string }[] = [];
    const createdExpenses: string[] = [];

    // Validate all rows first (fail-fast)
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const validation = await this.validateRow(tenantId, buildingId, row, i);
      if (!validation.valid) {
        errors.push({ rowIndex: i, reason: validation.error || 'Unknown error' });
      }
    }

    // If there are errors, still proceed but mark failed rows
    // (Or fail entirely — depends on policy. Here: proceed with valid rows)

    // Process each valid row
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const isValid = !errors.some(e => e.rowIndex === i);

      if (!isValid) {
        continue;
      }

      try {
        const expense = await this.prisma.expense.create({
          data: {
            tenantId,
            buildingId,
            period,
            categoryId: row.categoria, // Assume this is categoryId
            description: row.descripcion,
            amountMinor: Math.round(row.monto * 100), // Convert to cents
            currencyCode: row.moneda,
            invoiceDate: new Date(this.parseDateString(row.fecha)),
            vendorId: row.proveedor ? await this.getOrCreateVendor(tenantId, row.proveedor) : null,
            status: 'DRAFT', // Imported expenses start as DRAFT
          },
        });

        createdExpenses.push(expense.id);

        // Audit
        await this.auditService.createLog({
          tenantId,
          action: 'EXPENSE_IMPORTED',
          entityType: 'EXPENSE',
          entityId: expense.id,
          actorUserId: userId,
          metadata: { source: 'CSV_IMPORT', rowIndex: i },
        });
      } catch (error) {
        errors.push({
          rowIndex: i,
          reason: error instanceof Error ? error.message : 'Failed to create expense',
        });
        this.logger.error(`Failed to import row ${i}`, error);
      }
    }

    return {
      totalRows: rows.length,
      successCount: createdExpenses.length,
      failureCount: errors.length,
      createdExpenses,
      errors,
    };
  }

  private async validateRow(
    tenantId: string,
    buildingId: string,
    row: ExpenseImportRow,
    index: number,
  ): Promise<{ valid: boolean; error?: string }> {
    // Check required fields
    if (!row.fecha) return { valid: false, error: `Row ${index}: fecha is required` };
    if (!row.descripcion) return { valid: false, error: `Row ${index}: descripcion is required` };
    if (!row.monto || row.monto <= 0) return { valid: false, error: `Row ${index}: monto must be > 0` };
    if (!row.moneda) return { valid: false, error: `Row ${index}: moneda is required` };
    if (!row.categoria) return { valid: false, error: `Row ${index}: categoria is required` };

    // Validate date format
    try {
      new Date(this.parseDateString(row.fecha));
    } catch {
      return { valid: false, error: `Row ${index}: fecha format invalid (expected DD/MM/YYYY)` };
    }

    // Validate category exists
    const category = await this.prisma.expenseLedgerCategory.findFirst({
      where: { tenantId, name: row.categoria, scopeType: 'BUILDING' },
    });
    if (!category) {
      return { valid: false, error: `Row ${index}: categoria "${row.categoria}" not found` };
    }

    // Validate building exists
    const building = await this.prisma.building.findUnique({ where: { id: buildingId } });
    if (!building || building.tenantId !== tenantId) {
      return { valid: false, error: `Row ${index}: building not found or not in tenant` };
    }

    return { valid: true };
  }

  private parseDateString(dateStr: string): Date {
    // Support DD/MM/YYYY or ISO format
    const parts = dateStr.split('/');
    if (parts.length === 3) {
      const [day, month, year] = parts.map(p => parseInt(p));
      return new Date(year, month - 1, day);
    }
    return new Date(dateStr);
  }

  private async getOrCreateVendor(tenantId: string, vendorName: string): Promise<string | null> {
    // Try to find vendor by name
    let vendor = await this.prisma.vendor.findFirst({
      where: { tenantId, name: vendorName },
    });

    if (!vendor) {
      // Create if doesn't exist
      vendor = await this.prisma.vendor.create({
        data: {
          tenantId,
          name: vendorName,
          email: '', // Empty, can be updated later
          phone: '',
        },
      });
    }

    return vendor.id;
  }
}
```

**In finanzas.controller.ts:**

```typescript
@Post('expenses/import/from-excel')
@UseGuards(JwtGuard, TenantGuard)
async importExpenses(
  @Body() importDto: ImportExpensesDto,
  @Request() req: any,
) {
  const tenantId = req.user.tenantId;
  const buildingId = req.params.buildingId;

  const result = await this.expenseImportService.importExpensesFromRows(
    tenantId,
    buildingId,
    importDto.period,
    importDto.rows,
    req.user.id,
  );

  return result;
}
```

**Test:**
- [ ] Upload Excel with 20 valid expenses
- [ ] Verify all 20 created as DRAFT in DB
- [ ] Verify success count = 20, failure count = 0
- [ ] Upload Excel with 5 invalid rows (bad date format, missing category)
- [ ] Verify only valid rows imported, invalid rows in error list with reasons
- [ ] Verify audit logs created for all imports

**Files:** 2
**Effort:** 8 hours
**Status:** ⬜ Pending

---

### HARD #14: Recurring Expenses

**Purpose:** Define recurring expense templates that auto-generate DRAFT expenses each period.

**Files to Create:**
- `apps/api/src/finanzas/recurring-expense.dto.ts` (NEW)
- `apps/api/src/finanzas/recurring-expense.service.ts` (NEW)
- `apps/api/src/finanzas/recurring-expense.controller.ts` (NEW)

**Files to Modify:**
- `apps/api/prisma/schema.prisma` (add RecurringExpense model)
- `apps/api/src/shared/scheduling/cron-jobs.service.ts` (add daily cron)

**Prisma Migration:**

```prisma
model RecurringExpense {
  id String @id @default(cuid())
  tenantId String
  buildingId String
  categoryId String
  amount Int // in cents
  currency String
  concept String
  frequency String // MONTHLY, QUARTERLY, YEARLY
  nextRunDate DateTime
  isActive Boolean @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  building Building @relation(fields: [buildingId], references: [id], onDelete: Cascade)
  category ExpenseLedgerCategory @relation(fields: [categoryId], references: [id])

  @@index([tenantId, buildingId, nextRunDate])
  @@index([isActive, nextRunDate])
}
```

**Service:**

```typescript
// apps/api/src/finanzas/recurring-expense.service.ts

@Injectable()
export class RecurringExpenseService {
  async createRecurringExpense(
    tenantId: string,
    buildingId: string,
    createDto: CreateRecurringExpenseDto,
  ) {
    return this.prisma.recurringExpense.create({
      data: {
        tenantId,
        buildingId,
        categoryId: createDto.categoryId,
        amount: createDto.amount,
        currency: createDto.currency,
        concept: createDto.concept,
        frequency: createDto.frequency,
        nextRunDate: this.calculateNextRunDate(new Date(), createDto.frequency),
        isActive: true,
      },
    });
  }

  /**
   * Called daily by cron: generate expenses for any recurring templates due today
   */
  async processRecurringExpenses(): Promise<{ createdCount: number }> {
    const due = await this.prisma.recurringExpense.findMany({
      where: {
        isActive: true,
        nextRunDate: { lte: new Date() },
      },
    });

    let createdCount = 0;

    for (const recurring of due) {
      // Create DRAFT expense
      const period = this.getCurrentPeriod(); // e.g., "2026-04"
      await this.prisma.expense.create({
        data: {
          tenantId: recurring.tenantId,
          buildingId: recurring.buildingId,
          period,
          categoryId: recurring.categoryId,
          description: recurring.concept,
          amountMinor: recurring.amount,
          currencyCode: recurring.currency,
          invoiceDate: new Date(),
          status: 'DRAFT',
        },
      });

      // Update nextRunDate
      const nextRun = this.calculateNextRunDate(new Date(), recurring.frequency);
      await this.prisma.recurringExpense.update({
        where: { id: recurring.id },
        data: { nextRunDate: nextRun },
      });

      createdCount++;
    }

    return { createdCount };
  }

  private calculateNextRunDate(from: Date, frequency: string): Date {
    const next = new Date(from);
    switch (frequency) {
      case 'MONTHLY':
        next.setMonth(next.getMonth() + 1);
        break;
      case 'QUARTERLY':
        next.setMonth(next.getMonth() + 3);
        break;
      case 'YEARLY':
        next.setFullYear(next.getFullYear() + 1);
        break;
    }
    return next;
  }

  private getCurrentPeriod(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
}
```

**In CronJobsService:**

```typescript
@Cron('0 6 * * *') // 6am daily
async processRecurringExpenses() {
  return this.runWithErrorHandling('processRecurringExpenses', async () => {
    return await this.recurringExpenseService.processRecurringExpenses();
  });
}
```

**Controller:**

```typescript
// Create recurring template
@Post('buildings/:buildingId/recurring-expenses')
async createRecurringExpense(
  @Param('buildingId') buildingId: string,
  @Body() createDto: CreateRecurringExpenseDto,
) {
  return this.recurringExpenseService.createRecurringExpense(req.user.tenantId, buildingId, createDto);
}

// List recurring templates
@Get('buildings/:buildingId/recurring-expenses')
async listRecurringExpenses(@Param('buildingId') buildingId: string) {
  return this.prisma.recurringExpense.findMany({
    where: { buildingId },
  });
}

// Update/disable recurring
@Patch('recurring-expenses/:id')
async updateRecurringExpense(
  @Param('id') id: string,
  @Body() updateDto: UpdateRecurringExpenseDto,
) {
  return this.prisma.recurringExpense.update({
    where: { id },
    data: updateDto,
  });
}
```

**Test:**
- [ ] Create recurring expense with frequency=MONTHLY
- [ ] Verify nextRunDate is set to next month
- [ ] Manually trigger cron on nextRunDate
- [ ] Verify DRAFT expense created with correct amount
- [ ] Verify nextRunDate updated to month after

**Files:** 5
**Effort:** 12 hours
**Status:** ⬜ Pending

---

### HARD #15: Monthly Finance Summary Email

**Purpose:** First of each month, auto-generate and email a finance summary to TENANT_ADMIN.

**Files to Create:**
- `apps/api/src/finanzas/email-templates/finance-summary.template.html` (NEW)
- `apps/api/src/finanzas/finance-summary.service.ts` (NEW)

**Files to Modify:**
- `apps/api/src/shared/scheduling/cron-jobs.service.ts` (add cron)
- `apps/api/src/shared/email/email.service.ts` (ensure email delivery works)

**Service:**

```typescript
// apps/api/src/finanzas/finance-summary.service.ts

@Injectable()
export class FinanceSummaryService {
  constructor(
    private prisma: PrismaService,
    private finanzasService: FinanzasService, // For getFinanceReport
    private emailService: EmailService,
    private logger: Logger,
  ) {}

  /**
   * Called on 1st of each month: generate and email summary to all TENANT_ADMINs
   */
  async sendMonthlyFinanceSummaries(): Promise<{ sentCount: number }> {
    const lastMonth = this.getLastMonth();
    const tenants = await this.prisma.tenant.findMany({
      where: { isActive: true },
      include: {
        memberships: {
          where: { roles: { hasSome: ['TENANT_ADMIN'] } },
          include: { user: true },
        },
      },
    });

    let sentCount = 0;

    for (const tenant of tenants) {
      if (tenant.memberships.length === 0) continue;

      try {
        // Get finance report for last month
        const report = await this.finanzasService.getFinanceReport(tenant.id, {
          period: lastMonth,
        });

        // Generate HTML
        const html = this.generateSummaryHtml(tenant.name, lastMonth, report);

        // Send to all TENANT_ADMINs
        for (const membership of tenant.memberships) {
          await this.emailService.send({
            to: membership.user.email,
            subject: `${tenant.name} - Finance Summary for ${this.formatMonth(lastMonth)}`,
            html,
          });
          sentCount++;
        }

        this.logger.log(`Finance summary sent to ${tenant.memberships.length} admins for tenant ${tenant.id}`);
      } catch (error) {
        this.logger.error(`Failed to send finance summary for tenant ${tenant.id}`, error);
      }
    }

    return { sentCount };
  }

  private generateSummaryHtml(
    tenantName: string,
    period: string,
    report: FinanceReport,
  ): string {
    const percentFormatter = new Intl.NumberFormat('es-AR', { style: 'percent' });

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; }
          .header { background-color: #f0f0f0; padding: 20px; }
          .kpi { display: inline-block; margin: 10px 20px; }
          .kpi-value { font-size: 24px; font-weight: bold; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          th { background-color: #2c3e50; color: white; padding: 10px; text-align: left; }
          td { padding: 10px; border-bottom: 1px solid #ddd; }
          .footer { margin-top: 20px; font-size: 12px; color: #999; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>${tenantName}</h1>
          <h2>Resumen Financiero - ${this.formatMonth(period)}</h2>
        </div>

        <div class="summary">
          <div class="kpi">
            <div>Total Facturado</div>
            <div class="kpi-value">$${(report.totalCharges / 100).toFixed(2)}</div>
          </div>
          <div class="kpi">
            <div>Total Cobrado</div>
            <div class="kpi-value" style="color: green;">$${(report.totalPaid / 100).toFixed(2)}</div>
          </div>
          <div class="kpi">
            <div>Pendiente</div>
            <div class="kpi-value" style="color: red;">$${(report.totalOutstanding / 100).toFixed(2)}</div>
          </div>
          <div class="kpi">
            <div>Tasa de Cobranza</div>
            <div class="kpi-value" style="color: blue;">${percentFormatter.format(report.collectionRate / 100)}</div>
          </div>
        </div>

        <h3>Unidades Morosas (${report.delinquentUnitsCount})</h3>
        <table>
          <thead>
            <tr>
              <th>Unidad</th>
              <th>Edificio</th>
              <th>Deuda</th>
            </tr>
          </thead>
          <tbody>
            ${report.delinquentUnits.map(u => `
              <tr>
                <td>${u.unitId}</td>
                <td>${u.buildingName}</td>
                <td>$${(u.outstanding / 100).toFixed(2)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <div class="footer">
          <p>Este reporte fue generado automáticamente. Para más detalles, ingresa a BuildingOS.</p>
        </div>
      </body>
      </html>
    `;
  }

  private formatMonth(period: string): string {
    const [year, month] = period.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1);
    return date.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  }

  private getLastMonth(): string {
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1);
    return `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`;
  }
}
```

**In CronJobsService:**

```typescript
@Cron('0 10 1 * *') // 10am on 1st of each month
async sendMonthlyFinanceSummaries() {
  return this.runWithErrorHandling('sendMonthlyFinanceSummaries', async () => {
    return await this.financeSummaryService.sendMonthlyFinanceSummaries();
  });
}
```

**Test:**
- [ ] Manually set system date to 1st of month
- [ ] Run cron
- [ ] Verify email was sent to all TENANT_ADMIN users
- [ ] Verify HTML contains correct data (collection rate, totals, delinquent list)
- [ ] Check email is not spam (proper formatting, from address)

**Files:** 3
**Effort:** 6 hours
**Status:** ⬜ Pending

---

## ✅ END OF HARD FEATURES

**Deliverable: PR #3**

**Includes:**
- Excel/CSV bulk import (HARD #13)
- Recurring expenses with daily cron (HARD #14)
- Monthly finance email summaries (HARD #15)

**Testing Checklist:**
- [ ] Import 50 expenses from CSV, verify all DRAFT
- [ ] Create 3 recurring templates, run cron for 3 months, verify 9 expenses auto-created
- [ ] Trigger finance summary email, verify all admins get email with correct data

**Estimated Effort:** ~48 hours total
**Status:** ⬜ Pending

---

## 🚀 DAY 14: Final Testing + Documentation + Deployment

### Comprehensive E2E Testing

**Test Suite: Full Automation Flow**

```
1. [CHARGES FLOW]
   Create building with allocationMode=BY_CATEGORY_RANGE_M2_COEFFICIENT
   → Auto-create monthly ExpensePeriod (cron)
   → Admin publishes period
   → Residents get CHARGE_PUBLISHED notification ✅
   → Cron 3-day reminder fires (if due date within 3 days) ✅
   → Admin approves payment
   → Resident gets PAYMENT_RECEIVED notification ✅

2. [OVERDUE ESCALATION]
   Create charge with dueDate=yesterday
   → Cron detects overdue
   → Resident gets PAYMENT_OVERDUE notification ✅
   → Admin gets DELINQUENT_UNIT notification ✅

3. [RECURRING EXPENSES]
   Create recurring template (monthly cleaning, $500)
   → Cron runs daily
   → On nextRunDate, DRAFT expense auto-created ✅
   → nextRunDate updates to next month ✅

4. [TICKETS]
   Resident creates URGENT ticket
   → Auto-assigned to category via AI ✅
   → Admin updates status → resident gets notification ✅
   → Unassigned for 2+ hours → escalation alert fires ✅

5. [COMMUNICATIONS]
   Create communication scheduled for tomorrow
   → Cron fires at scheduledAt time
   → Transitions to SENT, email delivered ✅

6. [DOCUMENTS]
   Upload document with visibility=RESIDENTS
   → All residents notified via DOCUMENT_SHARED ✅
   → Audit log created ✅

7. [REPORTING]
   On 1st of month at 10am
   → Finance summary email sent to all TENANT_ADMINs ✅
   → Contains collection rate, outstanding, delinquent list ✅
```

### Stress Testing

```
- 100 concurrent expense imports → verify no deadlocks
- Run all cronjobs simultaneously → verify no race conditions
- 1000 notifications queued → verify email system doesn't choke
```

### Code Quality

```
npm run build              # 0 TypeScript errors required
npm run lint              # No eslint violations
npm test                  # All unit tests pass
npm run test:e2e          # All E2E tests pass
```

### Documentation

Create: `AUTOMATION.md` in root with:
- Feature overview (15 items)
- Cron schedule reference
- Notification types + templates
- Admin setup guide
- Troubleshooting guide

---

## 📊 Final Deliverables

| Item | Status |
|------|--------|
| PR #1: Infrastructure + Quick Wins | ⬜ |
| PR #2: Medium Features (5 cronjobs) | ⬜ |
| PR #3: Hard Features (Import + Recurring + Email) | ⬜ |
| AUTOMATION.md documentation | ⬜ |
| All tests passing (unit + E2E) | ⬜ |
| Merge to main | ⬜ |
| Deploy to staging | ⬜ |

---

## 📈 Success Metrics

After all 15 automations are live:

| Metric | Before | After | Impact |
|--------|--------|-------|--------|
| **Monthly admin clicks** | ~500 | ~50 | 90% reduction |
| **Manual charge creation** | Every month | Auto 1st | Eliminated |
| **Payment notifications** | 0% | 100% | Residents informed |
| **Overdue detection** | Manual dashboard check | Daily auto-alert | Proactive |
| **Expense imports** | Per-item manual entry | Bulk CSV | 50+ items/min |
| **Finance reporting** | Manual monthly download | Auto email | Time saved |
| **Audit coverage** | 70% of actions | 100% of actions | Compliance |

---

## 🎯 Key Principles for Execution

1. **Small, atomic PRs** — Merge every 2-3 days to avoid conflicts
2. **Test first** — Write test before/alongside implementation
3. **Fire-and-forget** — All cronjobs catch errors, never fail main operation
4. **Audit everything** — Every automation action logged to audit_logs
5. **Notify smartly** — No spam; meaningful notifications with context
6. **Rollback ready** — Can disable any cron with DB flag `isActive=false`

---

## Timeline at a Glance

```
Week 1:
  Mon: Infrastructure (CronJobsService)
  Tue-Wed: Quick wins #1-4 (notifications)
  Thu: Quick wins #5-7 (remaining notifications + audit)
  Fri: Testing + PR #1 Merge

Week 2:
  Mon: Medium #8-10 (overdue, periods, reminders)
  Tue: Medium #11-12 (bulk validation, escalation) + PR #2 Merge
  Wed-Thu: Hard #13 (Excel import)
  Fri: Hard #14-15 (Recurring + Email) + Final Testing
  Next Mon: Deploy to production
```

---

**Ready to execute. Questions or clarifications needed before Day 1?**
