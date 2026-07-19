import { createHash, createHmac } from 'node:crypto';

import type { StorageConfig } from '../config.js';

export interface PutObjectInput {
  key: string;
  body: Buffer | Uint8Array;
  contentType: string;
}

export interface StoredObject {
  body: Buffer;
  contentType: string | null;
  contentLength: number | null;
}

export interface ObjectStorage {
  putObject(input: PutObjectInput): Promise<void>;
  getObject(key: string): Promise<StoredObject>;
}

type FetchLike = (
  input: URL,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: Buffer | Uint8Array;
  },
) => Promise<Response>;

export class S3ObjectStorage implements ObjectStorage {
  constructor(
    private readonly config: StorageConfig,
    private readonly fetchFn: FetchLike = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async putObject(input: PutObjectInput): Promise<void> {
    const body = Buffer.from(input.body);
    const url = objectUrl(this.config, input.key);
    const headers = this.signedHeaders('PUT', url, body, {
      'content-length': String(body.byteLength),
      'content-type': normalizeHeaderValue(input.contentType, 'contentType'),
    });
    const response = await this.fetchFn(url, {
      method: 'PUT',
      headers,
      body,
    });

    if (!response.ok) {
      throw new Error(`object storage put failed: ${response.status}`);
    }
  }

  async getObject(key: string): Promise<StoredObject> {
    const url = objectUrl(this.config, key);
    const headers = this.signedHeaders('GET', url, Buffer.alloc(0), {});
    const response = await this.fetchFn(url, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      throw new Error(`object storage get failed: ${response.status}`);
    }

    const body = Buffer.from(await response.arrayBuffer());

    return {
      body,
      contentType: response.headers.get('content-type'),
      contentLength: readContentLength(response.headers.get('content-length')),
    };
  }

  private signedHeaders(
    method: 'GET' | 'PUT',
    url: URL,
    body: Buffer,
    extraHeaders: Record<string, string>,
  ): Record<string, string> {
    const amzDate = formatAmzDate(this.now());
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = hashHex(body);
    const headers: Record<string, string> = {
      host: url.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      ...extraHeaders,
    };
    const signedHeaderNames = Object.keys(headers).sort();
    const canonicalHeaders = signedHeaderNames
      .map((name) => `${name}:${headers[name]?.trim() ?? ''}\n`)
      .join('');
    const signedHeaders = signedHeaderNames.join(';');
    const credentialScope = `${dateStamp}/${this.config.region}/s3/aws4_request`;
    const canonicalRequest = [
      method,
      url.pathname,
      url.searchParams.toString(),
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      hashHex(canonicalRequest),
    ].join('\n');
    const signature = hmacHex(
      signingKey(this.config.secretAccessKey, dateStamp, this.config.region),
      stringToSign,
    );

    return {
      ...headers,
      authorization: [
        'AWS4-HMAC-SHA256',
        `Credential=${this.config.accessKeyId}/${credentialScope}`,
        `SignedHeaders=${signedHeaders}`,
        `Signature=${signature}`,
      ].join(', '),
    };
  }
}

function objectUrl(config: StorageConfig, key: string): URL {
  const normalizedEndpoint = config.endpoint.endsWith('/')
    ? config.endpoint
    : `${config.endpoint}/`;
  const url = new URL(normalizedEndpoint);
  const segments = [config.bucket, ...normalizeObjectKey(key).split('/')];

  url.pathname = segments.map(encodeURIComponent).join('/');
  return url;
}

function normalizeObjectKey(key: string): string {
  const normalized = key
    .trim()
    .split('/')
    .filter((segment) => segment.length > 0)
    .join('/');

  if (normalized.length === 0) {
    throw new Error('object storage key is required');
  }

  return normalized;
}

function normalizeHeaderValue(value: string, field: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`${field} is required`);
  }

  return normalized;
}

function formatAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function hashHex(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function signingKey(
  secretAccessKey: string,
  date: string,
  region: string,
): Buffer {
  const dateKey = hmacBuffer(`AWS4${secretAccessKey}`, date);
  const regionKey = hmacBuffer(dateKey, region);
  const serviceKey = hmacBuffer(regionKey, 's3');

  return hmacBuffer(serviceKey, 'aws4_request');
}

function hmacBuffer(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

function hmacHex(key: Buffer, value: string): string {
  return createHmac('sha256', key).update(value).digest('hex');
}

function readContentLength(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}
