# Skill Registry — buildingos

Generated: 2026-03-28

## User Skills

| Name | Path | Trigger |
|------|------|---------|
| go-testing | `~/.claude/skills/go-testing/SKILL.md` | Go tests, Bubbletea TUI testing |
| skill-creator | `~/.claude/skills/skill-creator/SKILL.md` | Creating new AI agent skills |
| sdd-init | `~/.claude/skills/sdd-init/SKILL.md` | Initialize SDD context in a project |
| sdd-explore | `~/.claude/skills/sdd-explore/SKILL.md` | Explore and investigate ideas before committing to a change |
| sdd-propose | `~/.claude/skills/sdd-propose/SKILL.md` | Create a change proposal with intent, scope, and approach |
| sdd-spec | `~/.claude/skills/sdd-spec/SKILL.md` | Write specifications with requirements and scenarios |
| sdd-design | `~/.claude/skills/sdd-design/SKILL.md` | Create technical design document with architecture decisions |
| sdd-tasks | `~/.claude/skills/sdd-tasks/SKILL.md` | Break down a change into an implementation task checklist |
| sdd-apply | `~/.claude/skills/sdd-apply/SKILL.md` | Implement tasks from the change |
| sdd-verify | `~/.claude/skills/sdd-verify/SKILL.md` | Validate that implementation matches specs, design, and tasks |
| sdd-archive | `~/.claude/skills/sdd-archive/SKILL.md` | Sync delta specs to main specs and archive a completed change |
| branch-pr | `~/.claude/skills/branch-pr/SKILL.md` | Creating pull requests, preparing changes for review |
| issue-creation | `~/.claude/skills/issue-creation/SKILL.md` | Creating GitHub issues, reporting bugs, requesting features |
| judgment-day | `~/.claude/skills/judgment-day/SKILL.md` | Parallel adversarial review of code |
| docker-expert | `~/.claude/skills/docker-expert/SKILL.md` | Docker containerization, multi-stage builds, deployment |

## Project Skills

| Skill | Location | Trigger | Relevant For |
|-------|----------|---------|--------------|
| `nestjs-service` | `.agents/skills/nestjs-service/` | Creating NestJS services/controllers | New backend modules |
| `prisma-model` | `.agents/skills/prisma-model/` | Creating Prisma models/migrations | Database schema changes |
| `frontend-feature` | `.agents/skills/frontend-feature/` | Creating frontend features | New UI modules |
| `e2e-testing` | `.agents/skills/e2e-testing/` | Writing Playwright E2E tests | Testing user flows |
| `migration-guide` | `.agents/skills/migration-guide/` | Prisma migration workflow | Database migrations |

## Project Conventions

| File | Purpose |
|------|---------|
| `~/.claude/CLAUDE.md` | Global user instructions: personality, language (Rioplatense), architecture philosophy, commit rules, skill auto-load triggers |

## Compact Rules

### buildingos Project Standards

**IDs**: Never use `@IsUUID()` — all IDs are CUIDs (format `cl...`). Use `@IsString()` instead.

**Commits**: Conventional commits only. No "Co-Authored-By" or AI attribution.

**Build**: Never run build after changes.

**Multi-tenancy**: All Prisma queries MUST include `tenantId` filter. Cross-tenant access = 404.

**RBAC Roles**: SUPER_ADMIN | TENANT_OWNER | TENANT_ADMIN | OPERATOR | RESIDENT

**Backend structure**: `apps/api/src/{module}/{module}.controller.ts|service.ts|module.ts`

**Frontend structure**: `apps/web/features/{module}/` — components, hooks, services per feature; pages in `apps/web/app/(tenant)/[tenantId]/`

**Validation**: Use `class-validator` + DTOs for all API inputs. Validate at boundary only.

**Auth**: JWT + Passport. Guards: `JwtAuthGuard`, `BuildingAccessGuard` (sets tenantId), `RolesGuard`.

**State management (frontend)**: TanStack Query for server state. No Redux.

**Forms**: React Hook Form + Zod resolver.

**Styling**: Tailwind CSS v4 only. No CSS modules or styled-components.

**Testing**: Jest for API unit tests. Playwright for E2E. No mocking Prisma in integration tests.
