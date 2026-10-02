jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs');
  return { ...actual, accessSync: jest.fn(actual.accessSync) };
});

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
    nodeEnv: 'development' | 'staging' | 'production' | 'test',
    enabled = false,
    configuredSentinelPath?: string,
  ): ReleaseAWriteBarrierService =>
    new ReleaseAWriteBarrierService({
      get: () => ({
        nodeEnv,
        releaseAWriteBarrierEnabled: enabled,
        releaseAWriteBarrierPath: configuredSentinelPath,
      }),
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

  it.each([
    ['staging-like', 'production'],
    ['release-staging-like', 'production'],
    ['staging NODE_ENV', 'staging'],
  ] as const)(
    'keeps %s writes open when the feature is disabled',
    (_context, nodeEnv) => {
      expect(buildService(nodeEnv).isOpen()).toBe(true);
    },
  );

  it.each(['development', 'test'] as const)(
    'keeps %s writes open when the feature is disabled',
    (nodeEnv) => {
      expect(buildService(nodeEnv).isOpen()).toBe(true);
    },
  );

  it('fails closed when enabled in production without a sentinel path', () => {
    expect(buildService('production', true).isOpen()).toBe(false);
  });

  it('opens when enabled and the accessible control directory has no sentinel', () => {
    expect(buildService('production', true, sentinelPath).isOpen()).toBe(true);
  });

  it('closes when the sentinel is present', () => {
    fs.writeFileSync(sentinelPath, 'closed');

    expect(buildService('production', true, sentinelPath).isOpen()).toBe(false);
  });

  it.each(['file', 'symlink'] as const)(
    'fails closed when the configured sentinel is a %s rather than a regular sentinel file',
    (sentinelKind) => {
      if (sentinelKind === 'file') {
        fs.mkdirSync(sentinelPath);
      } else {
        fs.symlinkSync(path.join(root, 'missing-target'), sentinelPath);
      }

      expect(buildService('production', true, sentinelPath).isOpen()).toBe(false);
    },
  );

  it('fails closed when the control directory is unreadable', () => {
    const access = jest.mocked(fs.accessSync);
    access.mockImplementationOnce(() => {
      throw new Error('permission denied');
    });

    expect(buildService('production', true, sentinelPath).isOpen()).toBe(false);
    access.mockRestore();
  });

  it('fails closed when the configured control directory is missing', () => {
    expect(
      buildService('production', true, path.join(root, 'missing', 'CLOSED')).isOpen(),
    ).toBe(false);
  });

  it('fails closed when a file occupies the configured control directory path', () => {
    fs.rmdirSync(controlDirectory);
    fs.writeFileSync(controlDirectory, 'not a directory');

    expect(buildService('production', true, sentinelPath).isOpen()).toBe(false);
  });

  it('fails closed when the sentinel parent path traverses through a file', () => {
    const sentinelBehindFile = path.join(controlDirectory, 'nested', 'CLOSED');
    fs.rmdirSync(controlDirectory);
    fs.writeFileSync(controlDirectory, 'not a directory');

    expect(buildService('production', true, sentinelBehindFile).isOpen()).toBe(false);
  });
});
