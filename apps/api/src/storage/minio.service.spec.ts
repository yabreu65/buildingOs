import { ConfigService } from '../config/config.service';
import { MinioService } from './minio.service';
import * as Minio from 'minio';

jest.mock('minio', () => ({
  Client: jest.fn(),
}));

interface ClientMock {
  readonly statObject: jest.Mock;
  readonly presignedPutObject: jest.Mock;
  readonly presignedGetObject: jest.Mock;
}

const minioClientConstructor = Minio.Client as unknown as jest.Mock;

function createClientMock(): ClientMock {
  return {
    statObject: jest.fn(),
    presignedPutObject: jest.fn(),
    presignedGetObject: jest.fn(),
  };
}

function createConfig(overrides: Record<string, string | undefined> = {}): ConfigService {
  const values: Record<string, string | undefined> = {
    nodeEnv: 'test',
    s3Endpoint: 'http://minio:9000',
    s3PublicBaseUrl: 'https://buildingos-staging-files.31-220-98-21.sslip.io',
    s3Region: 'us-east-1',
    s3AccessKey: 'access-key',
    s3SecretKey: 'secret-key',
    s3Bucket: 'buildingos-staging',
    ...overrides,
  };

  return {
    getValue: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('MinioService', () => {
  beforeEach(() => {
    minioClientConstructor.mockReset();
  });

  it('uses the internal endpoint for object operations and the public endpoint for presigned URLs', async () => {
    const internalClient = createClientMock();
    const publicClient = createClientMock();
    internalClient.statObject.mockResolvedValue({ size: 42 });
    publicClient.presignedPutObject.mockResolvedValue(
      'https://buildingos-staging-files.31-220-98-21.sslip.io/buildingos-staging/proof.pdf',
    );
    publicClient.presignedGetObject.mockResolvedValue(
      'https://buildingos-staging-files.31-220-98-21.sslip.io/buildingos-staging/proof.pdf',
    );
    minioClientConstructor
      .mockImplementationOnce(() => internalClient)
      .mockImplementationOnce(() => publicClient);

    const service = new MinioService(createConfig());

    await service.statObject('buildingos-staging', 'tenant-a/proof.pdf');
    await service.presignUpload('buildingos-staging', 'tenant-a/proof.pdf');
    await service.presignDownload('buildingos-staging', 'tenant-a/proof.pdf');

    expect(minioClientConstructor).toHaveBeenNthCalledWith(1, {
      endPoint: 'minio',
      port: 9000,
      useSSL: false,
      accessKey: 'access-key',
      secretKey: 'secret-key',
      region: 'us-east-1',
      pathStyle: true,
    });
    expect(minioClientConstructor).toHaveBeenNthCalledWith(2, {
      endPoint: 'buildingos-staging-files.31-220-98-21.sslip.io',
      port: 443,
      useSSL: true,
      accessKey: 'access-key',
      secretKey: 'secret-key',
      region: 'us-east-1',
      pathStyle: true,
    });
    expect(internalClient.statObject).toHaveBeenCalledWith('buildingos-staging', 'tenant-a/proof.pdf');
    expect(internalClient.presignedPutObject).not.toHaveBeenCalled();
    expect(internalClient.presignedGetObject).not.toHaveBeenCalled();
    expect(publicClient.presignedPutObject).toHaveBeenCalledWith(
      'buildingos-staging',
      'tenant-a/proof.pdf',
      3600,
    );
    expect(publicClient.presignedGetObject).toHaveBeenCalledWith(
      'buildingos-staging',
      'tenant-a/proof.pdf',
      3600,
    );
  });

  it('preserves the public protocol, host, and explicit port when signing URLs', () => {
    const internalClient = createClientMock();
    const publicClient = createClientMock();
    minioClientConstructor
      .mockImplementationOnce(() => internalClient)
      .mockImplementationOnce(() => publicClient);

    new MinioService(createConfig({ s3PublicBaseUrl: 'http://files.example.test:9443' }));

    expect(minioClientConstructor).toHaveBeenNthCalledWith(2, expect.objectContaining({
      endPoint: 'files.example.test',
      port: 9443,
      useSSL: false,
      pathStyle: true,
    }));
  });

  it('falls back to the internal local endpoint for presigning when no public endpoint is configured', () => {
    const internalClient = createClientMock();
    const presignClient = createClientMock();
    minioClientConstructor
      .mockImplementationOnce(() => internalClient)
      .mockImplementationOnce(() => presignClient);

    new MinioService(createConfig({
      s3Endpoint: 'http://localhost:9000',
      s3PublicBaseUrl: undefined,
    }));

    expect(minioClientConstructor).toHaveBeenNthCalledWith(1, expect.objectContaining({
      endPoint: 'localhost',
      port: 9000,
      useSSL: false,
    }));
    expect(minioClientConstructor).toHaveBeenNthCalledWith(2, expect.objectContaining({
      endPoint: 'localhost',
      port: 9000,
      useSSL: false,
    }));
  });
});
