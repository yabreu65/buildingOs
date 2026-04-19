import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import * as Minio from 'minio';

/**
 * MinIO Service: Wrapper around Minio SDK for presigned URLs and object operations
 *
 * Uses S3-compatible MinIO endpoint configured via environment variables:
 * - S3_ENDPOINT: http://localhost:9000 (for local development)
 * - S3_ACCESS_KEY: buildingos (default for local)
 * - S3_SECRET_KEY: buildingos123 (default for local)
 * - S3_BUCKET: buildingos-local (default bucket name)
 * - S3_FORCE_PATH_STYLE: true (required for MinIO)
 */
@Injectable()
export class MinioService {
  private readonly logger = new Logger(MinioService.name);
  private readonly minioClient: Minio.Client;
  private readonly bucket: string;

  constructor(private configService: ConfigService) {
    const endpoint = this.configService.getValue('s3Endpoint') || 'http://localhost:9000';
    const region = this.configService.getValue('s3Region') || 'us-east-1';
    const accessKey = this.configService.getValue('s3AccessKey');
    const secretKey = this.configService.getValue('s3SecretKey');
    this.bucket = this.configService.getValue('s3Bucket') || 'buildingos-local';

    // Parse endpoint to extract host and port
    const url = new URL(endpoint);
    const host = url.hostname;
    const port = url.port ? parseInt(url.port, 10) : url.protocol === 'https:' ? 443 : 9000;
    const useSSL = url.protocol === 'https:';

    this.minioClient = new Minio.Client({
      endPoint: host,
      port,
      useSSL,
      accessKey,
      secretKey,
      region,
    });

    this.logger.log(`MinIO client initialized: ${host}:${port} (bucket: ${this.bucket})`);
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
   * const url = await minioService.presignUpload('documents', 'tenant-123/docs/file.pdf', 3600);
   * // Client can then: fetch(url, { method: 'PUT', body: file })
   */
  async presignUpload(
    bucketName: string = this.bucket,
    objectKey: string,
    expirySeconds: number = 3600,
  ): Promise<string> {
    try {
      const url = await this.minioClient.presignedPutObject(
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
   * const url = await minioService.presignDownload('documents', 'tenant-123/docs/file.pdf', 3600);
   * // Client can then: window.location.href = url;
   */
  async presignDownload(
    bucketName: string = this.bucket,
    objectKey: string,
    expirySeconds: number = 3600,
  ): Promise<string> {
    try {
      const url = await this.minioClient.presignedGetObject(
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
   * Delete an object from MinIO
   *
   * @param bucketName - Bucket name (or undefined to use default)
   * @param objectKey - Object path in bucket
   *
   * @example
   * await minioService.deleteObject('documents', 'tenant-123/docs/file.pdf');
   */
  async deleteObject(
    bucketName: string = this.bucket,
    objectKey: string,
  ): Promise<void> {
    try {
      await this.minioClient.removeObject(bucketName, objectKey);
      this.logger.debug(`Deleted object: ${bucketName}/${objectKey}`);
    } catch (error: unknown) {
      const errorObj = error as any;
      this.logger.error(
        `Failed to delete object: ${errorObj?.message || String(error)}`,
        errorObj?.stack,
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
   * const exists = await minioService.objectExists('documents', 'tenant-123/docs/file.pdf');
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
      const errorObj = error as any;
      const isNotFound =
        errorObj?.code === 'NotFound' ||
        errorObj?.statusCode === 404 ||
        errorObj?.message?.includes('NotFound');

      if (isNotFound) {
        this.logger.debug(`Object not found: ${bucketName}/${objectKey}`);
        return false;
      }

      this.logger.error(
        `Failed to check object existence: ${errorObj?.message || String(error)}`,
        errorObj?.stack,
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
          const errorObj = error as any;
          this.logger.error(
            `Failed to list objects: ${errorObj?.message || String(error)}`,
            errorObj?.stack,
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
      const errorObj = error as any;
      this.logger.error(
        `Failed to list objects: ${errorObj?.message || String(error)}`,
        errorObj?.stack,
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
      const errorObj = error as any;
      this.logger.error(
        `Failed to get object stat: ${errorObj?.message || String(error)}`,
        errorObj?.stack,
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
   * await minioService.uploadBuffer('documents', 'tenant-123/receipt.pdf', buffer, 'application/pdf');
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
      const errorObj = error as any;
      this.logger.error(
        `Failed to upload buffer: ${errorObj?.message || String(error)}`,
        errorObj?.stack,
      );
      throw error;
    }
  }
}
