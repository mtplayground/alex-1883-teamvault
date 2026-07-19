import assert from 'node:assert/strict';
import test from 'node:test';

import { S3ObjectStorage } from './s3.js';
import type { StorageConfig } from '../config.js';

const config: StorageConfig = {
  endpoint: 'https://storage.example.test',
  region: 'auto',
  bucket: 'teamvault',
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
};

test('puts objects using S3-compatible signed requests', async () => {
  const calls: Array<{
    url: URL;
    init: {
      method: string;
      headers: Record<string, string>;
      body?: Buffer | Uint8Array;
    };
  }> = [];
  const storage = new S3ObjectStorage(
    config,
    async (url, init) => {
      calls.push({ url, init });
      return new Response(null, { status: 200 });
    },
    () => new Date('2026-07-19T00:00:00.000Z'),
  );

  await storage.putObject({
    key: 'workspaces/workspace-1/Plan.pdf',
    body: Buffer.from('hello'),
    contentType: 'application/pdf',
  });

  assert.equal(calls[0]?.init.method, 'PUT');
  assert.equal(
    calls[0]?.url.toString(),
    'https://storage.example.test/teamvault/workspaces/workspace-1/Plan.pdf',
  );
  assert.equal(calls[0]?.init.headers['content-type'], 'application/pdf');
  assert.equal(calls[0]?.init.headers['content-length'], '5');
  assert.equal(calls[0]?.init.headers['x-amz-date'], '20260719T000000Z');
  assert.match(
    calls[0]?.init.headers.authorization ?? '',
    /Credential=access-key\/20260719\/auto\/s3\/aws4_request/,
  );
});

test('gets objects and returns bytes with response metadata', async () => {
  const storage = new S3ObjectStorage(config, async () => {
    return new Response('hello', {
      status: 200,
      headers: {
        'content-type': 'text/plain',
        'content-length': '5',
      },
    });
  });

  const object = await storage.getObject('documents/document-1');

  assert.equal(object.body.toString('utf8'), 'hello');
  assert.equal(object.contentType, 'text/plain');
  assert.equal(object.contentLength, 5);
});

test('surfaces storage failures', async () => {
  const storage = new S3ObjectStorage(config, async () => {
    return new Response(null, { status: 403 });
  });

  await assert.rejects(
    () =>
      storage.putObject({
        key: 'documents/document-1',
        body: Buffer.from('hello'),
        contentType: 'text/plain',
      }),
    /object storage put failed: 403/,
  );
});
