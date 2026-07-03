# BuildingOS Public Edge / Ingress Contract

This document defines the only supported public edge for BuildingOS. Treat it as the source of truth for deploy reviews, host naming, and ingress validation.

## Public edge rules

| Area | Contract |
|------|----------|
| Public entry | HTTPS on port 443 is the primary public entry point. HTTP on port 80 is allowed only for redirect and/or ACME challenges when the proxy requires it. |
| Reverse proxy | Traefik or an equivalent reverse proxy must terminate public traffic before it reaches app containers. |
| Public services | BuildingOS Web may be public. BuildingOS API must only be reachable through the public reverse proxy or another approved ingress layer. |
| Internal services | PostgreSQL, Redis, MinIO, and internal workers/jobs stay on internal networks only. |
| Forbidden public ports | PostgreSQL ports 5432/5433/5434, Redis ports 6379/6380, MinIO ports 9000/9001/9100/9101, and direct app ports must not be published on a public interface. |

## DNS and hostnames

- Web hostname: the production web domain configured for the release.
- API hostname: the production API domain configured for the release.
- `NEXT_PUBLIC_API_URL` must match the externally reachable API URL used by the browser.
- `WEB_ORIGIN` and `APP_BASE_URL` must match the real public HTTPS origin.
- Never print real hostnames, credentials, or internal env values in docs, logs, or release notes.

## TLS requirements

- TLS is mandatory in production.
- Cookies that depend on `Secure` must only be enabled behind HTTPS.
- Verify the certificate chain before cutover.
- Verify HTTP-to-HTTPS redirects when HTTP is exposed for redirect or ACME.

## Pre-deploy validation

- [ ] `docker ps` does not show PostgreSQL, Redis, or MinIO published on `0.0.0.0`.
- [ ] Reverse proxy routes the public web hostname to BuildingOS Web.
- [ ] Reverse proxy routes the public API hostname to BuildingOS API.
- [ ] `/health` returns 200 on the API.
- [ ] `/ready` returns 200 on the API when dependencies are healthy.
- [ ] `/metrics` is available only under the agreed observability policy.
- [ ] `X-Request-Id` is returned by the API and propagates into logs.
- [ ] The web app loads from the public hostname.
- [ ] The API responds correctly behind the expected hostname.

## Post-deploy validation

- [ ] `curl` the public web hostname and confirm the page loads.
- [ ] `curl` the API `/health` endpoint and confirm 200.
- [ ] `curl` the API `/ready` endpoint and confirm the expected readiness state.
- [ ] `curl` the API `/metrics` endpoint if metrics are enabled for the environment.
- [ ] Review logs for unexpected restarts or secret leakage.
- [ ] Review Sentry or the configured error tracker if it is enabled.

## Prohibited anti-patterns

- Do not expose PostgreSQL, Redis, or MinIO directly on the public edge.
- Do not use `localhost` for `NEXT_PUBLIC_API_URL` in production.
- Do not leave API or Web published on `0.0.0.0` without an approved reverse proxy.
- Do not deploy production without TLS.
- Do not deploy without a rollback path.

