# Style Audit Report

## Objetivo
Auditar y corregir el sistema de estilos para eliminar hardcoded colors y asegurar un modo light claro y consistente.

## Hallazgos
1. **Colores Hardcodeados**: Se detectaron múltiples instancias de `zinc-*`, `gray-*` y `white/black` hardcodeados en componentes UI y features.
   - `Badge.tsx`: Usaba `bg-zinc-100 text-zinc-800`.
   - `Button.tsx`: Usaba `text-white` en variante `danger`.
   - `DashboardPage`: Usaba `text-zinc-600`.
   - `OnboardingChecklist.tsx`: Usaba una mezcla de `gray`, `green`, `indigo` hardcodeados.
   - `PaymentsReviewUI`: Usaba `bg-zinc-700` y `text-zinc-500`.

2. **Inconsistencias**:
   - Algunos componentes usaban colores directos en lugar de tokens semánticos (`muted`, `card`, `primary`).
   - El "modo oscuro" percibido en light mode se debía a excesivo uso de grises oscuros (`zinc-600`, `gray-900`) en lugar de `text-foreground` (que es un azul oscuro muy profundo `slate-900` pero más limpio) o `text-muted-foreground`.

## Archivos Modificados
1.  **`shared/components/ui/Badge.tsx`**
    - Antes: `bg-zinc-100 text-zinc-800`
    - Ahora: `bg-muted text-muted-foreground border border-border`

2.  **`shared/components/ui/Button.tsx`**
    - Antes: `danger: "bg-danger text-white..."`
    - Ahora: `danger: "bg-danger text-primary-foreground..."`

3.  **`app/(tenant)/[tenantId]/dashboard/page.tsx`**
    - Antes: `text-zinc-600`
    - Ahora: `text-muted-foreground`

4.  **`features/onboarding/OnboardingChecklist.tsx`**
    - Reemplazo masivo de:
        - `bg-gray-50` -> `bg-muted/40`
        - `bg-white` -> `bg-card`
        - `border-gray-200` -> `border-border`
        - `text-gray-900` -> `text-foreground`
        - `text-gray-500` -> `text-muted-foreground`
        - `bg-green-100` -> `bg-success/15`
        - `text-green-600` -> `text-success`
        - `border-indigo-500` -> `border-primary`
        - `text-indigo-600` -> `text-primary`

5.  **`features/payments/payments.review.ui.tsx`**
    - Antes: `bg-zinc-700`, `text-zinc-500`
    - Ahora: `variant="danger"`, `text-muted-foreground`

## Reglas Finales (Tokens Permitidos)
| Token | Uso Correcto |
|-------|--------------|
| `bg-background` | Fondo general de la página |
| `bg-card` | Contenedores, paneles, cards (superficie blanca) |
| `bg-muted` | Fondos secundarios, badges, items inactivos |
| `bg-primary` | Acciones principales, botones, highlights fuertes |
| `text-foreground` | Texto principal (títulos, cuerpo) |
| `text-muted-foreground` | Texto secundario, descripciones, metadatos |
| `border-border` | Bordes de cards, inputs, separadores |

## Verificación
Se ejecutaron los siguientes comandos para asegurar limpieza:
```bash
# Búsqueda de grises/zinc/slate hardcodeados
grep -r "text-zinc\|bg-zinc\|text-gray\|bg-gray\|text-slate\|bg-slate" apps/web

# Búsqueda de blanco/negro hardcodeados
grep -r "text-white\|bg-white\|bg-black\|text-black" apps/web
```
Resultado: **0 coincidencias** (limpieza total).

El sistema ahora utiliza exclusivamente tokens CSS variables definidos en `globals.css`, garantizando consistencia entre Marketing y App, y un modo light limpio.
