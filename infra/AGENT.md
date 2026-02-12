# AGENT — Infra (BuildingOS)

## Propósito
Infraestructura, CI/CD, ambientes, secrets, deployments y observabilidad.

## Alcance (sí hacemos)
- Pipelines (lint/test/build/deploy)
- Environments (dev/staging/prod)
- IaC (Terraform/Pulumi/etc.) si aplica
- Observabilidad (logs/metrics/tracing)
- Seguridad: secrets, permisos mínimos

## Fuera de alcance (no hacemos)
- Cambiar reglas de negocio (eso es product_decision)
- Cambiar contratos de API sin coordinación con API owners
- Hardcode de credenciales o secretos en repo

## Reglas obligatorias
- Nada de secretos en repo (solo secret managers / env vars)
- Deploy reproducible (misma versión = mismo resultado)
- Rollback documentado
- Separación por ambientes (dev/staging/prod)
- Workflows deben correr por paths (solo lo que cambió)

## Convenciones
- Workflows en `.github/workflows/`
- Variables por ambiente documentadas en `infra/README` o este AGENT
- Naming: `staging-*`, `prod-*` consistente

## Cómo correr / operar
- CI: se ejecuta en PR y en main
- Deploy: gatillado por merge a main (o manual, según estrategia)

## Checklist PR
- [ ] Pipeline verde
- [ ] No expone secretos (revisar logs/outputs)
- [ ] Cambios IaC revisados por DevOps
- [ ] Documentación actualizada
- [ ] Plan/preview adjunto (si IaC)

## Owners
- Owner: DevOps Lead
- Reviewers: Tech Lead
