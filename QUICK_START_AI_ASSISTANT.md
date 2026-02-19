# Quick Start: AI Assistant Widget Integration

## ⚡ TL;DR

AI Assistant is implemented and ready to use. Add the widget to your tenant layout in 2 minutes.

---

## 1️⃣ Add Widget to Tenant Layout

Edit: `apps/web/app/(tenant)/[tenantId]/layout.tsx`

```typescript
import { AssistantWidget } from '@/features/assistant';

export default function TenantLayout({ children, params }) {
  return (
    <div>
      {children}
      <AssistantWidget
        tenantId={params.tenantId}
        currentPage="dashboard"  // or use router.pathname
      />
    </div>
  );
}
```

That's it! ✅ Widget appears on all tenant pages.

---

## 2️⃣ Test It Out

1. Start dev server: `npm run dev`
2. Login to PRO or ENTERPRISE plan tenant
3. See floating chat button (bottom-right)
4. Click to open, type a question
5. Get MOCK response + suggested actions
6. Click action buttons to navigate

---

## 🎯 What It Does

```
User Types: "How many tickets do we have?"
        ↓
AI Assistant (MOCK):
  "You have 3 open tickets. View them to manage maintenance requests."
        ↓
Suggested Actions:
  [View Tickets] [View Payments]
        ↓
User clicks [View Tickets]
  → Navigates to tickets page
```

---

## 🔧 Configuration

Defaults already set in `.env`, no changes needed:

```bash
AI_PROVIDER=MOCK                    # Always works
AI_DAILY_LIMIT_PER_TENANT=100       # Limit per day
AI_MAX_TOKENS=500                   # For OpenAI (when implemented)
```

---

## 📋 Feature Availability by Plan

| Plan | Available | Daily Limit |
|------|-----------|-------------|
| FREE | ❌ | - |
| BASIC | ❌ | - |
| PRO | ✅ | 100 |
| ENTERPRISE | ✅ | 100 |

Free/Basic tenants see: "AI Assistant not available on your plan"

---

## 🚀 Switch Provider (Future)

When ready to use OpenAI:

1. Install `openai` package (if not already)
2. Implement `OpenAIProvider` in `assistant.service.ts`
3. Set environment:
   ```bash
   export AI_PROVIDER=OPENAI
   export OPENAI_API_KEY=sk-your-key-here
   ```
4. Restart server

That's it - no code changes needed, just env vars.

---

## 🧪 Test API Endpoint Directly

```bash
curl -X POST http://localhost:3000/api/tenants/xxx/assistant/xxx/chat \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "X-Tenant-Id: xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Show me my tickets",
    "page": "tickets",
    "buildingId": "yyy"
  }'

# Response:
# {
#   "answer": "You have 3 open tickets...",
#   "suggestedActions": [
#     {"type": "VIEW_TICKETS", "payload": {"buildingId": "yyy"}}
#   ]
# }
```

---

## 📊 Monitor Usage

Check database for AI usage:

```sql
-- Recent interactions
SELECT * FROM AiInteractionLog
ORDER BY createdAt DESC
LIMIT 10;

-- Rate limit status
SELECT tenantId, day, count
FROM TenantDailyAiUsage
WHERE day = '2026-02-18'
ORDER BY count DESC;

-- Audit trail
SELECT * FROM AuditLog
WHERE action = 'AI_INTERACTION'
ORDER BY createdAt DESC;
```

---

## 🔐 Security (Already Built In)

✅ Only PRO/ENTERPRISE tenants can use
✅ Rate limited to 100 calls/day per tenant
✅ Suggested actions filtered by user permissions
✅ Context validated (no cross-tenant access)
✅ Logged in audit trail
✅ Fire-and-forget (never blocks main request)

---

## 🐛 Troubleshooting

### Widget doesn't appear
- Check tenant plan is PRO or ENTERPRISE
- Check `tenantId` is passed correctly
- Check layout imports are correct

### Getting "Feature not available" error
- Tenant plan is FREE or BASIC
- Upgrade to PRO via: PATCH /super-admin/tenants/:id/subscription

### Getting "Daily limit exceeded"
- Tenant used 100 calls today
- Limit resets at midnight UTC
- Check TenantDailyAiUsage table

### No suggested actions appear
- User role might not have permission
- Operator role can't see DRAFT_COMMUNICATION
- RESIDENT can't see VIEW_PAYMENTS

---

## 📚 Learn More

- **Full Implementation**: See `AI_ASSISTANT_IMPLEMENTATION.md`
- **Architecture**: See `PHASE_11_AI_ASSISTANT_SUMMARY.md`
- **Security Review**: See `BILLING_TRANSFER_REVIEW.md`

---

## ✅ Checklist

- [ ] Add AssistantWidget to tenant layout
- [ ] Start dev server
- [ ] Login with PRO/ENTERPRISE tenant
- [ ] See chat widget (bottom-right)
- [ ] Type a question and get response
- [ ] Click suggested action button
- [ ] Verify navigation works
- [ ] Check AuditLog for AI_INTERACTION entries
- [ ] Celebrate! 🎉

---

**Status**: Ready to use
**Provider**: MOCK (development)
**Next**: OpenAI integration (when ready)
