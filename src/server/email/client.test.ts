import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmailClient, type EmailFetch } from './client.js';
import {
  renderBaseEmailLayout,
  renderEmailButton,
  renderEmailParagraph,
} from './layout.js';

test('email client sends through the central service with server-only auth', async () => {
  const requests: Array<{
    url: string | URL;
    init: Parameters<EmailFetch>[1];
  }> = [];
  const fetchImpl: EmailFetch = async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({ id: 'msg_123' }), { status: 200 });
  };

  const client = createEmailClient({
    config: {
      url: 'https://email.example.test/send',
      appToken: 'app_token_123',
    },
    fetchImpl,
  });

  const result = await client.send({
    to: ['one@example.test', 'two@example.test'],
    subject: 'Document ready',
    html: '<p>Ready</p>',
    replyTo: 'support@example.test',
  });

  assert.deepEqual(result, { status: 'sent', id: 'msg_123' });
  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.ok(request);
  assert.equal(request.url, 'https://email.example.test/send');
  assert.equal(request.init?.method, 'POST');
  const headers = request.init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer app_token_123');

  if (typeof request.init?.body !== 'string') {
    throw new Error('Expected JSON request body');
  }

  const body = JSON.parse(request.init.body) as Record<string, unknown>;
  assert.deepEqual(body.to, ['one@example.test', 'two@example.test']);
  assert.equal(body.reply_to, 'support@example.test');
  assert.equal(body.from, undefined);
});

test('email client skips sends when service config is absent', async () => {
  let called = false;
  const fetchImpl: EmailFetch = async () => {
    called = true;
    return new Response(JSON.stringify({ id: 'msg_123' }), { status: 200 });
  };

  const client = createEmailClient({ config: null, fetchImpl });
  const result = await client.send({
    to: 'one@example.test',
    subject: 'Document ready',
    text: 'Ready',
  });

  assert.deepEqual(result, { status: 'skipped', reason: 'not_configured' });
  assert.equal(called, false);
});

test('email client returns a rate-limit failure without throwing', async () => {
  const client = createEmailClient({
    config: {
      url: 'https://email.example.test/send',
      appToken: 'app_token_123',
    },
    fetchImpl: async () => new Response('slow down', { status: 429 }),
  });

  const result = await client.send({
    to: 'one@example.test',
    subject: 'Document ready',
    text: 'Ready',
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'rate_limited');
});

test('base email layout escapes branded text and renders shared content', () => {
  const html = renderBaseEmailLayout({
    brandName: 'Docs <Vault>',
    title: 'Share "ready"',
    previewText: 'Open <securely>',
    bodyHtml: [
      renderEmailParagraph('Hello <member>'),
      renderEmailButton({
        href: 'https://example.test/share?token=<abc>',
        label: 'Open share',
      }),
    ].join(''),
    footerText: 'No reply needed',
  });

  assert.match(html, /Docs &lt;Vault&gt;/);
  assert.match(html, /Share &quot;ready&quot;/);
  assert.match(html, /Open &lt;securely&gt;/);
  assert.match(html, /Hello &lt;member&gt;/);
  assert.match(html, /https:\/\/example\.test\/share\?token=&lt;abc&gt;/);
  assert.match(html, /No reply needed/);
});
