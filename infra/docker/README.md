# Local Docker services

## Mailpit

Mailpit is available only through the local Compose stack. It captures SMTP
messages locally and does not relay them to external providers.

Start it with:

```bash
docker compose -f infra/docker/docker-compose.yml up -d mailpit
```

The web inbox is available at `http://127.0.0.1:8025` and SMTP listens at
`127.0.0.1:1025`.

The API runs directly on macOS in the local workflow. Configure its ignored
`apps/api/.env` file without adding it to Git:

```dotenv
MAIL_PROVIDER=smtp
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
SMTP_USER=
SMTP_PASS=
```

Both SMTP credentials must be set together for authenticated SMTP, or both be
empty for Mailpit. No credentials are required for Mailpit.
