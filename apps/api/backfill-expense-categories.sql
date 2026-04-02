-- Backfill: Seed default expense categories for ALL existing tenants
-- This script inserts the 19 default categories for each tenant that doesn't have any yet

-- Step 1: Create a function to generate CUID-like IDs (optional, if you don't have one)
-- If CUID generation is already available, skip this and use your existing function

-- Step 2: Insert default categories for each tenant
WITH tenant_list AS (
  SELECT id FROM "Tenant"
)
INSERT INTO "ExpenseLedgerCategory"
  ("id", "tenantId", "code", "name", "description", "sortOrder", "active", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,  -- or use your CUID generator
  t.id,
  cats.code,
  cats.name,
  cats.description,
  cats.sort_order,
  cats.active,
  now(),
  now()
FROM tenant_list t
CROSS JOIN (
  VALUES
    ('SERV_ELECTRICIDAD', 'Electricidad', 'Electricidad áreas comunes (escaleras, pasillos, ascensores)', 10, true),
    ('SERV_AGUA', 'Agua', 'Agua áreas comunes y consumo general', 20, true),
    ('SERV_GAS', 'Gas', 'Gas para calefacción o agua caliente', 30, false),
    ('MANT_LIMPIEZA', 'Limpieza y Aseo', 'Personal de limpieza e insumos (escobas, detergentes, etc)', 40, true),
    ('MANT_GENERAL', 'Mantenimiento General', 'Mantenimiento preventivo y correctivo del edificio', 50, true),
    ('MANT_REPARACIONES', 'Reparaciones', 'Reparaciones de infraestructura y áreas comunes', 60, true),
    ('MANT_PINTURA', 'Pintura y Acabados', 'Pintura de pasillos, común, fachada y trabajos similares', 70, true),
    ('PERS_PORTERIA', 'Portería / Conserje', 'Honorarios de conserje/portero y beneficios', 80, true),
    ('PERS_SEGURIDAD', 'Seguridad', 'Personal de seguridad 24/7 (si aplica)', 90, false),
    ('INF_ASCENSORES', 'Mantenimiento de Ascensores', 'Mantenimiento preventivo y revisión periódica de ascensores', 100, false),
    ('INF_BOMBAS_AGUA', 'Bomba de Agua', 'Mantenimiento de bombas, hidroneumático, tanques de agua', 110, true),
    ('INF_PORTON_ACCESO', 'Portón / Accesos / Cerrajería', 'Mantenimiento de portones, puertas de emergencia, cerraduras', 120, true),
    ('INF_INCENDIO', 'Sistema Contra Incendio', 'Mantenimiento y recarga de sistema de emergencia', 130, true),
    ('PROT_SEGURO_EDIF', 'Seguro del Edificio', 'Póliza de seguros de la estructura', 140, true),
    ('PROT_RESP_CIVIL', 'Responsabilidad Civil', 'Póliza de responsabilidad civil del condominio', 150, true),
    ('ADM_IMPUESTOS', 'Impuestos y Contribuciones', 'Impuestos municipales, contribuciones, tasas', 160, true),
    ('ADM_BANCOS_COMIS', 'Comisiones Bancarias', 'Comisiones por servicios bancarios y transferencias', 170, true),
    ('ADM_LEGAL_CONTAB', 'Legal / Contabilidad / Auditoría', 'Asesoría legal, contabilidad, honorarios de auditor', 180, true),
    ('FONDO_RESERVA', 'Fondo de Reserva', 'Fondo para obras mayores y reparaciones extraordinarias', 190, true)
) AS cats(code, name, description, sort_order, active)
WHERE NOT EXISTS (
  SELECT 1 FROM "ExpenseLedgerCategory" WHERE "tenantId" = t.id AND "code" = cats.code
)
ON CONFLICT ("tenantId", "code") DO NOTHING;

-- Verify the results
SELECT
  "tenantId",
  COUNT(*) as category_count,
  COUNT(CASE WHEN active = false THEN 1 END) as inactive_count
FROM "ExpenseLedgerCategory"
GROUP BY "tenantId"
ORDER BY category_count DESC;
