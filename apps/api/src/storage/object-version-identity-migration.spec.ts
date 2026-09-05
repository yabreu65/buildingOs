import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('object version identity schema foundation', () => {
  const schemaPath = join(__dirname, '../../prisma/schema.prisma');
  const migrationPath = join(
    __dirname,
    '../../prisma/migrations/20260905000000_add_object_version_identity/migration.sql',
  );

  it('declares nullable provider version identity fields for file and import objects', () => {
    const schema = readFileSync(schemaPath, 'utf8');

    expect(schema).toMatch(/model File \{[\s\S]*?objectVersionId String\?/);
    expect(schema).toMatch(/model ImportJob \{[\s\S]*?originalObjectVersionId String\?/);
    expect(schema).toMatch(/model ImportJob \{[\s\S]*?normalizedObjectVersionId String\?/);
  });

  it('adds only nullable columns without a backfill or destructive operation', () => {
    const migration = readFileSync(migrationPath, 'utf8');

    expect(migration).toContain('ADD COLUMN "objectVersionId" TEXT;');
    expect(migration).toContain('ADD COLUMN "originalObjectVersionId" TEXT,');
    expect(migration).toContain('ADD COLUMN "normalizedObjectVersionId" TEXT;');
    expect(migration).not.toMatch(/\b(UPDATE|DELETE|DROP|SET NOT NULL)\b/);
  });
});
