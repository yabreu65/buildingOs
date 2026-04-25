#!/usr/bin/env node

import { execSync } from 'node:child_process';

const ALLOWED_FILES = new Set([
  'apps/api/src/config/config.ts',
  'apps/api/src/billing/require-feature.guard.ts',
  'apps/api/src/observability/request-id.middleware.ts',
  'apps/api/src/observability/logger.service.ts',
  'apps/api/src/common/tenant-context/tenant-context.resolver.ts',
  'apps/api/src/main.ts',
  'apps/api/src/context/context.controller.ts',
  'apps/api/src/communications/communications-user.controller.ts',
  'apps/api/src/assistant/assistant.service.ts',
  'apps/api/src/assistant/ai-nudges.service.ts',
  'apps/api/src/assistant/template.controller.ts',
  'apps/api/src/assistant/ai-nudges.controller.ts',
  'apps/api/src/assistant/read-only-query.controller.ts',
]);

function listFilesUsingTenantHeader() {
  try {
    const output = execSync(
      "rg -l \"headers\\s*\\[\\s*['\\\"]x-tenant-id['\\\"]\\s*\\]|@Headers\\(['\\\"]x-tenant-id['\\\"]\\)\" \"apps/api/src\" -g \"*.ts\"",
      {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    return output
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch (error) {
    // rg exits with code 1 when no matches are found.
    return [];
  }
}

const files = listFilesUsingTenantHeader();
const violations = files.filter((file) => !ALLOWED_FILES.has(file));

if (violations.length > 0) {
  console.error('Tenant header usage policy failed.');
  console.error('Use resolveTenantId() instead of reading x-tenant-id directly.');
  console.error('Unexpected files:');
  for (const file of violations) {
    console.error(`- ${file}`);
  }
  process.exit(1);
}

console.log('Tenant header usage policy passed.');
