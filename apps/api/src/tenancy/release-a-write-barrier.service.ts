import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '../config/config.service';

@Injectable()
export class ReleaseAWriteBarrierService {
  constructor(private readonly configService: ConfigService) {}

  /** Returns whether local writes are currently allowed by the release sentinel. */
  isOpen(): boolean {
    const config = this.configService.get();
    if (!config.releaseAWriteBarrierEnabled) {
      return true;
    }

    const sentinelPath = config.releaseAWriteBarrierPath;
    if (!sentinelPath) {
      return false;
    }

    try {
      const parentPath = path.dirname(sentinelPath);
      const parentStat = fs.lstatSync(parentPath);
      if (!parentStat.isDirectory()) {
        return false;
      }
      fs.accessSync(parentPath, fs.constants.X_OK);

      try {
        fs.lstatSync(sentinelPath);
        return false;
      } catch (error: unknown) {
        if (isMissingPathError(error)) {
          return true;
        }
        return false;
      }
    } catch {
      return false;
    }
  }
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}
