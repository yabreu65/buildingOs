# Skill Registry

**Delegator use only.** Any agent that launches sub-agents reads this registry to resolve compact rules, then injects them directly into sub-agent prompts. Sub-agents do NOT read this registry or individual SKILL.md files.

See `_shared/skill-resolver.md` for the full resolution protocol.

## User Skills

| Trigger | Skill | Path |
|---------|-------|------|
| When creating a pull request, opening a PR, or preparing changes for review. | branch-pr | /Users/yoryiabreu/.config/opencode/skills/branch-pr/SKILL.md |
| When writing Go tests, using teatest, or adding test coverage. | go-testing | /Users/yoryiabreu/.config/opencode/skills/go-testing/SKILL.md |
| When creating a GitHub issue, reporting a bug, or requesting a feature. | issue-creation | /Users/yoryiabreu/.config/opencode/skills/issue-creation/SKILL.md |
| When user requests adversarial dual review ("judgment day", "dual review", etc.). | judgment-day | /Users/yoryiabreu/.config/opencode/skills/judgment-day/SKILL.md |
| When creating new AI skills or documenting reusable agent patterns. | skill-creator | /Users/yoryiabreu/.config/opencode/skills/skill-creator/SKILL.md |
| When listing or installing agent skills from curated/GitHub sources. | find-skills | /Users/yoryiabreu/.agents/skills/find-skills/SKILL.md |
| Docker containerization, multi-stage builds, image optimization, and compose patterns. | docker-expert | /Users/yoryiabreu/.agents/skills/docker-expert/SKILL.md |

## Project Skills

| Trigger | Skill | Path |
|---------|-------|------|
| Creating new NestJS services, controllers, or modules in BuildingOS | nestjs-service | .agents/skills/nestjs-service/SKILL.md |
| Creating new Prisma models, relations, or migrations in BuildingOS | prisma-model | .agents/skills/prisma-model/SKILL.md |
| Writing Playwright E2E tests in BuildingOS | e2e-testing | .agents/skills/e2e-testing/SKILL.md |
| Creating new frontend features, pages, or components in BuildingOS | frontend-feature | .agents/skills/frontend-feature/SKILL.md |
| Security hardening, audit, or review for BuildingOS multi-tenant SaaS | security | .agents/skills/security/SKILL.md |
| Creating Prisma migrations in BuildingOS | migration-guide | .agents/skills/migration-guide/SKILL.md |

## Compact Rules

Pre-digested rules per skill. Delegators copy matching blocks into sub-agent prompts as `## Project Standards (auto-resolved)`.

### branch-pr
- Every PR MUST link an approved issue (`status:approved`) before merge.
- Every PR MUST have exactly one `type:*` label.
- Branch name MUST match `type/description` lowercase regex.
- Use conventional commits only (`feat|fix|chore|docs|...`).
- Run shellcheck on modified scripts before pushing.
- Use PR template and include `Closes/Fixes/Resolves #N`.
- Do not include Co-Authored-By trailers.

### go-testing
- Prefer table-driven tests for multi-case behavior.
- Use `t.Run` with descriptive test-case names.
- Test success and failure paths explicitly.
- For Bubbletea state changes, test `Model.Update()` directly.
- For end-to-end TUI flows, use `teatest.NewTestModel`.
- Use golden files for stable visual/text output assertions.
- Use `t.TempDir()` for filesystem tests and isolate side effects.

### issue-creation
- Use issue templates; blank issues are disabled.
- New issues start with `status:needs-review`; PRs wait for `status:approved`.
- Bugs -> bug template; features -> feature template; questions -> Discussions.
- Require duplicate check before creating a new issue.
- Ensure required fields are complete and reproducible.
- Keep issue title in conventional style (`fix(scope): ...`, `feat(scope): ...`).

### judgment-day
- Run two blind judges in parallel (never sequential single-review shortcut).
- Inject same project standards into both judge prompts.
- Synthesize findings into confirmed/suspect/contradiction buckets.
- Fix confirmed CRITICAL and real WARNING findings first.
- Re-judge after fixes; escalate to user after two unresolved iterations.
- Classify warnings as real vs theoretical; theoretical does not block.
- Orchestrator coordinates only; do not mix coordinator with executor responsibilities.

### skill-creator
- Create skills only for reusable non-trivial patterns, not one-off tasks.
- Follow required SKILL frontmatter (`name`, `description`, `license`, `metadata`).
- Keep instructions actionable; prioritize critical rules first.
- Prefer local references/templates over duplicated long documentation.
- Use naming conventions (`technology`, `action-target`, or project-specific forms).
- Keep examples minimal and commands copy-paste ready.
- Register new skills in project instructions/index when applicable.

### find-skills
- Search curated skill registries and GitHub for matching capabilities.
- Validate skill compatibility before recommending install.
- Prefer official/verified skills over community ones.
- Explain installation steps and any required configuration.

### docker-expert
- Always use multi-stage builds for production images.
- Pin base image versions; never use `latest` in production.
- Minimize layer count; combine RUN commands logically.
- Run as non-root user; set USER directive explicitly.
- Use .dockerignore to exclude node_modules, .git, and build artifacts.
- Healthcheck every service; use HEALTHCHECK instruction.
- Compose: separate networks, named volumes, and resource limits.

### nestjs-service
- Module structure: controller, service, module, dto/, entities/, interfaces/.
- Constructor injects PrismaService and any dependent services.
- Use `@Injectable()` decorator; never export service class directly.
- DTOs use class-validator decorators for all fields.
- All queries MUST include tenantId filter for multi-tenant isolation.
- Use typed exceptions, never throw raw Error or string.
- JSDoc comments required on all public methods.

### prisma-model
- Schema location: `apps/api/prisma/schema.prisma`.
- All models MUST have `tenantId String @map("tenant_id")` for multi-tenancy.
- Use `cuid()` for primary keys: `id String @id @default(cuid())`.
- Audit fields: `createdAt`, `updatedAt`, optional `deletedAt` for soft deletes.
- Relations use explicit `@relation` with `fields` and `references`.
- Map camelCase fields to snake_case columns with `@map`.
- Add indexes on frequently queried foreign keys and tenantId.

### e2e-testing
- Test directory: `apps/web/tests/e2e/`.
- Use `testIgnore: '**/_archive/**'` to skip deprecated tests.
- CI retries: 2; local retries: 0.
- Trace on first retry, screenshot on failure, video retain on failure.
- Multi-browser: chromium, firefox, webkit projects.
- Web server: `npm run dev` on localhost:3000, reuseExistingServer in local.
- Global timeout: 30 minutes; per-test timeout: 30 seconds.
- Test critical flows: auth, tenant admin, resident, super-admin, operations.

### frontend-feature
- Feature structure: `apps/web/features/{module}/` with components/, hooks/, services/, types/, index.ts.
- Pages: `apps/web/app/(tenant)/[tenantId]/{module}/` for tenant-scoped routes.
- Use functional components only; named exports preferred.
- TypeScript for all components; proper prop typing with interfaces.
- Use `const` for component definitions.
- Hooks: use{Module} for data, use{Module}List for queries, use{Module}Mutations for mutations.
- Form validation with react-hook-form + Zod resolvers.

### security
- Multi-tenant isolation: ALL queries MUST filter by tenantId.
- RBAC: enforce role checks at controller and service layers.
- Never hardcode secrets; use environment variables only.
- Hash passwords with bcrypt; validate all user input.
- JWT tokens: set httpOnly and secure flags; implement rotation.
- Helmet middleware enabled; CORS restricted to known origins.
- Audit logging for all sensitive operations.
- SQL injection prevention: Prisma parameterized queries only.

### migration-guide
- Workflow: edit schema → `prisma migrate dev --name descriptive_name` → `prisma generate` → test.
- Never modify existing migration files after they are committed.
- For production: `prisma migrate deploy` (non-interactive, safe for CI).
- Always include `tenantId` on new models for multi-tenant isolation.
- Test migrations on staging copy before production deploy.
- Reset local DB with `prisma migrate reset` if schema drift occurs.
- Seed data after migration if new models require initial data.

## Project Conventions

| File | Path | Notes |
|------|------|-------|
| AGENT.md | /AGENT.md | Repo constitution: multi-tenancy, RBAC, layered architecture. |
| AGENTS.md | /AGENTS.md | Code standards: TS, NestJS, React, API, testing, security, DB, commits. |
| ARCHITECTURE.md | /ARCHITECTURE.md | System architecture documentation. |
| product_decision/ | /product_decision/ | Business rules and product decisions (source of truth). |
| infra/AGENT.md | /infra/AGENT.md | Infrastructure conventions and CI/CD. |

Read the convention files listed above for project-specific patterns and rules.
