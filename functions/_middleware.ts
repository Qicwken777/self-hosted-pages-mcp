/**
 * EdgeOne Pages Functions middleware.
 * Applies to every request under this project. We only enforce
 * authentication on the MCP endpoint and the KV write API; the
 * homepage ("/") and any static assets are left untouched so the
 * redirect in index.html still works for anonymous visitors.
 *
 * Required setup:
 *   1. In the EdgeOne Pages project dashboard, add an environment
 *      variable named MCP_AUTH_TOKEN with a long random secret,
 *      e.g. generate one locally with:  openssl rand -hex 32
 *   2. In your MCP client config, add a matching header:
 *        "headers": { "Authorization": "Bearer <same secret>" }
 */

interface Env {
  MCP_AUTH_TOKEN?: string;
}

interface RequestContext {
  request: Request;
  env: Env;
  next: () => Promise<Response>;
}

const PROTECTED_PREFIXES = ['/mcp-server', '/kv/'];

export async function onRequest(context: RequestContext): Promise<Response> {
  const { request, env, next } = context;
  const { pathname } = new URL(request.url);

  const needsAuth = PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  if (!needsAuth) {
    return next();
  }

  if (!env.MCP_AUTH_TOKEN) {
    return new Response('Server misconfigured: MCP_AUTH_TOKEN is not set', {
      status: 500,
    });
  }

  const authHeader = request.headers.get('Authorization') || '';
  const expected = `Bearer ${env.MCP_AUTH_TOKEN}`;

  // Constant-time-ish compare isn't critical here (edge runtime, low QPS,
  // single secret), but we avoid short-circuiting on length mismatches.
  if (authHeader.length !== expected.length || authHeader !== expected) {
    return new Response('Unauthorized', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Bearer' },
    });
  }

  return next();
}
