import type { EmailConfig } from '../config.js';

export type EmailRecipient = string | string[];

export interface SendEmailInput {
  to: EmailRecipient;
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
}

export type EmailSendResult =
  | {
      status: 'sent';
      id: string;
    }
  | {
      status: 'skipped';
      reason: 'not_configured';
    }
  | {
      status: 'failed';
      reason: 'invalid_request' | 'rate_limited' | 'transport_error';
      message: string;
    };

export type EmailFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface EmailClientOptions {
  config: EmailConfig | null;
  fetchImpl?: EmailFetch;
}

interface EmailServiceResponse {
  id?: unknown;
}

export function createEmailClient({
  config,
  fetchImpl = fetch,
}: EmailClientOptions) {
  return {
    send: (input: SendEmailInput): Promise<EmailSendResult> =>
      sendEmail(input, config, fetchImpl),
  };
}

export async function sendEmail(
  input: SendEmailInput,
  config: EmailConfig | null,
  fetchImpl: EmailFetch = fetch,
): Promise<EmailSendResult> {
  const validationError = validateEmailInput(input);
  if (validationError) {
    return {
      status: 'failed',
      reason: 'invalid_request',
      message: validationError,
    };
  }

  if (!config) {
    return {
      status: 'skipped',
      reason: 'not_configured',
    };
  }

  try {
    const response = await fetchImpl(config.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.appToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: input.to,
        subject: input.subject,
        ...(input.html ? { html: input.html } : {}),
        ...(input.text ? { text: input.text } : {}),
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      }),
    });

    if (response.status === 429) {
      return {
        status: 'failed',
        reason: 'rate_limited',
        message: 'Email service is rate limited; try again shortly.',
      };
    }

    if (!response.ok) {
      return {
        status: 'failed',
        reason: 'transport_error',
        message: `Email service returned ${response.status}: ${await response.text()}`,
      };
    }

    const payload = (await response.json()) as EmailServiceResponse;
    if (typeof payload.id !== 'string' || payload.id.trim().length === 0) {
      return {
        status: 'failed',
        reason: 'transport_error',
        message: 'Email service response did not include a message id.',
      };
    }

    return {
      status: 'sent',
      id: payload.id,
    };
  } catch (error) {
    return {
      status: 'failed',
      reason: 'transport_error',
      message: error instanceof Error ? error.message : 'Email send failed.',
    };
  }
}

function validateEmailInput(input: SendEmailInput): string | null {
  const recipients = Array.isArray(input.to) ? input.to : [input.to];

  if (recipients.length === 0 || recipients.some((to) => !hasText(to))) {
    return 'Email recipient is required.';
  }

  if (!hasText(input.subject)) {
    return 'Email subject is required.';
  }

  if (!hasText(input.html) && !hasText(input.text)) {
    return 'Email html or text content is required.';
  }

  return null;
}

function hasText(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}
