import crypto from 'node:crypto';

export function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
export function signature(secret, kind, ts, nonce, route, body, status = '') {
  const hash = crypto.createHash('sha256').update(body).digest('hex');
  return crypto.createHmac('sha256', secret).update(['swag-bridge-v1', kind, String(ts), nonce, route, String(status), hash].join('\n')).digest('hex');
}
export function signedHeaders(secret, method, route, body = '', ts = String(Math.floor(Date.now() / 1000)), nonce = crypto.randomBytes(24).toString('hex')) {
  return { 'X-Swag-Time': ts, 'X-Swag-Nonce': nonce, 'X-Swag-Signature': signature(secret, method, ts, nonce, route, body) };
}
export function validRequest(secret, req, body = '', now = Date.now()) {
  const ts = req.headers.get('X-Swag-Time') || '', nonce = req.headers.get('X-Swag-Nonce') || '';
  return /^\d{10,11}$/.test(ts) && /^[a-f0-9]{48}$/.test(nonce) && Math.abs(now / 1000 - Number(ts)) <= 60 &&
    equal(req.headers.get('X-Swag-Signature'), signature(secret, req.method, ts, nonce, new URL(req.url).pathname, body));
}
export function sealFlow(data, secret) {
  const iv = crypto.randomBytes(12), key = crypto.createHash('sha256').update(secret).digest();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(data)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}
export function openFlow(value, secret, now = Date.now()) {
  try {
    const data = Buffer.from(value, 'base64url');
    if (data.length < 29 || data.length > 4096) return null;
    const cipher = crypto.createDecipheriv('aes-256-gcm', crypto.createHash('sha256').update(secret).digest(), data.subarray(0, 12));
    cipher.setAuthTag(data.subarray(12, 28));
    const payload = JSON.parse(Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString());
    return payload.exp > now && payload.exp <= now + 601000 ? payload : null;
  } catch { return null; }
}
export const flowCookie = (name, value, age = 300) => `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${age}`;
export function cookie(req, name) {
  const values = (req.headers.get('cookie') || '').split(';').map(v => v.trim());
  return values.find(v => v.startsWith(name + '='))?.slice(name.length + 1) || '';
}
export const baseOrigin = (env = process.env) => {
  const url = new URL(env.BASE_URL || 'https://swagcs3.netlify.app');
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new Error('invalid_site_origin');
  return url.origin;
};
export function csrfToken(session, env = process.env) {
  return crypto.createHmac('sha256', env.SESSION_SECRET).update(`discord-csrf\n${session.id}\n${session.exp}`).digest('hex');
}
export function checkCsrf(req, session, env = process.env) {
  return req.headers.get('origin') === baseOrigin(env) && equal(req.headers.get('X-Swag-Csrf'), csrfToken(session, env));
}
const json = (status, payload, headers = {}) => new Response(JSON.stringify(payload), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers }
});

export async function bridge(route, data, { env = process.env, fetcher = fetch } = {}) {
  const secret = env.WEBSITE_BRIDGE_SECRET || '';
  if (secret.length < 32 || !env.DISCORD_BRIDGE_URL) throw new Error('not_configured');
  const origin = new URL(env.DISCORD_BRIDGE_URL);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || !['', '/'].includes(origin.pathname)) throw new Error('not_configured');
  const body = JSON.stringify(data), headers = signedHeaders(secret, 'POST', route, body);
  const result = await fetcher(origin.origin + route, { method: 'POST', body,
    headers: { ...headers, 'Content-Type': 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(12000) });
  const bytes = Buffer.from(await result.arrayBuffer());
  if (bytes.length > 32768 || !equal(result.headers.get('X-Swag-Signature'),
      signature(secret, 'response', headers['X-Swag-Time'], headers['X-Swag-Nonce'], route, bytes, result.status))) throw new Error('bridge_unavailable');
  const payload = JSON.parse(bytes.toString());
  if (!result.ok) {
    const allowed = ['steam_already_linked', 'discord_already_linked', 'role_not_manageable', 'discord_unavailable', 'oauth_replayed', 'swag_only', 'self_unlink_disabled', 'link_changed', 'not_linked'];
    throw new Error(allowed.includes(payload.error) ? payload.error : 'bridge_unavailable');
  }
  return payload;
}

export function createDiscordIntegration({ readSession, loadRoles, env = process.env, fetcher = fetch, callBridge } = {}) {
  const call = callBridge || ((route, payload) => bridge(route, payload, { env, fetcher }));
  const configured = () => !!env.DISCORD_CLIENT_ID && !!env.DISCORD_CLIENT_SECRET &&
    !!env.SESSION_SECRET && (env.WEBSITE_BRIDGE_SECRET || '').length >= 32 && !!env.DISCORD_BRIDGE_URL;
  return async function discordHandler(req) {
    const url = new URL(req.url), route = url.pathname, base = baseOrigin(env);
    if (route === '/api/discord/roles') {
      if (req.method !== 'GET' || url.search || (env.WEBSITE_BRIDGE_SECRET || '').length < 32 || !validRequest(env.WEBSITE_BRIDGE_SECRET, req)) return json(401, { error: 'unauthorized' });
      let result;
      try { result = json(200, { roles: await loadRoles() }); }
      catch { result = json(503, { error: 'roles_unavailable' }); }
      const bytes = await result.clone().text();
      result.headers.set('X-Swag-Signature', signature(env.WEBSITE_BRIDGE_SECRET, 'response',
        req.headers.get('X-Swag-Time'), req.headers.get('X-Swag-Nonce'), route, bytes, result.status));
      return result;
    }
    const me = readSession(req);
    if (!me) return json(401, { error: 'not_logged_in' });
    // Self-service unlinking stays disabled, including for privileged accounts.
    if (route === '/api/discord/unlink') return json(403, { error: 'unlink_disabled' });
    if (route === '/api/discord' && req.method === 'GET') {
      const common = { configured: configured(), csrf: csrfToken(me, env), unlinkAllowed: false };
      if (!configured()) return json(200, { ...common, linked: false });
      try { return json(200, { ...common, ...(await call('/v1/website/status', { steam_id: me.id })) }); }
      catch { return json(503, { ...common, error: 'bridge_unavailable' }); }
    }
    if (route !== '/auth/discord/callback' && (req.method !== 'POST' || !checkCsrf(req, me, env))) return json(403, { error: 'csrf' });
    if (route === '/api/discord/admin-unlink') {
      let roles;
      try { roles = await loadRoles(); } catch { return json(503, { error: 'roles_unavailable' }); }
      if (roles?.[me.id] !== 'swag') return json(403, { error: 'swag_only' });
      const raw = await req.text();
      if (raw.length > 1024) return json(413, { error: 'too_large' });
      let body; try { body = JSON.parse(raw); } catch { return json(400, { error: 'bad_target' }); }
      const target = body?.steam_id, expected = body?.discord_id;
      if (typeof target !== 'string' || !/^\d{17}$/.test(target) || typeof expected !== 'string' || !/^\d{17,20}$/.test(expected)) return json(400, { error: 'bad_target' });
      if (target === me.id) return json(403, { error: 'self_unlink_disabled' });
      if (!configured()) return json(503, { error: 'not_configured' });
      try {
        const result = await call('/v1/website/unlink', { steam_id: target, discord_id: expected, actor_steam_id: me.id });
        return json(200, { ok: true, linked: result.linked });
      } catch (error) {
        const status = ['swag_only', 'self_unlink_disabled'].includes(error.message) ? 403 : ['link_changed', 'not_linked'].includes(error.message) ? 409 : 503;
        return json(status, { error: ['swag_only', 'self_unlink_disabled', 'link_changed', 'not_linked', 'role_not_manageable', 'discord_unavailable'].includes(error.message) ? error.message : 'bridge_unavailable' });
      }
    }
    if (!configured()) return json(503, { error: 'not_configured' });
    if (route === '/auth/discord') {
      const state = crypto.randomBytes(24).toString('hex'), verifier = crypto.randomBytes(48).toString('base64url');
      const flow = sealFlow({ steam_id: me.id, state, verifier, exp: Date.now() + 300000 }, env.SESSION_SECRET);
      const query = new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, response_type: 'code', scope: 'identify',
        redirect_uri: base + '/auth/discord/callback', state, code_challenge_method: 'S256',
        code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), prompt: 'consent' });
      return json(200, { url: 'https://discord.com/oauth2/authorize?' + query }, { 'Set-Cookie': flowCookie('swag_discord_oauth', flow) });
    }
    if (route === '/auth/discord/callback') {
      const finish = code => new Response(null, { status: 302, headers: {
        Location: '/?discord=' + code + '#profile', 'Cache-Control': 'no-store',
        'Set-Cookie': flowCookie('swag_discord_oauth', '', 0), 'Referrer-Policy': 'no-referrer'
      } });
      const flow = openFlow(cookie(req, 'swag_discord_oauth'), env.SESSION_SECRET);
      if (req.method !== 'GET' || !flow || flow.steam_id !== me.id || !equal(flow.state, url.searchParams.get('state')) ||
          (url.searchParams.has('iss') && url.searchParams.get('iss') !== 'https://discord.com')) return finish('invalid_state');
      if (url.searchParams.has('error')) return finish('cancelled');
      const code = url.searchParams.get('code');
      if (!code || code.length > 2048) return finish('invalid_state');
      try {
        const tokenResult = await fetcher('https://discord.com/api/v10/oauth2/token', { method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, redirect: 'error', signal: AbortSignal.timeout(10000),
          body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET,
            grant_type: 'authorization_code', code, redirect_uri: base + '/auth/discord/callback', code_verifier: flow.verifier }) });
        if (!tokenResult.ok) return finish('authorization_failed');
        const token = await tokenResult.json();
        if (!token.access_token || !String(token.scope).split(' ').includes('identify')) return finish('authorization_failed');
        const profileResult = await fetcher('https://discord.com/api/v10/users/@me', {
          headers: { Authorization: 'Bearer ' + token.access_token }, redirect: 'error', signal: AbortSignal.timeout(10000) });
        if (!profileResult.ok) return finish('authorization_failed');
        const user = await profileResult.json();
        if (!/^\d{17,20}$/.test(user.id) || user.bot) return finish('authorization_failed');
        // OAuth tokens are used only for this identity check; neither token is stored or returned to the browser.
        await call('/v1/website/link', { steam_id: me.id, discord_id: user.id,
          username: String(user.global_name || user.username || 'Discord').slice(0, 80), oauth_nonce: flow.state });
        return finish('linked');
      } catch (error) {
        return finish(['steam_already_linked', 'discord_already_linked'].includes(error.message) ? error.message : 'unavailable');
      }
    }
    if (route === '/api/discord/sync') {
      // A member may request a refresh, but cannot supply a role or target member.
      try { return json(202, await call('/v1/website/reconcile', {})); }
      catch { return json(503, { error: 'bridge_unavailable' }); }
    }
    return json(404, { error: 'not_found' });
  };
}
