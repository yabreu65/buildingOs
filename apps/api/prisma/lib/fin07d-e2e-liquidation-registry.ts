import { link, mkdir, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface RegistryTarget {
  readonly host: string;
  readonly port: number;
  readonly database: string;
}

interface RegistryMarker {
  readonly version: 1;
  readonly target: RegistryTarget;
  readonly liquidationId: string;
}

const REGISTRY_ROOT = join(tmpdir(), 'buildingos-fin07d-e2e');
const LIQUIDATION_ID_PATTERN = /^[a-z0-9]{1,128}$/;

function resolveTarget(databaseUrl: string): RegistryTarget {
  const url = new URL(databaseUrl);
  return {
    host: url.hostname.toLowerCase(),
    port: Number(url.port || '5432'),
    database: url.pathname.replace(/^\//, ''),
  };
}

function targetKey(target: RegistryTarget): string {
  return createHash('sha256')
    .update(`${target.host}\0${target.port}\0${target.database}`)
    .digest('hex');
}

function targetDirectory(target: RegistryTarget): string {
  return join(REGISTRY_ROOT, targetKey(target));
}

function liquidationsDirectory(target: RegistryTarget): string {
  return join(targetDirectory(target), 'liquidations');
}

function validateLiquidationId(liquidationId: string): string {
  const normalizedId = liquidationId.trim();
  if (!LIQUIDATION_ID_PATTERN.test(normalizedId)) {
    throw new Error('FIN07D liquidation registry rejected an invalid liquidation ID');
  }
  return normalizedId;
}

function parseMarker(raw: string, expectedTarget: RegistryTarget, filename: string): RegistryMarker {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`FIN07D liquidation registry marker is malformed: ${filename}`);
  }

  const marker = parsed as Partial<RegistryMarker>;
  const target = marker.target;
  if (
    marker.version !== 1 ||
    marker.liquidationId !== filename ||
    !target ||
    target.host !== expectedTarget.host ||
    target.port !== expectedTarget.port ||
    target.database !== expectedTarget.database
  ) {
    throw new Error(`FIN07D liquidation registry marker does not match its target: ${filename}`);
  }

  return { version: 1, target: expectedTarget, liquidationId: filename };
}

async function readMarker(path: string, target: RegistryTarget, filename: string): Promise<void> {
  const raw = await readFile(path, 'utf8');
  parseMarker(raw, target, filename);
}

export async function registerFin07dMutableLiquidation(
  liquidationId: string,
  databaseUrl: string,
): Promise<void> {
  const normalizedId = validateLiquidationId(liquidationId);
  const target = resolveTarget(databaseUrl);
  const targetDir = targetDirectory(target);
  const registryDir = liquidationsDirectory(target);
  const markerPath = join(registryDir, normalizedId);
  const temporaryPath = join(targetDir, `.pending-${process.pid}-${randomUUID()}`);
  const marker: RegistryMarker = { version: 1, target, liquidationId: normalizedId };

  await mkdir(registryDir, { recursive: true, mode: 0o700 });
  await writeFile(temporaryPath, `${JSON.stringify(marker)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });

  try {
    await link(temporaryPath, markerPath);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
    await readMarker(markerPath, target, normalizedId);
  } finally {
    await unlink(temporaryPath).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    });
  }
}

export async function readFin07dMutableLiquidations(databaseUrl: string): Promise<string[]> {
  const target = resolveTarget(databaseUrl);
  const registryDir = liquidationsDirectory(target);
  let entries;
  try {
    entries = await readdir(registryDir, { withFileTypes: true });
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const liquidationIds: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !LIQUIDATION_ID_PATTERN.test(entry.name)) {
      throw new Error(`FIN07D liquidation registry contains an unexpected entry: ${entry.name}`);
    }
    await readMarker(join(registryDir, entry.name), target, entry.name);
    liquidationIds.push(entry.name);
  }
  return liquidationIds.sort();
}

export async function unregisterFin07dMutableLiquidations(
  liquidationIds: readonly string[],
  databaseUrl: string,
): Promise<void> {
  const target = resolveTarget(databaseUrl);
  const registryDir = liquidationsDirectory(target);
  await Promise.all(liquidationIds.map(async (liquidationId) => {
    const normalizedId = validateLiquidationId(liquidationId);
    await unlink(join(registryDir, normalizedId)).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    });
  }));
}

export async function clearFin07dMutableLiquidations(databaseUrl: string): Promise<void> {
  const target = resolveTarget(databaseUrl);
  await rm(liquidationsDirectory(target), { recursive: true, force: true });
}
