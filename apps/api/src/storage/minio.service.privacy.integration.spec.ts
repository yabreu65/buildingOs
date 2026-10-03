import { ConfigService } from '../config/config.service';
import { MinioService } from './minio.service';

const integrationEnabled =
  process.env.RUN_MINIO_PRIVACY_INTEGRATION === '1' &&
  Boolean(
    process.env.MINIO_PRIVACY_BUCKET &&
      process.env.S3_ENDPOINT &&
      process.env.S3_PUBLIC_BASE_URL &&
      process.env.S3_ACCESS_KEY &&
      process.env.S3_SECRET_KEY,
  );
const describeMinioPrivacy = integrationEnabled ? describe : describe.skip;

const objectKey = 'privacy-probe.txt';

interface MinioPrivacyConfig {
  getValue(key: string): string | boolean;
}

describeMinioPrivacy('MinIO private bucket service integration', () => {
  const bucket = process.env.MINIO_PRIVACY_BUCKET!;
  const endpoint = process.env.S3_ENDPOINT!;
  let storage: MinioService;

  beforeAll(() => {
    const config: MinioPrivacyConfig = {
      getValue: (key) => {
        switch (key) {
          case 'nodeEnv': return 'test';
          case 's3Endpoint': return endpoint;
          case 's3PublicBaseUrl': return process.env.S3_PUBLIC_BASE_URL!;
          case 's3Region': return process.env.S3_REGION || 'us-east-1';
          case 's3AccessKey': return process.env.S3_ACCESS_KEY!;
          case 's3SecretKey': return process.env.S3_SECRET_KEY!;
          case 's3Bucket': return bucket;
          case 's3ForcePathStyle': return process.env.S3_FORCE_PATH_STYLE !== 'false';
          default: throw new Error(`Unexpected MinIO privacy test config key: ${key}`);
        }
      },
    };
    storage = new MinioService(config as unknown as ConfigService);
  });

  it('allows authenticated SDK and presigned GET while anonymous LIST/GET/HEAD are denied', async () => {
    const expected = Buffer.from('BuildingOS MinIO privacy probe\n');
    await expect(storage.getObjectBuffer(bucket, objectKey)).resolves.toEqual(expected);

    const signedUrl = await storage.presignDownload(bucket, objectKey, 60);
    const signedResponse = await fetch(signedUrl);
    expect(signedResponse.status).toBe(200);
    await expect(Buffer.from(await signedResponse.arrayBuffer())).toEqual(expected);

    const encodedObjectPath = `${bucket}/${objectKey}`;
    const anonymousTargets: ReadonlyArray<readonly [string, string]> = [
      ['GET', `${endpoint.replace(/\/$/, '')}/${bucket}?list-type=2`],
      ['GET', `${endpoint.replace(/\/$/, '')}/${encodedObjectPath}`],
      ['HEAD', `${endpoint.replace(/\/$/, '')}/${encodedObjectPath}`],
    ];
    for (const [method, target] of anonymousTargets) {
      const response = await fetch(target, { method });
      expect(response.status).toBe(403);
      await response.body?.cancel();
    }
  });
});
