# Estado de PR y trazabilidad en git

## Diagnóstico actual (verificado)

En este entorno local:

- Hay commits en la rama `work`.
- **No hay remoto configurado** (`git remote -v` no devuelve nada).

Por eso en GitHub no aparece ningún PR: si no existe remoto + push de la rama, GitHub no tiene esos commits para abrir/listar pull requests.

## Commits que existen localmente

- `fb0b383` — `docs: agregar auditoría de dashboards jerárquicos y brechas de implementación`
- `89baf80` — `docs: aclarar visibilidad de PR vs commits en git`

## Qué hacer para que el PR se vea en GitHub

1. Configurar remoto (si todavía no existe):

```bash
git remote add origin git@github.com:yabreu65/buildingOs.git
# o HTTPS:
# git remote add origin https://github.com/yabreu65/buildingOs.git
```

2. Publicar la rama:

```bash
git push -u origin work
```

3. Crear PR en GitHub:

- Entrar al repo.
- Botón **Compare & pull request** (o **New pull request**).
- Base: `main` (o la rama destino), compare: `work`.

## Comandos de verificación

```bash
git remote -v
git branch -vv
git log --oneline --decorate -n 10
```
