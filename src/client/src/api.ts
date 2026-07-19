export async function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);

  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return fetch(input, {
    ...init,
    credentials: 'same-origin',
    headers,
  });
}
