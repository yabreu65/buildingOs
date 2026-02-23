# 📋 PILOT SLA - Service Level Agreement for First Customer

**Effective Date**: March 1, 2026
**Pilot Duration**: 90 days (March - May 2026)
**Status**: 🟢 **INTERNAL SLA - FIRST CUSTOMER PHASE**

---

## Executive Summary

This SLA defines the service level **we commit to internally** during the Pilot phase with the first customer. It balances reliability with realism for an early-stage product.

**Key Commitment**: If something breaks, we have procedures (documented in PILOT_CHECKLIST.md) to fix it or recover data within defined time windows.

---

# 1. UPTIME & AVAILABILITY TARGETS

## 1.1 Target Uptime

| Environment | Target | Acceptable Downtime/Month |
|-------------|--------|--------------------------|
| **Staging** | 95% | 36 hours |
| **Production** | 99% | 7.2 hours (~440 min) |

## 1.2 What Counts as "Down"

```
API is DOWN if:
- HTTP 500/502/503 responses for >2 consecutive minutes
- /health endpoint returns non-200 for >2 consecutive minutes
- Database connection completely unavailable

Web is DOWN if:
- Cannot load home page (localhost:3000)
- All pages returning error for >2 consecutive minutes

NOT counted as down:
- Single failed request (network glitch)
- Performance degradation (slow, but working)
- Planned maintenance with 24h+ notice
```

## 1.3 Maintenance Windows (Excluded from SLA)

```
Planned Maintenance:
- Tuesday: 02:00-03:00 UTC (1 hour)
- Customer will be notified 48 hours in advance

Emergency Maintenance:
- Excluded if duration <15 minutes
- Excluded if no reasonable alternative existed
- Customer will be notified immediately
```

---

# 2. RESPONSE TIME TARGETS

## 2.1 API Response Times

| Endpoint | Target | Acceptable |
|----------|--------|-----------|
| GET /buildings | <500ms (p95) | <1000ms |
| GET /units | <500ms (p95) | <1000ms |
| POST /tickets | <1000ms (p95) | <2000ms |
| GET /buildings?filter... | <2000ms (p95) | <5000ms |

**p95 = 95% of requests must be faster than this time**

## 2.2 Email Delivery Time

| Email Type | Target | Acceptable |
|------------|--------|-----------|
| Invitation email | <5 minutes | <15 minutes |
| Ticket notification | <2 minutes | <10 minutes |
| Password reset | <5 minutes | <15 minutes |

---

# 3. ERROR RATE TARGETS

## 3.1 Acceptable Error Rates

```
Critical Errors (5xx):
- Baseline: <0.1% of requests
- Alert threshold: >1% of requests for 5+ min
- Action: Page on-call engineer immediately

4xx Errors (User errors, 404s, 401s):
- Baseline: <5% of requests
- No alert needed (normal operation)

Slow Queries (>2000ms):
- Baseline: <1% of requests
- Alert threshold: >5% of requests
```

---

# 4. DATA PROTECTION TARGETS

## 4.1 Backup Frequency & Recovery

| Aspect | Target |
|--------|--------|
| Backup frequency | Daily (02:00 UTC) |
| Backup retention | 28 days (4 weeks) |
| Recovery Time Objective (RTO) | <1 hour |
| Recovery Point Objective (RPO) | <24 hours |
| Off-site backup | S3 (same-region) |

**Meaning**:
- RTO <1h: Can recover data within 1 hour
- RPO <24h: Maximum data loss = last 24h of transactions

## 4.2 Data Integrity

```
No acceptable data loss during:
- Normal operations ✅
- API restarts ✅
- Database restarts ✅
- Planned migrations ✅

Some data loss acceptable only during:
- Disaster recovery (rare)
- Customer's explicit action (delete, export)
```

---

# 5. SUPPORT CHANNELS & RESPONSE TIMES

## 5.1 Communication Channels

| Channel | Purpose | Response Target |
|---------|---------|-----------------|
| **Email** | bug reports, feature requests | 8 business hours |
| **WhatsApp** | urgent issues | 15 minutes (business hours) |
| **Slack** | non-urgent questions | 1 hour |
| **Phone** | critical emergencies (P1) | Immediate (on-call) |

**Business Hours**: Monday-Friday, 09:00-18:00 UTC
**Off-Hours Support**: On-call rotation (P1 only)

## 5.2 Severity Levels & Response Times

### P1 - CRITICAL (System Down / Data Corruption)

```
Definition:
- Entire service unavailable
- Data corruption detected
- Security breach suspected
- Affects ALL users

Response time: IMMEDIATE (phone call within 5 min)
Who: On-call engineer (paged immediately)
Status: Every 15 minutes
Resolution target: <2 hours
```

**Examples**:
- API crashing on every request
- Unable to create/edit buildings (core feature)
- Customer reports losing all data
- Security: Unauthorized access to customer data

**Response**: Call on-call engineer immediately. Do NOT wait for email.

### P2 - HIGH (Feature Broken / Service Degraded)

```
Definition:
- Specific feature not working
- 50%+ of users affected
- Significant performance degradation
- Workaround available

Response time: 15 minutes (business hours)
Response time: 1 hour (off-hours)
Who: Lead engineer
Status: Every 30 minutes
Resolution target: <4 hours
```

**Examples**:
- Unit creation not working
- Tickets page extremely slow (>5 sec load)
- Email invitations not sending
- One user cannot log in

**Response**: Email or Slack immediately. Acknowledge within 15 min.

### P3 - MEDIUM (Partial Issue / Workaround Exists)

```
Definition:
- Specific user or small group affected (<10% users)
- Workaround exists
- Non-critical feature

Response time: 1 hour (business hours)
Response time: Next business day (off-hours)
Who: Support team or engineer
Status: Daily update
Resolution target: <1 week
```

**Examples**:
- Report function not exporting to PDF
- Comments section formatting odd
- Mobile view of one page broken
- One customer cannot upload files (but can copy-paste data)

**Response**: Email within 1 hour during business hours.

### P4 - LOW (Enhancement / Non-Breaking Bug)

```
Definition:
- Feature request
- UI/UX improvement
- Minor bug, no workaround needed

Response time: 24 hours
Who: Product team
Status: Weekly update
Resolution target: Next sprint
```

**Examples**:
- "Can we make this button bigger?"
- "Typo in email template"
- "Button color seems wrong"

**Response**: Add to backlog, no immediate response required.

---

## 5.3 On-Call Schedule (First Customer Phase)

```
Primary On-Call:    Lead Engineer (Engineer 1)
    Monday-Friday:  09:00-18:00 UTC (business hours)
    Weekends:       24 hours (all day)

Backup On-Call:     Engineer 2
    Monday-Friday:  18:00-09:00 UTC (off-hours)
    Weekends:       24 hours (all day)

Rotation:           Weekly (every Monday)

Contact methods:
- WhatsApp: +1-555-BUILD-OS (primary for P1)
- Phone: +1-555-BUILD-OS (call, then leave voicemail)
- Email: oncall@buildingos.internal (backup)

Response target:    Answer within 5 minutes for P1
```

---

# 6. ESCALATION PROCEDURES

## 6.1 Escalation Path

```
Customer Issue
     ↓
Support team receives (Email/Slack)
     ↓
Classify severity (P1/P2/P3/P4)
     ↓

If P1:
  → Immediately call on-call engineer
  → Post to #incidents on Slack
  → Page backup engineer if on-call doesn't respond in 5 min
  → Notify manager

If P2:
  → Page lead engineer (if after hours)
  → Email team during business hours
  → Update #incidents channel

If P3/P4:
  → Email support queue
  → Add to backlog
  → No escalation needed
```

## 6.2 Escalation Contact Tree

```
LEAD ENGINEER (Primary)
├─ WhatsApp: +1-555-BUILD-OS
├─ Phone: +1-555-BUILD-01
└─ Email: lead@buildingos.internal

BACKUP ENGINEER
├─ WhatsApp: +1-555-BUILD-02
├─ Phone: +1-555-BUILD-02
└─ Email: backup@buildingos.internal

MANAGER (if both unavailable)
├─ WhatsApp: +1-555-BUILD-MGR
├─ Phone: +1-555-BUILD-MGR
└─ Email: manager@buildingos.internal
```

---

# 7. KNOWN LIMITATIONS (Explicitly Allowed)

These issues are **expected in Pilot phase** and do NOT count as SLA violations:

```
✅ Allowed limitations:

1. Occasional UI quirks or missing polish
2. Email delivery >5 min if mail provider is slow
3. First-time user confusion (no built-in tutorial yet)
4. Some advanced features not working (documented)
5. Performance not optimized for 100K+ units (MVP supports ~1K units)
6. Reports/analytics limited (basic stats only)
7. No bulk operations yet (manual per-item)
8. Export formats limited (CSV only, no Excel)
9. No multi-language support (English only)
10. Minimal mobile optimization (desktop-first)

❌ NOT allowed (actual SLA violations):

1. Data loss or corruption
2. Cross-tenant data leakage
3. Security vulnerabilities
4. Authentication broken
5. Core features completely unavailable (buildings, units, tickets)
6. Unauthorized access to customer data
7. Repeated downtime >1 hour/month
```

---

# 8. PERFORMANCE MONITORING & ALERTING

## 8.1 Monitoring Infrastructure

```
What we monitor:

1. API Health
   - /health endpoint (every 30 seconds)
   - /readyz endpoint (every 30 seconds)
   - Response time distribution (p50, p95, p99)

2. Infrastructure
   - CPU usage (alert if >80%)
   - Memory usage (alert if >85%)
   - Disk usage (alert if >90%)
   - Network throughput

3. Application Errors
   - Error rate (alert if >1%)
   - Sentry error tracking
   - Database connection errors
   - Auth failures

4. Database
   - Query performance (slow query log)
   - Connection pool usage
   - Replication lag (if applicable)

5. Business Metrics
   - Requests per second
   - Unique users per day
   - Failed transactions

Monitoring Tool: Sentry + CloudWatch (or similar)
Update Frequency: Real-time (every 30 seconds)
Alerting: PagerDuty or VictorOps
```

## 8.2 Alert Thresholds

| Metric | Threshold | Severity |
|--------|-----------|----------|
| API health endpoint fails | 2 min | P1 - Page on-call immediately |
| Error rate >1% | 5 consecutive min | P1 - Page on-call |
| Response time p95 >2 sec | 10 consecutive min | P2 - Email lead |
| CPU >85% | 5 consecutive min | P2 - Email lead |
| Memory >90% | Immediate | P1 - Page on-call |
| Disk >95% | Immediate | P1 - Page on-call |
| Database down | Immediate | P1 - Page on-call |

## 8.3 Dashboard Access

```
Who can access monitoring dashboard:
- Lead engineer (always)
- On-call engineer (during shift)
- Manager (for reviews)

Dashboard location:
- Sentry: https://sentry.io/organizations/buildingos/
- CloudWatch: https://console.aws.amazon.com/cloudwatch/
- Uptime: https://status.buildingos.io (if you have one)

Dashboard should show:
- Current status (green/yellow/red)
- Error rate (last 1 hour)
- Response times (p50, p95, p99)
- Active users
- Database status
```

---

# 9. MAINTENANCE WINDOW SCHEDULE

## 9.1 Regular Maintenance Windows

```
Maintenance Windows (No SLA guarantee during these):

Tuesday, 02:00-03:00 UTC
├─ Purpose: Database backups, cleanup scripts
├─ Downtime: Expected <5 minutes
├─ Notification: 48 hours in advance (email + in-app)
└─ Frequency: Weekly

First Wednesday of month, 03:00-04:00 UTC
├─ Purpose: Security patches, package updates
├─ Downtime: Expected <15 minutes
├─ Notification: 1 week in advance
└─ Frequency: Monthly

Third Thursday of quarter, 04:00-06:00 UTC
├─ Purpose: Major migrations, infrastructure upgrades
├─ Downtime: Expected <30 minutes (or more, if needed)
├─ Notification: 2 weeks in advance
└─ Frequency: Quarterly
```

## 9.2 Emergency Maintenance (No Advance Notice)

```
Can happen without SLA impact if:
- Duration <15 minutes
- Response to critical security issue
- Response to data corruption
- No reasonable scheduled window existed

Will always have notice if:
- Routine updates
- Performance improvements
- Feature deployments
```

---

# 10. SLA CREDITS (If Violated)

## 10.1 Service Credits for Downtime

If we fail to meet SLA targets, customer receives:

```
Uptime Achieved  | Credit | Form |
-----------------|--------|------|
98% - 99%        | 5%     | Account credit (next month) |
95% - 98%        | 10%    | Account credit or cash refund |
<95%             | 25%    | Account credit + call |

Example:
- Monthly service cost: $500
- Uptime: 97% (fell below 99% target)
- Credit: 10% = $50 off next month

How to claim:
1. Email support@buildingos.com with evidence (logs/metrics)
2. Must claim within 30 days
3. We verify and apply credit within 5 days
```

## 10.2 What Does NOT Entitle Customer to Credits

```
❌ NOT covered by SLA:

- Issues caused by customer (wrong config, deleted data)
- Issues in customer's network (ISP down, DNS failure)
- Maintenance windows we announced 48h+ in advance
- Issues in 3rd party services (email provider, payment processor)
- Force majeure (natural disaster, war, etc.)
- Issues caused by customer's own integrations/plugins
```

---

# 11. CONTINUOUS IMPROVEMENT

## 11.1 Post-Incident Reviews

```
Every incident (P1, P2, or major P3) gets:

1. Root cause analysis (within 24 hours)
   - What went wrong?
   - Why did it happen?
   - Why didn't we catch it earlier?

2. Action items to prevent recurrence
   - Code fix?
   - Monitoring gap?
   - Documentation missing?

3. Timeline documented in PILOT_CHECKLIST.md

4. Customer notified (what happened, what we're doing)
```

## 11.2 Monthly SLA Review

```
First week of each month:

1. Calculate uptime for previous month
2. Review all incidents
3. Trend analysis (improving or degrading?)
4. Share with customer (transparency)
5. Update alerts/monitoring if needed
6. Plan improvements for next month
```

## 11.3 90-Day Pilot Review

```
At end of pilot (May 31, 2026):

1. Final statistics
   - Total uptime: target 99.5%
   - Total incidents: target <5
   - Average resolution time: target <2 hours (P1/P2)

2. Customer feedback
   - How was our response time?
   - How was our communication?
   - What can we improve?

3. Lessons learned
   - What worked well?
   - What was hard?
   - What needs to change for next customer?

4. Transition to next phase
   - Continue same SLA?
   - Add more customers?
   - Improve infrastructure?
```

---

# 12. CUSTOMER NOTIFICATION & COMMUNICATION

## 12.1 Proactive Status Updates

```
During Incidents:

First notification (within 5 min):
  Subject: "⚠️  Issue detected - investigating"
  Content: What we know, what we're doing, next update time

Updates (every 15 min during P1, 30 min during P2):
  Subject: "🔧 Update: Still investigating"
  Content: Progress, estimated time, actions taken

Resolution (immediately when fixed):
  Subject: "✅ Resolved - Details"
  Content: What happened, impact, prevention plans
  Include: Root cause summary, timeline, how to avoid

Post-incident (within 24 hours):
  Subject: "📋 Post-Incident Review"
  Content: Full timeline, root cause, actions to prevent
```

## 12.2 Communication Preferences

```
Ask customer:
- Preferred notification channel (email, SMS, phone call)?
- Who should be notified (just tech lead, or multiple people)?
- Do you want detailed technical info, or simplified version?
- Office hours for notifications (don't call at 3am unless P1)?
```

## 12.3 Status Page

```
If customer-facing status page exists:
- https://status.buildingos.io (example)

Shows:
- Current status (green = all good, yellow = issues, red = down)
- Recent incidents (last 90 days)
- Uptime graph (last 30 days)
- Maintenance schedule

Updated:
- Every 5 minutes (automated)
- Immediately when status changes
```

---

# 13. ESCALATION SCENARIOS (Examples)

## Scenario 1: Customer Can't Create Units

**Customer reports** (via email, 10:00 UTC):
> "I can't create units in my building. Getting error 500."

**Severity**: P2 (high - core feature broken)

**Response path**:
- 10:03 - Support receives, classifies as P2
- 10:05 - Posts to #incidents channel on Slack
- 10:05 - Emails lead engineer
- 10:15 - Lead engineer acknowledges
- 10:20 - Lead engineer finds bug in units service
- 10:30 - Fix deployed
- 10:35 - Customer notified "Issue resolved, please try again"
- 10:40 - Customer confirms working
- Next day - Post-incident review done

**Total resolution time**: 40 minutes ✅ (target: <4 hours)

---

## Scenario 2: Database Crashes at 2am

**Monitoring detects** (02:15 UTC):
> "Database connection failed. 0 successful connections in 5 min."

**Severity**: P1 (critical - system down)

**Response path**:
- 02:15 - Alert triggered in PagerDuty
- 02:18 - On-call engineer paged (WhatsApp + phone call)
- 02:22 - On-call engineer answers phone
- 02:25 - On-call logs into production, checks database
- 02:28 - Finds disk full (backups taking all space)
- 02:30 - Deletes old backups, restarts database
- 02:35 - Database comes back up, health check passes
- 02:35 - Slack notification: "Database recovered, all systems normal"
- 02:40 - API monitoring confirms all green
- Next morning - Full post-incident review

**Total resolution time**: 25 minutes ✅ (target: <2 hours)

---

## Scenario 3: Customer Forgot Password

**Customer reports** (via WhatsApp, 14:45 UTC):
> "I'm locked out, need to reset password"

**Severity**: P3 (medium - workaround exists, just annoying)

**Response path**:
- 14:50 - Support team receives
- 14:52 - Support team checks if password reset email exists
- 14:55 - Password reset link sent to customer
- 15:00 - Customer receives email, resets password
- 15:05 - Customer confirms access working
- 15:10 - Support team closes ticket

**Total resolution time**: 25 minutes ✅ (target: <1 week, priority on self-service)

---

# 14. FINAL CHECKLIST (Before Pilot Launch)

**Before going live with first customer, verify:**

- [ ] SLA document reviewed and approved by team
- [ ] Customer has reviewed and agreed to SLA
- [ ] On-call rotation defined (who's on-call this week?)
- [ ] On-call contacts posted in Slack, email, shared doc
- [ ] Monitoring/alerting configured and tested
- [ ] Alert thresholds set correctly (no false positives)
- [ ] Dashboard access granted to all on-call engineers
- [ ] Escalation procedures known by all team members
- [ ] Communication templates prepared (draft incident emails)
- [ ] Backup/restore procedures tested (see PILOT_CHECKLIST.md)
- [ ] Status page exists and is automated
- [ ] Post-incident review template created
- [ ] Customer communication preferences documented
- [ ] Team trained on incident response procedures
- [ ] Legal review of SLA (if needed for your company)

---

**Status**: 🟢 **PILOT SLA DEFINED & READY**

We are committed to uptime, fast response times, and rapid recovery procedures.

If something fails, we have documented recovery steps and a team standing by.

