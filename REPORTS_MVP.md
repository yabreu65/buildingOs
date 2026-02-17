# Reports MVP - Specification

## Overview

Reports MVP provides admin users (TENANT_ADMIN, TENANT_OWNER, OPERATOR) with basic operational visibility through 4 aggregation endpoints and a responsive UI with KPI cards and detailed tables.

**RESIDENT users** are blocked from accessing reports (403 Forbidden).

---

## What's Included ✅

### Backend (4 REST Endpoints)

All endpoints follow the pattern: `GET /tenants/:tenantId/reports/<type>`

With optional query params:
- `buildingId` (optional) - filters to specific building; omit for tenant-wide
- `from`, `to` (optional) - date range filters (ISO 8601 format)
- `period` (optional) - finance period filter (YYYY-MM format)

#### 1. Tickets Report
**Endpoint**: `GET /tenants/:tenantId/reports/tickets?buildingId&from&to`

Returns:
```json
{
  "byStatus": [
    { "status": "OPEN", "count": 5 },
    { "status": "IN_PROGRESS", "count": 3 },
    { "status": "RESOLVED", "count": 8 },
    { "status": "CLOSED", "count": 2 }
  ],
  "byPriority": [
    { "priority": "LOW", "count": 3 },
    { "priority": "MEDIUM", "count": 10 },
    { "priority": "HIGH", "count": 4 },
    { "priority": "URGENT", "count": 1 }
  ],
  "topCategories": [
    { "category": "Maintenance", "count": 8 },
    { "category": "Cleaning", "count": 4 },
    { "category": "Repairs", "count": 3 },
    { "category": "Other", "count": 2 },
    { "category": "Complaint", "count": 1 }
  ],
  "avgTimeToFirstResponseHours": 4,
  "avgTimeToResolveHours": 24
}
```

**Metrics**:
- `byStatus` / `byPriority` / `topCategories`: Filtered by date range
- `avgTimeToFirstResponseHours`: Average time from ticket creation to first comment (hours)
- `avgTimeToResolveHours`: Average time from ticket creation to closedAt (hours, only tickets with closedAt)
- **Note**: Only tickets with `closedAt !== null` count towards resolution time

#### 2. Finance Report
**Endpoint**: `GET /tenants/:tenantId/reports/finance?buildingId&period`

Returns:
```json
{
  "totalCharges": 150000,
  "totalPaid": 80000,
  "totalOutstanding": 70000,
  "delinquentUnitsCount": 3,
  "delinquentUnits": [
    { "unitId": "unit-1", "outstanding": 35000 },
    { "unitId": "unit-2", "outstanding": 20000 },
    { "unitId": "unit-3", "outstanding": 15000 }
  ],
  "collectionRate": 53,
  "currency": "ARS"
}
```

**Metrics** (all in cents):
- `totalCharges`: Sum of all non-canceled charges
- `totalPaid`: Sum of amounts from APPROVED payments only
- `totalOutstanding`: totalCharges - totalPaid
- `delinquentUnitsCount`: Count of unique units with PENDING/PARTIAL charges + dueDate < now
- `delinquentUnits`: Top 10 delinquent units, sorted by outstanding desc
- `collectionRate`: Percentage (0-100) = (totalPaid / totalCharges) * 100

**Note**: Only APPROVED payment allocations count toward totalPaid (same logic as finanzas.service.ts)

#### 3. Communications Report
**Endpoint**: `GET /tenants/:tenantId/reports/communications?buildingId&from&to`

Returns:
```json
{
  "totalRecipients": 450,
  "totalRead": 320,
  "readRate": 71,
  "byChannel": [
    { "channel": "EMAIL", "sent": 3, "read": 3, "readRate": 100 },
    { "channel": "SMS", "sent": 2, "read": 1, "readRate": 50 },
    { "channel": "PUSH", "sent": 1, "read": 0, "readRate": 0 }
  ]
}
```

**Metrics**:
- `totalRecipients`: Sum of receipts.length across all communications with status='SENT'
- `totalRead`: Count of receipts where readAt !== null
- `readRate`: Percentage = (totalRead / totalRecipients) * 100
- `byChannel`: Breakdown by channel with per-channel read rates
- **Note**: Only communications with status='SENT' (uses sentAt for date filter, NOT createdAt)

#### 4. Activity Report
**Endpoint**: `GET /tenants/:tenantId/reports/activity?buildingId&from&to`

Returns:
```json
{
  "ticketsCreated": 18,
  "paymentsSubmitted": 12,
  "documentsUploaded": 45,
  "communicationsSent": 6
}
```

**Metrics** (all event counts with date filtering):
- `ticketsCreated`: COUNT of tickets (uses createdAt for date filter)
- `paymentsSubmitted`: COUNT of payments (uses createdAt for date filter)
- `documentsUploaded`: COUNT of documents (uses createdAt for date filter)
- `communicationsSent`: COUNT of communications where status='SENT' (uses sentAt for date filter)

---

### Frontend

#### Two Pages
1. **Tenant-level Reports** (`[tenantId]/reports/page.tsx`)
   - Building selector dropdown ("Todos" = tenant-wide)
   - Date range filters
   - 4 lazy-loaded tabs (only fetch active tab)

2. **Building-level Reports** (`[tenantId]/buildings/[buildingId]/reports/page.tsx`)
   - Building ID pre-set (locked in URL)
   - Date range filters only
   - 4 lazy-loaded tabs

#### Lazy Loading
- Reports only fetch when their tab becomes active
- `useTicketsReport(tenantId only if tab active)` prevents spinner when inactive
- Each hook: `const hook = useTicketsReport(activeTab === 'tickets' ? tenantId : undefined)`

#### Components
- **ReportFilters**: Building selector + date range + period input + Apply button
- **TicketsReportComponent**: 2 KPI cards + 3 tables (status, priority, categories)
- **FinanceReportComponent**: 4 KPI cards + delinquent units table
- **CommunicationsReportComponent**: 3 KPI cards + by-channel table
- **ActivityReportComponent**: 4 KPI cards (no tables)

#### Navigation
- Sidebar: "Reportes" link → tenant-level reports
- BuildingSubnav: "Reportes" tab → building-level reports
- All amounts displayed in ARS with proper formatting (÷100 for cents → display)

---

## What's NOT Included ❌

### Out of Scope (Future Phases)

1. **Export/Download**: PDF, CSV, or Excel exports not included
2. **Scheduling**: No automated report delivery or scheduling
3. **Custom Dashboards**: No user-configurable report layouts
4. **Advanced Filters**: Only basic date range and building selection
5. **Historical Trends**: No time-series charts or trend analysis
6. **Drill-Down**: Cannot navigate from summary to detail (different page context)
7. **Real-time Updates**: Reports are point-in-time snapshots, no WebSocket updates
8. **Audit Trail**: Report views are not logged
9. **Share/Collaborate**: No report sharing or comment functionality
10. **BI Integration**: No connection to external BI tools or data warehouses

---

## Security

### Access Control
- **TENANT_ADMIN**, **TENANT_OWNER**, **OPERATOR** → Full access
- **RESIDENT** → 403 Forbidden
- Multi-tenant isolation enforced at backend (TenantAccessGuard + validateBuildingScope)

### Data Filtering
- All aggregations filtered by tenantId (from JWT)
- buildingId param validated to belong to tenant
- Cross-tenant = 404 (info leakage prevented)
- Cross-building = 404 (same)

### No Info Leakage
- Invalid tenantId → 404 (not "you don't have access")
- Invalid buildingId → 404 (not "building not found")
- Consistent error handling prevents enumeration

---

## Implementation Details

### Finance Report Formula
```
totalPaid = SUM(allocation.amount) WHERE payment.status = 'APPROVED'
totalOutstanding = totalCharges - totalPaid
delinquent = charges WHERE (status IN [PENDING, PARTIAL]) AND (dueDate < now)
```

### Tickets Time Metrics
```
avgTimeToFirstResponse = AVG(firstComment.createdAt - ticket.createdAt)
avgTimeToResolve = AVG(ticket.closedAt - ticket.createdAt) WHERE closedAt IS NOT NULL
```

### Communications Read Rate
```
readRate = (COUNT(receipts WHERE readAt IS NOT NULL) / COUNT(receipts)) * 100
byChannel.readRate = same formula PER CHANNEL
```

---

## Testing Notes

### Manual Test Scenarios

1. **Tenant-wide Reports**
   - Admin: Click Reportes in sidebar → see all buildings data
   - Select building → drill into that building
   - Change date range → data updates

2. **Building-level Reports**
   - From Building Overview → click Reportes tab → see that building only
   - Building selector is hidden
   - Date filters work independently

3. **Finance Report**
   - Verify totalPaid only counts APPROVED payments
   - Verify delinquent = PENDING/PARTIAL charges + dueDate in past
   - Test with no data → "No delinquent units" message

4. **Lazy Loading**
   - Load page with Finance tab active
   - See Tickets tab doesn't show spinner (not loaded)
   - Click Tickets tab → loads immediately
   - Toggle tabs rapidly → only active tab spins

5. **Permissions**
   - RESIDENT user → 403 Forbidden when trying to access `/reports`
   - OPERATOR user → Full access to all 4 reports

---

## File Structure

```
apps/api/src/reports/
  ├── reports.module.ts        (imports TenancyModule for TenantAccessGuard)
  ├── reports.validators.ts    (canReadReports, validateBuildingScope, parseDate)
  ├── reports.service.ts       (4 methods: getTicketsReport, getFinanceReport, etc.)
  └── reports.controller.ts    (4 GET endpoints)

apps/web/features/reports/
  ├── services/
  │   └── reports.api.ts       (4 fetch functions + type definitions)
  ├── hooks/
  │   ├── useTicketsReport.ts  (lazy-loading hook)
  │   ├── useFinanceReport.ts
  │   ├── useCommunicationsReport.ts
  │   └── useActivityReport.ts
  └── components/
      ├── ReportFilters.tsx         (building selector + date range)
      ├── TicketsReport.tsx         (KPI + status/priority/categories tables)
      ├── FinanceReport.tsx         (KPI + delinquent units table)
      ├── CommunicationsReport.tsx  (KPI + by-channel table)
      └── ActivityReport.tsx        (4 KPI cards)

apps/web/app/(tenant)/[tenantId]/
  └── reports/page.tsx         (tenant-level: all buildings, building selector)

apps/web/app/(tenant)/[tenantId]/buildings/[buildingId]/
  └── reports/page.tsx         (building-level: single building, date filters)

Navigation Updates:
  - Sidebar.tsx: "Reportes" link
  - BuildingSubnav.tsx: "Reportes" tab
  - routes.ts: tenantReports(), buildingReports()
```

---

## Acceptance Criteria Verification

| Criteria | Implementation |
|----------|-----------------|
| Admins see reports by building AND tenant | buildingId optional; omit = tenant-wide + building selector on tenant page |
| Totals consistent with real data | Same Prisma queries as finanzas + tickets services (no drift) |
| No cross-tenant access | TenantAccessGuard param + validateBuildingScope service method |
| Refresh works, no localStorage | All hooks fetch from API; zero localStorage dependency |
| RESIDENT blocked | validators.canReadReports() enforces TENANT_ADMIN/OWNER/OPERATOR only |
| Lazy loading works | Hooks only fetch when tenantId provided (only when tab active) |
| Finance shows delinquent properly | Filters PENDING/PARTIAL + dueDate < now; groups by unitId |
| Communications filters SENT only | Uses status='SENT' + sentAt for date range (not createdAt) |
| Responsive design | Grid layout 1 col mobile → 3-4 cols desktop |

---

## Known Limitations

1. **No Pagination**: If 1000+ delinquent units, all returned (no limit in API)
   - **Mitigation**: Front-end could add `.slice(0, 100)` before display
   - **Future**: Add `limit` param to API if needed

2. **No Caching**: Each report fetch hits database directly
   - **Mitigation**: Client-side React state prevents rapid refetch
   - **Future**: Add Redis caching if reports slow down

3. **No Offline Support**: Reports require API connectivity
   - **Mitigation**: Error state shows message + retry button
   - **Future**: Service worker caching of last successful response

4. **Date Range Not Validated**: Invalid dates silently ignored
   - **Mitigation**: HTML5 date input prevents most invalid input
   - **Future**: Add backend validation with 400 response

---

## Future Enhancements (Not MVP)

- [ ] Export to PDF/CSV
- [ ] Scheduled email delivery
- [ ] Custom date presets (Last 7 days, This month, This quarter)
- [ ] Trend charts and time-series analysis
- [ ] Drill-down to detail pages (click unit → see invoices)
- [ ] Comparison (month-over-month, year-over-year)
- [ ] Custom fields and formulas
- [ ] Audit trail of who viewed reports when
- [ ] Share report snapshots with external stakeholders
