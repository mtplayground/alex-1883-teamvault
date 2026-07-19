import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmailTemplates } from './templates.js';

const templates = createEmailTemplates({
  baseUrl: 'https://app.example.test',
  brandName: 'App',
});

test('account verification template links to the app verification page', () => {
  const email = templates.accountVerification({
    recipientName: 'Ada',
    token: 'verify token',
    expiresIn: 'in 24 hours',
  });

  assert.equal(email.subject, 'Verify your email address');
  assert.match(
    email.html,
    /https:\/\/app\.example\.test\/account\/verify\?token=verify\+token/,
  );
  assert.match(email.html, /Verify email/);
  assert.match(email.text, /Verify email: https:\/\/app\.example\.test/);
  assert.match(email.text, /in 24 hours/);
});

test('password reset template links to the app reset page', () => {
  const email = templates.passwordReset({
    token: 'reset_123',
  });

  assert.equal(email.subject, 'Reset your password');
  assert.match(
    email.html,
    /https:\/\/app\.example\.test\/password\/reset\?token=reset_123/,
  );
  assert.match(email.text, /Reset password:/);
});

test('workspace invitation template includes invitation context', () => {
  const email = templates.workspaceInvitation({
    recipientName: 'Lee',
    inviterName: 'Morgan',
    workspaceName: 'Finance <Team>',
    token: 'invite_123',
  });

  assert.equal(email.subject, "You're invited to Finance <Team>");
  assert.match(
    email.html,
    /https:\/\/app\.example\.test\/invitations\/accept\?token=invite_123/,
  );
  assert.match(email.html, /Finance &lt;Team&gt;/);
  assert.match(email.html, /Morgan invited you/);
});

test('document shared template links to the shared document page', () => {
  const email = templates.documentShared({
    recipientName: 'Sam',
    sharedByName: 'Riley',
    documentName: 'Roadmap & notes',
    documentId: 'doc/123',
    workspaceName: 'Planning',
  });

  assert.equal(email.subject, 'A document was shared with you');
  assert.match(
    email.html,
    /https:\/\/app\.example\.test\/documents\/doc%2F123/,
  );
  assert.match(email.html, /Roadmap &amp; notes/);
  assert.match(email.text, /View document: https:\/\/app\.example\.test/);
});

test('document shared template can link to project document viewer', () => {
  const email = templates.documentShared({
    documentName: 'Plan.pdf',
    documentId: 'document-1',
    projectId: 'project-1',
  });

  assert.match(
    email.html,
    /https:\/\/app\.example\.test\/projects\/project-1\/documents\/document-1/,
  );
});
