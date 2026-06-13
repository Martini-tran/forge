import { net } from 'electron';

/**
 * Best-effort website favicon fetch, returned as a data URI for use as an entry
 * icon. Tries the site's own /favicon.ico first, then falls back to Google's
 * favicon service. Returns '' if nothing usable is found. Uses Electron's `net`
 * (Chromium stack), so it must run after `app.ready`.
 */

const MAX_BYTES = 512 * 1024;

async function tryImage(url: string): Promise<string> {
  try {
    const res = await net.fetch(url, { redirect: 'follow' });
    if (!res.ok) return '';
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
    if (!type.startsWith('image/')) return '';
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) return '';
    return `data:${type};base64,${buf.toString('base64')}`;
  } catch {
    return '';
  }
}

/** Resolve a website's favicon to a data URI, or '' if unavailable. */
export async function fetchFavicon(target: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return '';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';

  const candidates = [
    `${url.origin}/favicon.ico`,
    `https://www.google.com/s2/favicons?domain=${url.host}&sz=64`,
  ];
  for (const candidate of candidates) {
    const dataUri = await tryImage(candidate);
    if (dataUri) return dataUri;
  }
  return '';
}
