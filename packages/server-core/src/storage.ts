/** S3-compatible object storage adapter (MinIO locally; any S3-compatible service in production). */
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import type { Readable } from "node:stream";

export interface StorageConfig {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export class ObjectStorage {
  readonly client: S3Client;
  readonly bucket: string;

  constructor(cfg: StorageConfig) {
    this.bucket = cfg.bucket;
    this.client = new S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint,
      forcePathStyle: cfg.forcePathStyle,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      // Only send/validate checksums when the operation requires it (broadest S3-compatible support).
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }

  async ensureBucket(create: boolean): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (err) {
      const status = err instanceof S3ServiceException ? err.$metadata.httpStatusCode : undefined;
      if (status === 404 && create) {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        return;
      }
      throw err;
    }
  }

  /** Streams a body to storage using multipart upload. The upload is aborted on stream error. */
  async putStream(key: string, body: Readable, contentType: string, abortSignal?: AbortController): Promise<void> {
    const upload = new Upload({
      client: this.client,
      params: { Bucket: this.bucket, Key: key, Body: body, ContentType: contentType },
      queueSize: 4,
      partSize: 8 * 1024 * 1024,
      leavePartsOnError: false,
      abortController: abortSignal,
    });
    await upload.done();
  }

  async getStream(key: string): Promise<{ body: Readable; contentLength?: number }> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) throw new Error(`Object ${key} has no body`);
    return { body: res.Body as Readable, contentLength: res.ContentLength };
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (err) {
      const status = err instanceof S3ServiceException ? err.$metadata.httpStatusCode : undefined;
      if (status === 404) return false;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /** Health check used by readiness probes. */
  async ping(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }
}
