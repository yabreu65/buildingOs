# Contributing a BuildingOS

## Regla obligatoria: desarrollo local antes de staging

Todo desarrollo se realiza localmente antes de cualquier interacción con staging.

### Flujo

1. **Reproducir** el bug o funcionalidad en local.
2. **Implementar** el cambio exclusivamente en local.
3. **Validar** localmente antes de cualquier PR:
   - tests unitarios y de integración
   - tests E2E (si aplica)
   - typecheck (`tsc --noEmit`)
   - lint
   - build
   - `git diff --check`
4. **Crear PR** solo después de validación local exitosa.
5. **Staging** se utiliza solo después de merge a main y autorización explícita.

### Reglas

- Staging no es entorno de desarrollo ni diagnóstico.
- No se modifica staging directamente sin validación local previa.
- Hotfixes en staging deben quedar reproducidos y versionados localmente.
- Merge, deploy y cambios de base de datos requieren autorización explícita.

## Merge y despliegue automático a staging

En BuildingOS, fusionar cambios hacia `main` activa automáticamente el workflow `Deploy main to staging`.

- Un merge no es únicamente una integración de código: autorizar un merge implica autorizar el despliegue automático a staging.
- El checkout remoto de staging debe permanecer limpio. No se deben crear scripts temporales, fixtures, dumps, logs, archivos de bootstrap o archivos auxiliares no versionados dentro del checkout.
- Los archivos temporales deben guardarse en `/tmp`, el home del usuario, o una ubicación externa al repositorio.
- Nunca se deben limpiar archivos encontrados en el checkout remoto sin inspección previa. `git clean`, `git reset --hard` y borrado automático están prohibidos.
- La validación funcional de staging ocurre después del deploy exitoso, no antes.

### Flujo oficial

```
Local
→ pruebas
→ commit
→ PR
→ checks
→ merge autorizado
→ deploy automático
→ smoke y validación funcional en staging
```

## Commits

- Conventional commits: `feat`, `fix`, `refactor`, `test`, `docs`, etc.
- Mensajes claros y accionables.
- Un feature por commit.
- Incluir contexto del por qué, no solo el qué.

## Pull Requests

- Un PR por feature o fix.
- Descripción clra del problema y la solución.
- Checklist de validación local completado.
- Tests incluidos para cambios de lógica de negocio.
- No incluir cambios fuera del alcance.

## Ramas

- `main` siempre deployable.
- Feature branches: `feat/nombre-descriptivo`.
- Fix branches: `fix/nombre-descriptivo`.
- Eliminar ramas después de merge.
