import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LOCK_ROOT = join(tmpdir(), 'buildingos-fin07d-e2e');
const LOCK_PATH = join(LOCK_ROOT, 'mutable-fixtures.lock');
const LOCK_TIMEOUT_MS = 120_000;
const RETRY_INTERVAL_MS = 100;

function waitForLockRetry(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS));
}

/**
 * Serializes FIN-07D journeys that reset or mutate the shared local fixture DB.
 * The lock fails closed rather than removing an unknown stale lock.
 */
export async function acquireFin07dMutationLock(): Promise<() => Promise<void>> {
  await mkdir(LOCK_ROOT, { recursive: true, mode: 0o700 });
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  while (true) {
    try {
      await mkdir(LOCK_PATH, { mode: 0o700 });
      return async () => rm(LOCK_PATH, { recursive: true, force: true });
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
      if (Date.now() >= deadline) {
        throw new Error('Timed out waiting for the FIN-07D mutable fixture lock');
      }
      await waitForLockRetry();
    }
  }
}
