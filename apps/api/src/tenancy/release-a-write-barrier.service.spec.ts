jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs');
  return {
    ...actual,
    accessSync: jest.fn(actual.accessSync),
    lstatSync: jest.fn(actual.lstatSync),
  };
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

  it('opens when enabled and the searchable control directory has no sentinel', () => {
    const access = jest.mocked(fs.accessSync);
    access.mockClear();
    access.mockImplementation((_target, mode) => {
      if (mode !== fs.constants.X_OK) {
        throw new Error('read permission is not granted');
      }
    });

    expect(buildService('production', true, sentinelPath).isOpen()).toBe(true);
    expect(access).toHaveBeenCalledWith(controlDirectory, fs.constants.X_OK);
    access.mockImplementation(jest.requireActual<typeof import('fs')>('fs').accessSync);
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

  it('fails closed when parent search permission is denied', () => {
    const access = jest.mocked(fs.accessSync);
    access.mockImplementationOnce(() => {
      throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
    });

    expect(buildService('production', true, sentinelPath).isOpen()).toBe(false);
    access.mockImplementation(jest.requireActual<typeof import('fs')>('fs').accessSync);
  });

  it.each([
    ['EACCES', Object.assign(new Error('permission denied'), { code: 'EACCES' })],
    ['unknown filesystem error', new Error('unknown filesystem error')],
  ])('fails closed when sentinel lstat returns %s', (_description, error) => {
    const lstat = jest.mocked(fs.lstatSync);
    lstat.mockImplementation((target, ...args) => {
      if (target === sentinelPath) {
        throw error;
      }
      return jest.requireActual<typeof import('fs')>('fs').lstatSync(target, ...args);
    });

    expect(buildService('production', true, sentinelPath).isOpen()).toBe(false);
    lstat.mockImplementation(jest.requireActual<typeof import('fs')>('fs').lstatSync);
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

  it('fails closed when the sentinel parent is a symlink', () => {
    fs.rmdirSync(controlDirectory);
    fs.symlinkSync(root, controlDirectory);

    expect(buildService('production', true, sentinelPath).isOpen()).toBe(false);
  });

  it('fails closed when the sentinel parent path traverses through a file', () => {
    const sentinelBehindFile = path.join(controlDirectory, 'nested', 'CLOSED');
    fs.rmdirSync(controlDirectory);
    fs.writeFileSync(controlDirectory, 'not a directory');

    expect(buildService('production', true, sentinelBehindFile).isOpen()).toBe(false);
  });
});
