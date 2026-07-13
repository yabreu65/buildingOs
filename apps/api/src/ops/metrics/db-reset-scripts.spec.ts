import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('DB reset command governance', () => {
  it('does not expose prisma migrate reset from package scripts', () => {
    const repoRoot = join(__dirname, '../../../../..');
    const rootPackage = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
    const apiPackage = JSON.parse(readFileSync(join(repoRoot, 'apps/api/package.json'), 'utf8')) as { scripts?: Record<string, string> };

    const scripts = {
      ...rootPackage.scripts,
      ...apiPackage.scripts,
    };

    expect(scripts).not.toHaveProperty('migrate:reset');
    expect(Object.values(scripts).join('\n')).not.toContain('prisma migrate reset');
  });
});
