# Infra — Domain Instructions (BuildingOS)

> This file supplements ../AGENTS.md. Load it when working in infra.

## Scope
- Docker, Docker Compose, Traefik, CI/CD, VPS, deploy, secrets, environment files, observability, backups, restore, and production operations.

## Mandatory Infra Rules
- No secrets in repo.
- Do not print secrets in logs or responses.
- Do not touch production or VPS systems without explicit user approval.
- Do not restart production services without a plan and confirmation.
- Do not expose PostgreSQL or Redis publicly.
- Keep dev, staging, and production separated.

## Docker / Compose
- Prefer reproducible builds.
- Avoid `latest` tags for critical production services unless explicitly approved.
- Keep DB and Redis on internal networks.
- Public web services should go through Traefik or another reverse proxy.
- Do not run destructive Docker cleanup, volume deletion, stack teardown with volume removal, or container removal operations without explicit approval.
- Do not modify shared postgres or redis containers without explicit approval.

## Traefik / Reverse Proxy
- Keep labels explicit and minimal.
- Route only intended public services.
- Expose only intentional public ports, normally `80` and `443` through a reverse proxy.
- Never expose PostgreSQL, Redis, internal dashboards, or debug ports publicly.
- Validate domain, TLS, and network configuration before deploy.
- Avoid accidental exposure of internal APIs.

## Production Access
- Before production changes, show current status and rollback plan.
- Use read-only diagnostics first.
- Preserve SSH access, firewall rules, and rollback before network or proxy changes.
- Do not run destructive commands without explicit confirmation.
- Do not run database migrations in production without a plan, backup confirmation, and explicit approval.
- Do not run destructive SQL against production without explicit approval and a rollback plan.
- Log what was changed and why.

## Secrets / Env
- Use env files or secret managers.
- Commit only `.env.example` files with placeholder values.
- Keep real `.env` files out of git.
- Do not commit real credentials.
- Do not echo secret values.
- Do not print full env files in responses.
- Document required variables without exposing values.

## Backups / Recovery
- Do not change backup jobs without explaining impact.
- Validate restore procedures in temporary databases when possible.
- Never test restore over a real production database unless explicitly approved.

## Observability
- Prefer structured logs where possible.
- Surface health endpoints and service status.
- For incidents, report symptoms, likely cause, mitigation, and follow-up.

## CI/CD
- Keep workflows path-scoped when possible.
- Do not deploy automatically from unreviewed changes.
- If IaC exists, attach plan or preview before applying.

## PR Checklist
- [ ] No secrets exposed.
- [ ] Production impact explained.
- [ ] Rollback path documented.
- [ ] No Docker destructive commands without approval.
- [ ] Docker and Traefik network exposure reviewed.
- [ ] Public ports reviewed.
- [ ] Backups and restore impact considered.
- [ ] Migrations and production DB changes planned if applicable.
- [ ] Real `.env` files not exposed.
- [ ] No deploy or restart without approval.
