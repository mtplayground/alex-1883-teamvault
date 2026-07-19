export interface EmailLayoutOptions {
  brandName: string;
  title: string;
  previewText?: string;
  bodyHtml: string;
  footerText?: string;
}

export interface EmailButtonOptions {
  href: string;
  label: string;
}

export function renderBaseEmailLayout({
  brandName,
  title,
  previewText,
  bodyHtml,
  footerText,
}: EmailLayoutOptions): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;background:#f6f7f9;color:#17202a;font-family:Arial,Helvetica,sans-serif;">
    ${previewText ? renderPreviewText(previewText) : ''}
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f7f9;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border:1px solid #dfe4ea;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="padding:28px 32px 20px;border-bottom:1px solid #edf0f3;">
                <p style="margin:0 0 8px;color:#536173;font-size:13px;font-weight:700;letter-spacing:0;text-transform:uppercase;">${escapeHtml(brandName)}</p>
                <h1 style="margin:0;color:#17202a;font-size:24px;line-height:1.3;font-weight:700;">${escapeHtml(title)}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px;color:#25313f;font-size:16px;line-height:1.6;">
                ${bodyHtml}
              </td>
            </tr>
            ${
              footerText
                ? `<tr><td style="padding:20px 32px;background:#fafbfc;border-top:1px solid #edf0f3;color:#536173;font-size:13px;line-height:1.5;">${escapeHtml(footerText)}</td></tr>`
                : ''
            }
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function renderEmailButton({ href, label }: EmailButtonOptions): string {
  return `<p style="margin:24px 0;"><a href="${escapeHtml(href)}" style="display:inline-block;background:#1f6feb;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:6px;">${escapeHtml(label)}</a></p>`;
}

export function renderEmailParagraph(text: string): string {
  return `<p style="margin:0 0 16px;">${escapeHtml(text)}</p>`;
}

function renderPreviewText(previewText: string): string {
  return `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(previewText)}</div>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
