import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Client, type ItemBucketMetadata } from 'minio';
import type { Readable } from 'node:stream';

const TENANT_ID_PATTERN = /^[a-z0-9_-]+$/;

function assertValidTenantId(tenantId: string): void {
  if (!TENANT_ID_PATTERN.test(tenantId)) {
    throw new Error(`Invalid tenantId for object storage key prefix: ${tenantId}`);
  }
}

function namespacedKey(tenantId: string, key: string): string {
  assertValidTenantId(tenantId);
  return `${tenantId}/${key}`;
}

function resolveRequiredInProduction(envVar: string, devDefault: string): string {
  const value = process.env[envVar];
  if (value) {
    return value;
  }
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error(`${envVar} must be set in production`);
  }
  return devDefault;
}

function resolveUseSsl(): boolean {
  const raw = process.env['OBJECT_STORAGE_USE_SSL'];
  if (raw !== undefined) {
    return raw === 'true';
  }
  return process.env['NODE_ENV'] === 'production';
}

@Injectable()
export class ObjectStorageService implements OnModuleInit {
  private readonly logger = new Logger(ObjectStorageService.name);
  private readonly client: Client;
  private readonly bucket: string;

  constructor() {
    this.bucket = process.env['OBJECT_STORAGE_BUCKET'] ?? 'hospital-objects';
    this.client = new Client({
      endPoint: process.env['OBJECT_STORAGE_ENDPOINT'] ?? 'localhost',
      port: Number(process.env['OBJECT_STORAGE_PORT'] ?? 9002),
      useSSL: resolveUseSsl(),
      accessKey: resolveRequiredInProduction('OBJECT_STORAGE_ACCESS_KEY', 'hospital_dev'),
      secretKey: resolveRequiredInProduction('OBJECT_STORAGE_SECRET_KEY', 'hospital_dev_password'),
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      const exists = await this.client.bucketExists(this.bucket);
      if (!exists) {
        await this.client.makeBucket(this.bucket);
        this.logger.log(`Created object storage bucket "${this.bucket}"`);
      }
    } catch (err) {
      this.logger.error(
        `Object storage bucket bootstrap failed for bucket "${this.bucket}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  async putObject(
    tenantId: string,
    key: string,
    body: Buffer | Readable | string,
    size: number,
    metaData?: ItemBucketMetadata,
  ): Promise<void> {
    await this.client.putObject(this.bucket, namespacedKey(tenantId, key), body, size, metaData);
  }

  async getObject(tenantId: string, key: string): Promise<Readable> {
    return this.client.getObject(this.bucket, namespacedKey(tenantId, key));
  }

  async removeObject(tenantId: string, key: string): Promise<void> {
    await this.client.removeObject(this.bucket, namespacedKey(tenantId, key));
  }

  async presignedGetUrl(tenantId: string, key: string, expirySeconds: number): Promise<string> {
    return this.client.presignedGetObject(this.bucket, namespacedKey(tenantId, key), expirySeconds);
  }
}
