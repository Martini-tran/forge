import { protocol, session, type Session } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { enabledPluginDir } from './runtime';

/**
 * The `plugin://<id>/<path>` protocol serves a view plugin's UI assets from its
 * own directory. Each plugin gets a distinct, stable origin (`plugin://<id>`),
 * which lets us isolate storage and apply a strict CSP — neither of which
 * `file://` provides. The handler hard-pins reads to one plugin dir and rejects
 * path traversal, and only serves ENABLED plugins.
 */

const SCHEME = 'plugin';

// Locked-down policy for plugin UIs: no remote code, no network beyond the
// bridge, scripts/styles only from the plugin's own origin.
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

function contentType(file: string): string {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

function headers(file: string): HeadersInit {
  return { 'Content-Type': contentType(file), 'Content-Security-Policy': CSP };
}

/** Register the privileged scheme. MUST run before `app.ready`. */
export function registerPluginSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true },
    },
  ]);
}

async function handle(request: GlobalRequest): Promise<Response> {
  try {
    const url = new URL(request.url);
    const id = url.hostname;
    const dir = enabledPluginDir(id);
    if (!dir) return new Response('plugin not found', { status: 404 });

    // realpath the plugin dir so the containment check survives symlinks.
    const realDir = await fs.realpath(dir);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const target = path.normalize(path.join(realDir, rel));

    // Containment guard: the resolved target must stay inside the plugin dir.
    let real = target;
    try {
      real = await fs.realpath(target);
    } catch {
      /* file may not exist yet — fall through to the read 404 */
    }
    if (real !== realDir && !real.startsWith(realDir + path.sep)) {
      return new Response('forbidden', { status: 403 });
    }

    const data = await fs.readFile(target);
    return new Response(data, { headers: headers(target) });
  } catch {
    return new Response('not found', { status: 404 });
  }
}

// `protocol.handle` only binds the default session; webviews on a custom
// partition use a different session that needs its own handler.
const registered = new WeakSet<Session>();

/** Install the `plugin://` handler on a session (idempotent per session). */
export function registerPluginProtocolOn(ses: Session): void {
  if (registered.has(ses)) return;
  ses.protocol.handle(SCHEME, handle);
  registered.add(ses);
}

/** Install the handler on the default session. Call after `app.ready`. */
export function registerPluginProtocol(): void {
  registerPluginProtocolOn(session.defaultSession);
}
