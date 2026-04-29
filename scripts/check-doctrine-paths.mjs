#!/usr/bin/env node

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const CANONICAL_CORE_PATH = '/Users/yoryiabreu/proyectos/yoryi-core-architecture';
const LEGACY_CORE_PATH = '/Users/yoryi/core/yoryi-core-architecture';

const files = [
  'AGENTS.md',
  'docs/architecture/constraints.md',
  'docs/overlays/core-overlay.md',
];

const errors = [];

for (const relativePath of files) {
  const absolutePath = resolve(ROOT, relativePath);

  if (!existsSync(absolutePath)) {
    errors.push(`Missing required file: ${relativePath}`);
    continue;
  }

  const content = readFileSync(absolutePath, 'utf8');

  if (content.includes(LEGACY_CORE_PATH)) {
    errors.push(
      `${relativePath} still references legacy core path: ${LEGACY_CORE_PATH}`,
    );
  }

  if (!content.includes(CANONICAL_CORE_PATH)) {
    errors.push(
      `${relativePath} does not reference canonical core path: ${CANONICAL_CORE_PATH}`,
    );
  }
}

if (errors.length > 0) {
  console.error('Doctrine path check failed:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log('Doctrine path check passed.');
