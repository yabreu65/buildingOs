import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import * as Minio from 'minio';
import type { Readable } from 'node:stream';

interface MinioErrorLike {
  code?: string;
  statusCode?: number;
  message?: string;
  stack?: string;
}

export interface MinioObjectStat {
  size: number;
  etag?: string;
  lastModified?: Date;
  metaData?: Record<string, string>;
}

/**
 * MinIO Service: Wrapper around Minio SDK for presigned URLs and object operations
 *
 * Uses S3-compatible MinIO endpoint configured via environment variables:
 * - S3_ENDPOINT: localhost only for local development fallback
 * - S3_ACCESS_KEY / S3_SECRET_KEY / S3_BUCKET: required outside development
 * - S3_FORCE_PATH_STYLE: controls whether bucket names are included in the URL path
 */
@Injectable()
export class MinioService {
  private readonly logger = new Logger(MinioService.name);
  private readonly minioClient: Minio.Client;
  private readonly presignClient: Minio.Client;
  private readonly bucket: string;

  private getErrorLike(error: unknown): MinioErrorLike | undefined {
    return typeof error === 'object' && error !== null
      ? (error as MinioErrorLike)
      : undefined;
  }

  private getErrorMessage(error: unknown): string {
    return this.getErrorLike(error)?.message || String(error);
  }

  private getErrorStack(error: unknown): string | undefined {
    return this.getErrorLike(error)?.stack;
  }

  private isNotFoundError(error: unknown): boolean {
    const errorLike = this.getErrorLike(error);
    return errorLike?.code === 'NotFound'
      || errorLike?.statusCode === 404
      || errorLike?.message?.includes('NotFound') === true;
  }

  private isPreconditionFailedError(error: unknown): boolean {
    const errorLike = this.getErrorLike(error);
    return errorLike?.code === 'PreconditionFailed'
      || errorLike?.statusCode === 412
      || errorLike?.message?.includes('PreconditionFailed') === true;
  }
  constructor(private configService: ConfigService) {
    const nodeEnv = this.configService.getValue('nodeEnv');
    const isDevelopment = nodeEnv === 'development' || nodeEnv === 'test';
    const endpoint = this.configService.getValue('s3Endpoint');
    if (!endpoint && !isDevelopment) {
      throw new Error('S3_ENDPOINT is required outside development');
    }
    const region = this.configService.getValue('s3Region') || 'us-east-1';
    const pathStyle = this.configService.getValue('s3ForcePathStyle');
    const accessKey = this.configService.getValue('s3AccessKey');
    const secretKey = this.configService.getValue('s3SecretKey');
    const bucket = this.configService.getValue('s3Bucket');
    if (!bucket && !isDevelopment) {
      throw new Error('S3_BUCKET is required outside development');
    }
    this.bucket = bucket || 'buildingos-local';

    const internalEndpoint = endpoint || 'http://localhost:9000';
    const publicEndpoint = this.configService.getValue('s3PublicBaseUrl') || internalEndpoint;

    this.minioClient = this.createClient(
      internalEndpoint,
      accessKey,
      secretKey,
      region,
      pathStyle,
    );
    this.presignClient = this.createClient(
      publicEndpoint,
      accessKey,
      secretKey,
      region,
      pathStyle,
    );

    this.logger.log(`MinIO client initialized: ${new URL(internalEndpoint).host} (bucket: ${this.bucket})`);
  }

  private createClient(
    endpoint: string,
    accessKey: string,
    secretKey: string,
    region: string,
    pathStyle: boolean,
  ): Minio.Client {
    const url = new URL(endpoint);
    const port = url.port
      ? Number.parseInt(url.port, 10)
      : url.protocol === 'https:'
        ? 443
        : 80;

    return new Minio.Client({
      endPoint: url.hostname,
      port,
      useSSL: url.protocol === 'https:',
      accessKey,
      secretKey,
      region,
      pathStyle,
    });
  }

  /**
   * Return the configured default bucket for the current environment.
   */
  getDefaultBucket(): string {
    return this.bucket;
  }

  /**
   * Generate presigned URL for file upload (PUT)
   *
   * @param bucketName - Bucket name (or undefined to use default)
   * @param objectKey - Object path in bucket (e.g., tenant-{id}/documents/{uuid}-{name})
   * @param expirySeconds - URL expiration time in seconds (default: 1 hour = 3600s)
   * @returns Presigned URL for PUT request
   *
   * @example
   * const bucket = minioService.getDefaultBucket();
   * const url = await minioService.presignUpload(bucket, 'tenant-123/docs/file.pdf', 3600);
   * // Client can then: fetch(url, { method: 'PUT', body: file })
   */
  async presignUpload(
    bucketName: string = this.bucket,
    objectKey: string,
    expirySeconds: number = 3600,
  ): Promise<string> {
    try {
      const url = await this.presignClient.presignedPutObject(
        bucketName,
        objectKey,
        expirySeconds,
      );
      this.logger.debug(`Generated presigned PUT URL for ${bucketName}/${objectKey}`);
      return url;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Failed to generate presigned PUT URL: ${message}`,
        stack,
      );
      throw error;
    }
  }

  /**
   * Generate presigned URL for file download (GET)
   *
   * @param bucketName - Bucket name (or undefined to use default)
   * @param objectKey - Object path in bucket
   * @param expirySeconds - URL expiration time in seconds (default: 1 hour = 3600s)
   * @returns Presigned URL for GET request
   *
   * @example
   * const bucket = minioService.getDefaultBucket();
   * const url = await minioService.presignDownload(bucket, 'tenant-123/docs/file.pdf', 3600);
   * // Client can then: window.location.href = url;
   */
  async presignDownload(
    bucketName: string = this.bucket,
    objectKey: string,
    expirySeconds: number = 3600,
  ): Promise<string> {
    try {
      const url = await this.presignClient.presignedGetObject(
        bucketName,
        objectKey,
        expirySeconds,
      );
      this.logger.debug(`Generated presigned GET URL for ${bucketName}/${objectKey}`);
      return url;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Failed to generate presigned GET URL: ${message}`,
        stack,
      );
      throw error;
    }
  }

  /**
   * Get object metadata from MinIO.
   * Useful for real size validation before persisting document metadata.
   */
  async statObject(
    bucketName: string = this.bucket,
    objectKey: string,
  ): Promise<MinioObjectStat> {
    try {
      return await this.minioClient.statObject(bucketName, objectKey) as MinioObjectStat;
    } catch (error: unknown) {
      this.logger.error(
        `Failed to stat object: ${this.getErrorMessage(error)}`,
        this.getErrorStack(error),
      );
      throw error;
    }
  }

  /**
   * Delete an object from MinIO
   *
   * @param bucketName - Bucket name (or undefined to use default)
   * @param objectKey - Object path in bucket
   *
   * @example
   * await minioService.deleteObject(minioService.getDefaultBucket(), 'tenant-123/docs/file.pdf');
   */
  async deleteObject(
    bucketName: string = this.bucket,
    objectKey: string,
  ): Promise<void> {
    try {
      await this.minioClient.removeObject(bucketName, objectKey);
      this.logger.debug(`Deleted object: ${bucketName}/${objectKey}`);
    } catch (error: unknown) {
      this.logger.error(
        `Failed to delete object: ${this.getErrorMessage(error)}`,
        this.getErrorStack(error),
      );
      throw error;
    }
  }

  /**
   * Check if an object exists in MinIO
   *
   * @param bucketName - Bucket name (or undefined to use default)
   * @param objectKey - Object path in bucket
   * @returns true if object exists, false otherwise
   *
   * @example
   * const exists = await minioService.objectExists(minioService.getDefaultBucket(), 'tenant-123/docs/file.pdf');
   */
  async objectExists(
    bucketName: string = this.bucket,
    objectKey: string,
  ): Promise<boolean> {
    try {
      const stat = await this.minioClient.statObject(bucketName, objectKey);
      this.logger.debug(`Object exists: ${bucketName}/${objectKey} (size: ${stat.size})`);
      return true;
    } catch (error: unknown) {
      // statObject throws if object doesn't exist
      // Check for NotFound error from MinIO SDK (can be via statusCode or code)
      if (this.isNotFoundError(error)) {
        this.logger.debug(`Object not found: ${bucketName}/${objectKey}`);
        return false;
      }

      this.logger.error(
        `Failed to check object existence: ${this.getErrorMessage(error)}`,
        this.getErrorStack(error),
      );
      throw error;
    }
  }

  /**
   * List objects in a bucket with optional prefix
   *
   * @param bucketName - Bucket name (or undefined to use default)
   * @param prefix - Object prefix to filter (e.g., 'tenant-123/documents/')
   * @returns Array of object names
   *
   * @example
   * const files = await minioService.listObjects('documents', 'tenant-123/documents/');
   */
  async listObjects(
    bucketName: string = this.bucket,
    prefix: string = '',
  ): Promise<string[]> {
    try {
      const objects: string[] = [];
      const stream = this.minioClient.listObjects(bucketName, prefix);

      return new Promise((resolve, reject) => {
        stream.on('data', (obj) => {
          if (obj.name) {
            objects.push(obj.name);
          }
        });

        stream.on('error', (error: unknown) => {
          this.logger.error(
            `Failed to list objects: ${this.getErrorMessage(error)}`,
            this.getErrorStack(error),
          );
          reject(error);
        });

        stream.on('end', () => {
          this.logger.debug(
            `Listed ${objects.length} objects in ${bucketName}/${prefix}`,
          );
          resolve(objects);
        });
      });
    } catch (error: unknown) {
      this.logger.error(
        `Failed to list objects: ${this.getErrorMessage(error)}`,
        this.getErrorStack(error),
      );
      throw error;
    }
  }

  /**
   * Get object metadata (stat)
   * Useful for getting file size, etag, last modified, etc.
   *
   * @param bucketName - Bucket name (or undefined to use default)
   * @param objectKey - Object path in bucket
   * @returns Object metadata
   *
   * @example
   * const stat = await minioService.getObjectStat('documents', 'tenant-123/docs/file.pdf');
   * console.log(stat.size, stat.etag, stat.lastModified);
   */
  async getObjectStat(
    bucketName: string = this.bucket,
    objectKey: string,
  ): Promise<Minio.BucketItemStat> {
    try {
      const stat = await this.minioClient.statObject(bucketName, objectKey);
      this.logger.debug(`Got stat for ${bucketName}/${objectKey}`);
      return stat;
    } catch (error: unknown) {
      this.logger.error(
        `Failed to get object stat: ${this.getErrorMessage(error)}`,
        this.getErrorStack(error),
      );
      throw error;
    }
  }

  /**
   * Read an object from MinIO as a Buffer.
   */
  async getObjectBuffer(
    bucketName: string = this.bucket,
    objectKey: string,
  ): Promise<Buffer> {
    try {
      const stream = await this.minioClient.getObject(bucketName, objectKey);
      const chunks: Buffer[] = [];

      return await new Promise<Buffer>((resolve, reject) => {
        stream.on('data', (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });

        stream.on('error', (error: unknown) => {
          this.logger.error(
            `Failed to read object: ${this.getErrorMessage(error)}`,
            this.getErrorStack(error),
          );
          reject(error);
        });

        stream.on('end', () => {
          resolve(Buffer.concat(chunks));
        });
      });
    } catch (error: unknown) {
      this.logger.error(
        `Failed to read object: ${this.getErrorMessage(error)}`,
        this.getErrorStack(error),
      );
      throw error;
    }
  }

  /**
   * Read an object from MinIO as a stream.
   */
  async getObjectStream(
    bucketName: string = this.bucket,
    objectKey: string,
  ): Promise<Readable> {
    try {
      return await this.minioClient.getObject(bucketName, objectKey);
    } catch (error: unknown) {
      this.logger.error(
        `Failed to open object stream: ${this.getErrorMessage(error)}`,
        this.getErrorStack(error),
      );
      throw error;
    }
  }

  /**
   * Upload a buffer directly to MinIO
   *
   * @param bucketName - Bucket name
   * @param objectKey - Object path in bucket
   * @param buffer - Buffer content to upload
   * @param contentType - MIME type (default: application/octet-stream)
   *
   * @example
   * await minioService.uploadBuffer(minioService.getDefaultBucket(), 'tenant-123/receipt.pdf', buffer, 'application/pdf');
   */
  async uploadBuffer(
    bucketName: string = this.bucket,
    objectKey: string,
    buffer: Buffer,
    contentType: string = 'application/octet-stream',
  ): Promise<void> {
    try {
      // Convert buffer to stream
      const stream = require('stream');
      const readable = new stream.Readable();
      readable._read = () => {};
      readable.push(buffer);
      readable.push(null);
      
      await this.minioClient.putObject(
        bucketName, 
        objectKey, 
        readable, 
        buffer.length,
        { 'Content-Type': contentType }
      );
      this.logger.debug(`Uploaded buffer to ${bucketName}/${objectKey} (${buffer.length} bytes)`);
    } catch (error: unknown) {
      this.logger.error(
        `Failed to upload buffer: ${this.getErrorMessage(error)}`,
        this.getErrorStack(error),
      );
      throw error;
    }
  }

  /**
   * Create an object only when the canonical key does not already exist.
   *
   * @returns true when this call created the object, false when the key was
   * already present.
   */
  async uploadBufferIfAbsent(
    bucketName: string = this.bucket,
    objectKey: string,
    buffer: Buffer,
    contentType: string = 'application/octet-stream',
  ): Promise<boolean> {
    try {
      const stream = require('stream');
      const readable = new stream.Readable();
      readable._read = () => {};
      readable.push(buffer);
      readable.push(null);

      await this.minioClient.putObject(
        bucketName,
        objectKey,
        readable,
        buffer.length,
        {
          'Content-Type': contentType,
          'If-None-Match': '*',
        },
      );
      this.logger.debug(`Created buffer object ${bucketName}/${objectKey} (${buffer.length} bytes)`);
      return true;
    } catch (error: unknown) {
      if (this.isPreconditionFailedError(error)) {
        this.logger.debug(`Object already exists: ${bucketName}/${objectKey}`);
        return false;
      }
      this.logger.error(
        `Failed to create buffer object: ${this.getErrorMessage(error)}`,
        this.getErrorStack(error),
      );
      throw error;
    }
  }

  /**
   * Check bucket connectivity and availability.
   */
  async checkHealth(): Promise<{ status: 'up' | 'down'; latency?: number; error?: string }> {
    const startedAt = Date.now();

    try {
      const exists = await this.minioClient.bucketExists(this.bucket);
      if (!exists) {
        return {
          status: 'down',
          error: `Bucket ${this.bucket} does not exist`,
        };
      }

      return {
        status: 'up',
        latency: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        status: 'down',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
