# Local Docker services

## Mailpit

Mailpit is available only through the local and staging Compose stacks. It
captures SMTP messages locally and does not relay them to external providers.
Mailpit is never used in production and is not published through Traefik.

### Local

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

### Staging

In the staging stack Mailpit listens internally on port `1025` (SMTP) and
exposes the web UI on the VPS loopback at `127.0.0.1:8026`. The API connects
to `mailpit:1025` over the internal Docker network `buildingos_staging_net`.

To open the Mailpit inbox from a Mac via SSH tunnel:

```bash
ssh -L 8026:127.0.0.1:8026 pawtech
```

Then open `http://localhost:8026` in your browser. Press `Ctrl+C` in the
terminal where the tunnel was opened to close it.

Mailpit captures every email sent by the staging API but never delivers them
to real recipients.
