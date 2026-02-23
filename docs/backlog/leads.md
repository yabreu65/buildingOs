# Leads System - Backlog & Future Enhancements

**Status**: Fase 4 (MVP) READY FOR PRODUCTION ✅
**Document Date**: 2026-02-23
**Author**: Engineering Team

---

## Preface

The Leads MVP (Phase 4) is complete and production-ready:
- ✅ Public lead capture (POST /leads/public)
- ✅ Admin management (GET/PATCH/DELETE /leads/admin/*)
- ✅ Lead-to-customer conversion (POST /leads/admin/:id/convert)
- ✅ Email notifications to sales team
- ✅ Audit trail + rate limiting
- ✅ Separated security (public vs admin controllers)

This document catalogs potential enhancements for **Phase 5+**, organized by priority and complexity.

---

## Enhancement 1: Repository Pattern

**Priority**: MEDIUM (Phase 5-6)
**Complexity**: 3/5 (5-8 hours)
**Rationale**: Improve testability, decouple Prisma, enable future database migrations

### Current State
```typescript
// LeadsService uses Prisma directly
class LeadsService {
  constructor(private prisma: PrismaService) {}

  async createLead(dto) {
    return this.prisma.lead.create({ ... });
  }
}
```

**Problems**:
- Hard to test (requires Prisma mock)
- Prisma logic mixed with business logic
- Difficult to switch databases in future
- No transaction abstraction

### Proposed Implementation

```typescript
// LeadsRepository - Data access layer
interface ILeadsRepository {
  create(data: CreateLeadInput): Promise<Lead>;
  findById(id: string): Promise<Lead | null>;
  findByEmail(email: string): Promise<Lead | null>;
  list(filters: LeadFilters): Promise<{ data: Lead[]; total: number }>;
  update(id: string, data: UpdateLeadInput): Promise<Lead>;
  delete(id: string): Promise<void>;
  convertLead(id: string, tenantId: string): Promise<Lead>;
}

@Injectable()
export class PrismaLeadsRepository implements ILeadsRepository {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateLeadInput): Promise<Lead> {
    return this.prisma.lead.create({ data });
  }
  // ... implement other methods
}

// LeadsService now depends on repository interface
@Injectable()
export class LeadsService {
  constructor(private leadsRepository: ILeadsRepository) {}

  async createLead(dto: CreateLeadDto): Promise<Lead> {
    // Business logic here
    return this.leadsRepository.create(dto);
  }
}
```

### Benefits
- ✅ Easier unit testing (mock ILeadsRepository)
- ✅ Future: TypeORM/MongoDB support without changing service
- ✅ Transaction handling isolated to repository
- ✅ Clear separation: business logic vs data access

### Migration Path
1. Create `ILeadsRepository` interface
2. Create `PrismaLeadsRepository` implementation
3. Update `LeadsService` to use repository
4. Update `AdminLeadsController` tests
5. Remove Prisma imports from service

### Estimated Impact
- **Files**: 3-4 new files
- **Breaking Changes**: None (internal refactoring)
- **Testing**: +20 unit tests

---

## Enhancement 2: Slack Notifications

**Priority**: HIGH (Phase 5)
**Complexity**: 2/5 (3-5 hours)
**Rationale**: Real-time sales team notifications, integration with existing Slack workspace

### Current State
- ✅ Email notifications to SALES_TEAM_EMAIL
- ❌ No real-time channel notifications

### Proposed Implementation

#### Config Addition
```env
# .env
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
SLACK_LEADS_CHANNEL=leads
SLACK_CONVERSION_CHANNEL=conversions
```

#### SlackNotificationService
```typescript
@Injectable()
export class SlackNotificationService {
  constructor(private config: ConfigService, private logger: Logger) {}

  async notifyNewLead(lead: Lead): Promise<void> {
    const message = {
      channel: this.config.get('slackLeadsChannel'),
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*New Lead*\n${lead.fullName}` }
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Email*\n${lead.email}` },
            { type: 'mrkdwn', text: `*Phone*\n${lead.phone || 'N/A'}` },
            { type: 'mrkdwn', text: `*Type*\n${lead.tenantType}` },
            { type: 'mrkdwn', text: `*Units*\n${lead.unitsEstimate}` },
            { type: 'mrkdwn', text: `*Source*\n${lead.source}` },
            { type: 'mrkdwn', text: `*Location*\n${lead.location || 'N/A'}` }
          ]
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `_${lead.message || 'No message'}_` }
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'View in Dashboard' },
              url: `${this.config.get('appBaseUrl')}/admin/leads/${lead.id}`,
              style: 'primary'
            }
          ]
        }
      ]
    };

    await fetch(this.config.get('slackWebhookUrl'), {
      method: 'POST',
      body: JSON.stringify(message)
    });
  }

  async notifyLeadConverted(lead: Lead, tenant: Tenant): Promise<void> {
    // Similar structure for conversion notifications
  }

  async notifyLeadStatusChanged(lead: Lead, newStatus: LeadStatus): Promise<void> {
    // Notify on status change
  }
}
```

#### Integration Points
```typescript
// In LeadsService

async createLead(dto: CreateLeadDto): Promise<Lead> {
  const lead = await this.leadsRepository.create(dto);

  // Existing: Email notification
  void this.emailService.sendEmail(...);

  // New: Slack notification (fire-and-forget)
  void this.slackNotificationService.notifyNewLead(lead).catch(err => {
    this.logger.error(`Slack notification failed: ${err.message}`);
  });

  return lead;
}

async convertLeadToTenant(...): Promise<ConvertLeadResponseDto> {
  // ... conversion logic

  // Notify Slack
  void this.slackNotificationService.notifyLeadConverted(lead, tenant).catch(...);

  return result;
}
```

### Slack Message Examples

**New Lead**:
```
🎯 New Lead
John Doe (john@example.com)
📱 +1 555-0000
🏢 ADMINISTRADORA | 150 units
🌍 Argentina, Buenos Aires
📊 source: pricing-page

"Interested in demo for 5 buildings"

[View in Dashboard]
```

**Lead Converted**:
```
🎉 Lead Converted
John Doe → Tenant: Acme Buildings
Invited: owner@acmebuildings.com
Plan: TRIAL
Sent at: 2026-02-23 14:23 UTC

[View Tenant Dashboard] [View Lead]
```

### Benefits
- ✅ Real-time sales team visibility
- ✅ No context-switch (Slack tab vs email)
- ✅ Action buttons in messages
- ✅ Easy filtering/searching in Slack
- ✅ Integrates with existing workflow

### Configuration
- Webhook URL from Slack workspace
- Channel selection per event type
- Toggle on/off per environment (dev: disabled)

### Estimated Impact
- **New Service**: 1 file (SlackNotificationService)
- **Updates**: LeadsService (3-4 method calls)
- **Tests**: +10 unit tests
- **Config**: 2-3 env vars

---

## Enhancement 3: Lead Routing (Trial vs Sales-Assisted)

**Priority**: MEDIUM-HIGH (Phase 6)
**Complexity**: 4/5 (8-12 hours)
**Rationale**: Improve conversion rate by auto-routing high-value leads to sales team

### Current State
- All leads → NEW status → Manual sales assignment

### Proposed Logic

```typescript
enum LeadQualification {
  TRIAL = 'TRIAL',              // Auto-onboard to TRIAL
  SALES_ASSISTED = 'SALES_ASSISTED',  // Route to sales
  PREMIUM = 'PREMIUM',          // Premium sales path
}

interface LeadRoutingRules {
  trialThresholds: {
    minUnits: number;           // e.g., 10 (auto-trial if >= 10 units)
    maxUnits: number;           // e.g., 100 (auto-trial if <= 100 units)
    allowedTenantTypes: TenantType[];
  };
  salesAssistedThresholds: {
    minUnits: number;           // e.g., 100+ units
    targetTenantTypes: TenantType[];
  };
}

// Default rules
const DEFAULT_ROUTING_RULES: LeadRoutingRules = {
  trialThresholds: {
    minUnits: 10,
    maxUnits: 100,
    allowedTenantTypes: ['EDIFICIO_AUTOGESTION'], // Self-managed only
  },
  salesAssistedThresholds: {
    minUnits: 101,
    targetTenantTypes: ['ADMINISTRADORA'],  // Management companies
  },
};

class LeadRoutingService {
  determineQualification(lead: Lead): LeadQualification {
    if (lead.tenantType === 'EDIFICIO_AUTOGESTION' &&
        lead.unitsEstimate >= 10 &&
        lead.unitsEstimate <= 100) {
      return LeadQualification.TRIAL;
    }

    if (lead.tenantType === 'ADMINISTRADORA' &&
        lead.unitsEstimate >= 100) {
      return LeadQualification.SALES_ASSISTED;
    }

    if (lead.unitsEstimate > 500) {
      return LeadQualification.PREMIUM;
    }

    return LeadQualification.TRIAL; // Default
  }
}
```

### Integration Flow

```typescript
async createLead(dto: CreateLeadDto): Promise<Lead> {
  const lead = await this.leadsRepository.create(dto);

  // NEW: Route lead automatically
  const qualification = this.leadRoutingService.determineQualification(lead);

  if (qualification === LeadQualification.TRIAL) {
    // Option A: Auto-convert to TRIAL tenant immediately
    // await this.autoConvertToTrial(lead);

    // Option B: Mark as QUALIFIED (auto-convert ready)
    await this.leadsRepository.update(lead.id, {
      status: 'QUALIFIED',
      metadata: { routing: 'TRIAL_AUTO' }
    });
  } else if (qualification === LeadQualification.SALES_ASSISTED) {
    // Mark for sales team + high priority
    await this.leadsRepository.update(lead.id, {
      status: 'NEW',
      metadata: { routing: 'SALES_ASSISTED', priority: 'HIGH' }
    });

    // Notify sales team with high priority
    void this.slackNotificationService.notifyNewLead(lead, {
      priority: 'HIGH',
      routing: 'SALES_ASSISTED'
    });
  }

  return lead;
}
```

### Database Schema Addition

```prisma
model Lead {
  // Existing fields...

  // Routing metadata
  qualification: LeadQualification?  // TRIAL | SALES_ASSISTED | PREMIUM
  priority: LeadPriority?            // LOW | MEDIUM | HIGH | URGENT
  assignedToUserId: String?          // Sales agent ID if manually assigned
  routingReason: String?             // Why routed this way

  @@index([qualification])
  @@index([priority])
  @@index([assignedToUserId])
}

enum LeadQualification {
  TRIAL
  SALES_ASSISTED
  PREMIUM
}

enum LeadPriority {
  LOW
  MEDIUM
  HIGH
  URGENT
}
```

### Admin Dashboard Enhancement

```typescript
// New GET endpoint
GET /leads/admin?routing=SALES_ASSISTED&priority=HIGH

// List view with routing info
{
  id: 'lead_123',
  fullName: 'John Doe',
  email: 'john@...',
  qualification: 'SALES_ASSISTED',
  priority: 'HIGH',
  assignedToUserId: null,
  routingReason: 'Units > 100, ADMINISTRADORA type',
  createdAt: '...'
}
```

### Benefits
- ✅ Self-managed buildings get instant TRIAL (faster onboarding)
- ✅ Large accounts auto-routed to sales (better conversion)
- ✅ Priority system for sales team (focus on high-value)
- ✅ Metrics: Track conversion by routing path

### Configuration
```env
# Routing thresholds
LEAD_TRIAL_MIN_UNITS=10
LEAD_TRIAL_MAX_UNITS=100
LEAD_SALES_ASSISTED_MIN_UNITS=101
LEAD_PREMIUM_MIN_UNITS=500
```

### Estimated Impact
- **New Service**: LeadRoutingService
- **Schema Change**: 4 new fields
- **Migration**: +1 migration file
- **Tests**: +25 routing logic tests

---

## Enhancement 4: Enhanced Lead Tracking

**Priority**: LOW-MEDIUM (Phase 7+)
**Complexity**: 3/5 (4-6 hours)
**Rationale**: Better marketing attribution, lead quality scoring

### New Fields to Add

#### Campaign Tracking
```prisma
model Lead {
  // Existing...

  // UTM Parameters
  utm_source: String?      // google, facebook, email, etc.
  utm_medium: String?      // cpc, organic, referral, etc.
  utm_campaign: String?    // campaign-name
  utm_content: String?     // ad-variant
  utm_term: String?        // search-keyword

  // Traffic Source
  referrer: String?        // HTTP referrer header
  landingPage: String?     // /pricing, /features, etc.
  browserInfo: Json?       // { userAgent, language, ... }

  // Lead Quality Score
  qualityScore: Int?       // 0-100 (based on profile + behavior)
  scoreBreakdown: Json?    // { completeness: 80, engagement: 70, ... }

  @@index([utm_source])
  @@index([utm_campaign])
  @@index([qualityScore])
}
```

#### Frontend Tracking
```typescript
// capture-lead-form.component.ts
async submitLead(data) {
  // Capture browser/source data
  const leadData = {
    ...data,
    utm_source: new URLSearchParams(location.search).get('utm_source'),
    utm_medium: new URLSearchParams(location.search).get('utm_medium'),
    utm_campaign: new URLSearchParams(location.search).get('utm_campaign'),
    utm_content: new URLSearchParams(location.search).get('utm_content'),
    utm_term: new URLSearchParams(location.search).get('utm_term'),
    referrer: document.referrer,
    landingPage: location.pathname,
    browserInfo: {
      userAgent: navigator.userAgent,
      language: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    }
  };

  return this.leadsApi.submitLead(leadData);
}
```

#### Lead Scoring Service
```typescript
class LeadScoringService {
  calculateQualityScore(lead: Lead): number {
    let score = 0;

    // Completeness (max 30 points)
    score += this.scoreCompleteness(lead); // 0-30

    // Engagement (max 30 points)
    score += this.scoreEngagement(lead); // 0-30

    // Profile fit (max 25 points)
    score += this.scoreProfileFit(lead); // 0-25

    // Traffic source (max 15 points)
    score += this.scoreTrafficSource(lead); // 0-15

    return Math.min(score, 100);
  }

  private scoreCompleteness(lead): number {
    let points = 0;
    if (lead.fullName) points += 10;
    if (lead.email) points += 10;
    if (lead.phone) points += 10;
    return points;
  }

  private scoreEngagement(lead): number {
    // Message provided = interested
    if (lead.message?.length > 50) return 30;
    if (lead.message?.length > 0) return 15;
    return 0;
  }

  private scoreProfileFit(lead): number {
    // Larger properties = better fit
    if (lead.unitsEstimate > 500) return 25;
    if (lead.unitsEstimate > 100) return 20;
    if (lead.unitsEstimate > 50) return 15;
    if (lead.unitsEstimate > 10) return 10;
    return 5;
  }

  private scoreTrafficSource(lead): number {
    // Organic/referral better than ads
    if (lead.utm_medium === 'organic') return 15;
    if (lead.utm_source === 'referral') return 12;
    if (lead.utm_medium === 'email') return 10;
    return 0;
  }
}
```

### Admin Insights Dashboard

```typescript
// GET /leads/admin/analytics
{
  totalLeads: 450,
  bySource: {
    'google': 150,
    'facebook': 120,
    'referral': 100,
    'direct': 80
  },
  byQualityScore: {
    'HIGH': 120,      // >= 75
    'MEDIUM': 200,    // 50-74
    'LOW': 130        // < 50
  },
  conversionBySource: {
    'google': 0.18,
    'facebook': 0.12,
    'referral': 0.22,
    'direct': 0.15
  },
  topCampaigns: [
    { name: 'growth-2026-q1', leads: 80, conversion: 0.25 }
  ]
}
```

### Benefits
- ✅ Attribution: Track which marketing channels convert best
- ✅ Quality scoring: Focus sales efforts on high-potential leads
- ✅ Campaign ROI: Measure marketing spend effectiveness
- ✅ Sales prioritization: Automatic ranking by likelihood

### Estimated Impact
- **Schema**: 8 new fields + migration
- **Frontend**: +50 lines (UTM capture)
- **Service**: LeadScoringService (~150 lines)
- **API**: Analytics endpoint
- **Tests**: +15 tests

---

## Priority Matrix

| Feature | Priority | Complexity | Benefit | Phase Target |
|---------|----------|-----------|---------|--------------|
| Repository Pattern | MEDIUM | 3/5 | Better architecture | 5-6 |
| Slack Notifications | HIGH | 2/5 | Sales visibility | 5 |
| Lead Routing | MEDIUM-HIGH | 4/5 | Higher conversion | 6 |
| Enhanced Tracking | LOW-MEDIUM | 3/5 | Marketing insights | 7+ |

---

## Recommended Implementation Order

1. **Phase 5**: Slack Notifications
   - Quick win (2-5 hours)
   - Immediate ROI (sales team visibility)
   - No schema changes needed

2. **Phase 5-6**: Repository Pattern
   - Improve code quality
   - Foundation for future enhancements
   - No user-facing changes

3. **Phase 6**: Lead Routing
   - Auto-qualify TRIAL leads
   - Route high-value to sales
   - Measurable impact on conversion

4. **Phase 7+**: Enhanced Tracking
   - Marketing analytics
   - Quality scoring
   - Optimizations based on data

---

## Blockers for RC (Release Candidate)

✅ NONE - Fase 4 is complete and production-ready
All enhancements are OPTIONAL and don't block the RC.

---

## Decision: Should these be implemented before RC?

**RECOMMENDATION**: NO

**Reasons**:
1. MVP is production-ready with current feature set
2. Enhancements are nice-to-have, not critical
3. Sales team can manage leads manually via admin UI
4. Can measure impact of MVP before expanding
5. Better to iterate based on real usage data

**Proceed with**: Release Phase 4 MVP now, gather feedback, prioritize enhancements for Phase 5-6.

---

## Questions for Product Team

1. Should TRIAL leads auto-convert or require manual confirmation?
2. What's the target for sales-assisted conversion rate?
3. Should lead scoring affect pricing or just routing?
4. Do we have Slack workspace setup ready?
5. Which marketing channels drive most leads currently?

---

## Document History

| Date | Author | Change |
|------|--------|--------|
| 2026-02-23 | Engineering | Initial backlog creation |

