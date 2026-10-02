import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigService } from '../config/config.service';
import { ReleaseAWriteBarrierService } from './release-a-write-barrier.service';

describe('ReleaseAWriteBarrierService', () => {
  let root: string;
  let controlDirectory: string;
  let sentinelPath: string;

  const buildService = (
    nodeEnv: 'development' | 'production',
    configuredSentinelPath?: string,
  ): ReleaseAWriteBarrierService =>
    new ReleaseAWriteBarrierService({
      get: () => ({ nodeEnv, releaseAWriteBarrierPath: configuredSentinelPath }),
    } as ConfigService);

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-a-write-barrier-'));
    controlDirectory = path.join(root, 'control');
    fs.mkdirSync(controlDirectory);
    sentinelPath = path.join(controlDirectory, 'CLOSED');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('keeps non-production local behavior open when no path is configured', () => {
    expect(buildService('development').isOpen()).toBe(true);
  });

  it('fails closed in production when the sentinel path is not configured', () => {
    expect(buildService('production').isOpen()).toBe(false);
  });

  it('opens only when the configured accessible directory has no sentinel', () => {
    expect(buildService('production', sentinelPath).isOpen()).toBe(true);
  });

  it('closes when the sentinel is present', () => {
    fs.writeFileSync(sentinelPath, 'closed');

    expect(buildService('production', sentinelPath).isOpen()).toBe(false);
  });

  it.each(['file', 'symlink'] as const)(
    'fails closed when the configured sentinel is a %s rather than a regular sentinel file',
    (sentinelKind) => {
      if (sentinelKind === 'file') {
        fs.mkdirSync(sentinelPath);
      } else {
        fs.symlinkSync(path.join(root, 'missing-target'), sentinelPath);
      }

      expect(buildService('production', sentinelPath).isOpen()).toBe(false);
    },
  );

  it('fails closed when the configured control directory is missing', () => {
    expect(
      buildService('production', path.join(root, 'missing', 'CLOSED')).isOpen(),
    ).toBe(false);
  });

  it('fails closed when a file occupies the configured control directory path', () => {
    fs.rmdirSync(controlDirectory);
    fs.writeFileSync(controlDirectory, 'not a directory');

    expect(buildService('production', sentinelPath).isOpen()).toBe(false);
  });

  it('fails closed when the sentinel parent path traverses through a file', () => {
    const sentinelBehindFile = path.join(controlDirectory, 'nested', 'CLOSED');
    fs.rmdirSync(controlDirectory);
    fs.writeFileSync(controlDirectory, 'not a directory');

    expect(buildService('production', sentinelBehindFile).isOpen()).toBe(false);
  });
});
