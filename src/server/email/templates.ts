import {
  renderBaseEmailLayout,
  renderEmailButton,
  renderEmailParagraph,
} from './layout.js';

export interface EmailTemplateContext {
  baseUrl: string;
  brandName: string;
}

export interface RenderedEmailTemplate {
  subject: string;
  html: string;
  text: string;
}

export interface AccountVerificationEmailInput {
  recipientName?: string;
  token: string;
  expiresIn?: string;
}

export interface PasswordResetEmailInput {
  recipientName?: string;
  token: string;
  expiresIn?: string;
}

export interface WorkspaceInvitationEmailInput {
  recipientName?: string;
  inviterName?: string;
  workspaceName: string;
  token: string;
  expiresIn?: string;
}

export interface DocumentSharedEmailInput {
  recipientName?: string;
  sharedByName?: string;
  documentName: string;
  documentId: string;
  projectId?: string;
  workspaceName?: string;
}

export function createEmailTemplates(context: EmailTemplateContext) {
  return {
    accountVerification: (
      input: AccountVerificationEmailInput,
    ): RenderedEmailTemplate => renderAccountVerificationEmail(context, input),
    passwordReset: (input: PasswordResetEmailInput): RenderedEmailTemplate =>
      renderPasswordResetEmail(context, input),
    workspaceInvitation: (
      input: WorkspaceInvitationEmailInput,
    ): RenderedEmailTemplate => renderWorkspaceInvitationEmail(context, input),
    documentShared: (input: DocumentSharedEmailInput): RenderedEmailTemplate =>
      renderDocumentSharedEmail(context, input),
  };
}

export function renderAccountVerificationEmail(
  context: EmailTemplateContext,
  input: AccountVerificationEmailInput,
): RenderedEmailTemplate {
  const actionUrl = buildAppUrl(context.baseUrl, '/account/verify', {
    token: input.token,
  });
  const greeting = greetingFor(input.recipientName);
  const expiry = input.expiresIn ?? 'soon';
  const subject = 'Verify your email address';

  return renderTemplate(context, {
    subject,
    title: 'Verify your email address',
    previewText:
      'Confirm your email address to finish setting up your account.',
    paragraphs: [
      greeting,
      'Please confirm this email address so we can keep your account secure and send important account updates to the right place.',
      `This verification link expires ${expiry}.`,
    ],
    button: {
      label: 'Verify email',
      href: actionUrl,
    },
    footerText:
      'If you did not create this account, you can safely ignore this email.',
  });
}

export function renderPasswordResetEmail(
  context: EmailTemplateContext,
  input: PasswordResetEmailInput,
): RenderedEmailTemplate {
  const actionUrl = buildAppUrl(context.baseUrl, '/password/reset', {
    token: input.token,
  });
  const greeting = greetingFor(input.recipientName);
  const expiry = input.expiresIn ?? 'soon';
  const subject = 'Reset your password';

  return renderTemplate(context, {
    subject,
    title: 'Reset your password',
    previewText: 'Use this secure link to choose a new password.',
    paragraphs: [
      greeting,
      'We received a request to reset your password. Use the secure link below to choose a new one.',
      `This password reset link expires ${expiry}.`,
    ],
    button: {
      label: 'Reset password',
      href: actionUrl,
    },
    footerText: 'If you did not request a password reset, no action is needed.',
  });
}

export function renderWorkspaceInvitationEmail(
  context: EmailTemplateContext,
  input: WorkspaceInvitationEmailInput,
): RenderedEmailTemplate {
  const actionUrl = buildAppUrl(context.baseUrl, '/invitations/accept', {
    token: input.token,
  });
  const greeting = greetingFor(input.recipientName);
  const inviter = input.inviterName
    ? `${input.inviterName} invited you`
    : 'You have been invited';
  const expiry = input.expiresIn ?? 'soon';
  const subject = `You're invited to ${input.workspaceName}`;

  return renderTemplate(context, {
    subject,
    title: 'Workspace invitation',
    previewText: `${inviter} to join ${input.workspaceName}.`,
    paragraphs: [
      greeting,
      `${inviter} to join the ${input.workspaceName} workspace.`,
      'Accept the invitation to collaborate with the team and access the workspace resources shared with you.',
      `This invitation link expires ${expiry}.`,
    ],
    button: {
      label: 'Accept invitation',
      href: actionUrl,
    },
    footerText:
      'If you were not expecting this invitation, you can ignore this email.',
  });
}

export function renderDocumentSharedEmail(
  context: EmailTemplateContext,
  input: DocumentSharedEmailInput,
): RenderedEmailTemplate {
  const actionUrl = buildAppUrl(
    context.baseUrl,
    input.projectId
      ? `/projects/${encodeURIComponent(input.projectId)}/documents/${encodeURIComponent(
          input.documentId,
        )}`
      : `/documents/${encodeURIComponent(input.documentId)}`,
  );
  const greeting = greetingFor(input.recipientName);
  const sharer = input.sharedByName
    ? `${input.sharedByName} shared a document with you.`
    : 'A document was shared with you.';
  const workspaceText = input.workspaceName
    ? `It is available in the ${input.workspaceName} workspace.`
    : 'It is available in the app.';
  const subject = 'A document was shared with you';

  return renderTemplate(context, {
    subject,
    title: 'Document shared',
    previewText: `${input.documentName} is ready to view.`,
    paragraphs: [
      greeting,
      sharer,
      `${input.documentName} is ready to view. ${workspaceText}`,
    ],
    button: {
      label: 'View document',
      href: actionUrl,
    },
    footerText:
      'Access to this document is controlled by the sharing settings in the app.',
  });
}

interface TemplateParts {
  subject: string;
  title: string;
  previewText: string;
  paragraphs: string[];
  button: {
    label: string;
    href: string;
  };
  footerText: string;
}

function renderTemplate(
  context: EmailTemplateContext,
  parts: TemplateParts,
): RenderedEmailTemplate {
  const html = renderBaseEmailLayout({
    brandName: context.brandName,
    title: parts.title,
    previewText: parts.previewText,
    bodyHtml: [
      ...parts.paragraphs.map((paragraph) => renderEmailParagraph(paragraph)),
      renderEmailButton(parts.button),
      renderEmailParagraph(
        `If the button does not work, copy and paste this link into your browser: ${parts.button.href}`,
      ),
    ].join(''),
    footerText: parts.footerText,
  });

  return {
    subject: parts.subject,
    html,
    text: [
      parts.title,
      '',
      ...parts.paragraphs,
      '',
      `${parts.button.label}: ${parts.button.href}`,
      '',
      parts.footerText,
    ].join('\n'),
  };
}

function buildAppUrl(
  baseUrl: string,
  path: string,
  searchParams: Record<string, string> = {},
): string {
  const url = new URL(path, baseUrl);

  for (const [key, value] of Object.entries(searchParams)) {
    url.searchParams.set(key, value);
  }

  return url.toString();
}

function greetingFor(recipientName: string | undefined): string {
  if (!recipientName || recipientName.trim().length === 0) {
    return 'Hello,';
  }

  return `Hello ${recipientName},`;
}
