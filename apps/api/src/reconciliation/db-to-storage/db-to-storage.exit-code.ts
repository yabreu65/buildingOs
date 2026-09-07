import { ScanStatus } from './db-to-storage.types';

export type ScannerExitCode = 0 | 2;

export function exitCodeForScanStatus(status: ScanStatus): ScannerExitCode {
  return status === 'INCOMPLETE_OPERATIONAL_ERROR' ? 2 : 0;
}
