# Feature Flags - Plan-Based Control

## Overview

Feature flags are controlled entirely by the BillingPlan configuration, not by hardcoded client types. This ensures:
- 🎯 No code duplication per client type
- 🔄 Easy plan changes without code deployment
- 🛡️ Backend-driven (frontend only reflects)

## Available Features

| Feature | Type | Plans |
|---------|------|-------|
| `canExportReports` | boolean | BASIC+, PRO, ENTERPRISE |
| `canBulkOperations` | boolean | PRO, ENTERPRISE |
| `supportLevel` | enum | COMMUNITY (FREE), EMAIL (BASIC), PRIORITY (PRO+) |

## Backend Usage

### 1. Check Features (Service Layer)

```typescript
import { PlanFeaturesService } from './plan-features.service';

export class ReportsService {
  constructor(
    private planFeatures: PlanFeaturesService,
    private prisma: PrismaService,
  ) {}

  async exportReport(tenantId: string, format: 'csv' | 'pdf') {
    // Check if tenant has export feature
    const hasFeature = await this.planFeatures.hasFeature(
      tenantId,
      'canExportReports'
    );

    if (!hasFeature) {
      throw new ForbiddenException(
        'Export feature not available on current plan'
      );
    }

    // Proceed with export
    return this.doExport(tenantId, format);
  }
}
```

### 2. Gate Endpoints (Controller Level)

```typescript
import { RequireFeature } from '@/billing/require-feature.guard';
import { RequireFeatureGuard } from '@/billing/require-feature.guard';

@Controller('reports')
export class ReportsController {
  @UseGuards(JwtAuthGuard, RequireFeatureGuard)
  @RequireFeature('canExportReports')
  @Post('export')
  async exportReports(
    @Request() req: RequestWithUser,
    @Body() dto: ExportReportDto,
  ) {
    // Automatically checked by guard - feature is available
    return this.reportsService.exportReport(req.user.tenantId, dto.format);
  }

  @UseGuards(JwtAuthGuard, RequireFeatureGuard)
  @RequireFeature('canBulkOperations')
  @Post('bulk-update')
  async bulkUpdate(
    @Request() req: RequestWithUser,
    @Body() dto: BulkUpdateDto,
  ) {
    return this.ticketsService.bulkUpdate(req.user.tenantId, dto);
  }
}
```

### 3. Expose Features in API

```
GET /auth/me/subscription
```

Response:
```json
{
  "subscription": {
    "tenantId": "abc123"
  },
  "features": {
    "canExportReports": true,
    "canBulkOperations": false,
    "supportLevel": "EMAIL"
  }
}
```

## Frontend Usage

### 1. Get Features (Hook)

```typescript
import { useSubscription, hasFeature } from '@/features/billing/hooks/useSubscription';

function MyComponent() {
  const { features, loading } = useSubscription();

  if (loading) return <div>Loading...</div>;

  if (hasFeature(features, 'canExportReports')) {
    return <ExportButton />;
  }

  return <p>Export feature not available on your plan</p>;
}
```

### 2. Gate Buttons (Built-in Component)

```typescript
import FeatureGatedButton from '@/features/billing/components/FeatureGatedButton';

function ReportPage() {
  const { features } = useSubscription();

  return (
    <FeatureGatedButton
      features={features}
      featureKey="canExportReports"
      requiredPlan="BASIC"
      onClick={handleExport}
      onUpgradeClick={() => navigate('/upgrade')}
    >
      Export Report
    </FeatureGatedButton>
  );
}
```

**Behavior:**
- ✅ Feature available → Button enabled, works normally
- ❌ Feature unavailable → Button disabled, shows tooltip "Available on BASIC plan"
- 📱 Click when unavailable → Modal explains requirement & upgrade CTA

### 3. Show/Hide Sections

```typescript
function Dashboard() {
  const { features } = useSubscription();

  return (
    <div>
      <h2>Main Dashboard</h2>

      {hasFeature(features, 'canBulkOperations') && (
        <BulkOperationsPanel />
      )}

      {hasFeature(features, 'supportLevel') && (
        <PrioritySupportSection />
      )}
    </div>
  );
}
```

## Error Handling

### Backend Error Format

When a feature is not available:

```json
{
  "statusCode": 403,
  "code": "FEATURE_NOT_AVAILABLE",
  "message": "Feature not available on current plan: canExportReports",
  "metadata": {
    "featureKey": "canExportReports",
    "requiredPlan": "BASIC"
  }
}
```

### Frontend Handling

The `FeatureUnavailableModal` component handles this automatically. For custom handling:

```typescript
try {
  await exportReport();
} catch (error) {
  if (error.response?.data?.code === 'FEATURE_NOT_AVAILABLE') {
    const { featureKey, requiredPlan } = error.response.data.metadata;
    showModal(`Upgrade to ${requiredPlan} to use ${featureKey}`);
  }
}
```

## Adding New Features

### 1. Add to BillingPlan Model (Prisma)

```prisma
model BillingPlan {
  // ... existing fields
  canYourNewFeature   Boolean @default(false)
}
```

Run migration:
```bash
npx prisma migrate dev --name add_can_your_new_feature
```

### 2. Update PlanFeatures Interface

```typescript
// plan-features.service.ts
export interface PlanFeatures {
  canExportReports: boolean;
  canBulkOperations: boolean;
  supportLevel: 'COMMUNITY' | 'EMAIL' | 'PRIORITY';
  canYourNewFeature: boolean;  // <- Add here
}
```

### 3. Extract in getTenantFeatures()

```typescript
return {
  canExportReports: subscription.plan.canExportReports ?? false,
  canBulkOperations: subscription.plan.canBulkOperations ?? false,
  supportLevel: (subscription.plan.supportLevel as any) ?? 'COMMUNITY',
  canYourNewFeature: subscription.plan.canYourNewFeature ?? false,  // <- Add here
};
```

### 4. Gate the Endpoint

```typescript
@UseGuards(JwtAuthGuard, RequireFeatureGuard)
@RequireFeature('canYourNewFeature')
@Post('new-feature')
async newFeature(...) { ... }
```

### 5. Update Frontend

```typescript
const { features } = useSubscription();

if (hasFeature(features, 'canYourNewFeature')) {
  // Show/enable feature
}
```

## Testing

### Manual Testing: Verify Feature Blocking

1. Create a FREE plan tenant (maxBuildings=1)
2. Attempt to export reports → Should be blocked with 403
3. Check `/auth/me/subscription` → `canExportReports: false`
4. In UI, export button should be disabled

### Unit Test Example

```typescript
describe('PlanFeaturesService', () => {
  it('should return correct features for plan', async () => {
    const features = await service.getTenantFeatures(tenantId);

    expect(features.canExportReports).toBe(true);  // PRO plan has this
    expect(features.canBulkOperations).toBe(true);
    expect(features.supportLevel).toBe('PRIORITY');
  });

  it('should deny unavailable features', async () => {
    const hasFeature = await service.hasFeature(
      freetenantId,
      'canBulkOperations'
    );

    expect(hasFeature).toBe(false);
  });
});
```

## Security Notes

🛡️ **Backend is the source of truth**
- Frontend can be spoofed/tampered with
- Backend guard (`RequireFeatureGuard`) enforces all checks
- Never trust frontend to enforce permissions

🛡️ **Feature flags are not secrets**
- Exposing them in `/auth/me/subscription` is intentional
- They determine UI behavior, not security
- Real authorization checks happen on backend

## Best Practices

✅ **DO:**
- Use `@RequireFeature` decorator on all protected endpoints
- Always check features in backend service before operations
- Show disabled UI when feature unavailable (better UX)
- Log feature usage for analytics

❌ **DON'T:**
- Hardcode plans in code (e.g., `if (planType === 'PRO')`)
- Trust frontend feature checks for authorization
- Expose other plan fields (like pricing) in features endpoint
- Add features without updating both backend + frontend

