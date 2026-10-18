import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createDiscordIntegration, csrfToken, signedHeaders, signature, validRequest, sealFlow, openFlow, bridge } from '../netlify/lib/discord.mjs';

const origin = 'https://swagcs3.netlify.app';
const env = { BASE_URL: origin, SESSION_SECRET: 'a'.repeat(64), WEBSITE_BRIDGE_SECRET: 'b'.repeat(64),
  DISCORD_CLIENT_ID: '1559602636217651220', DISCORD_CLIENT_SECRET: 'test-only', DISCORD_BRIDGE_URL: 'https://bot.example.com' };
const session = { id: '76561198744192723', exp: Date.now() + 86400000 };
const get = (path, headers = {}) => new Request(origin + path, { headers });
const post = (path, headers = {}) => new Request(origin + path, { method: 'POST',
  headers: { Origin: origin, 'X-Swag-Csrf': csrfToken(session, env), ...headers } });
const handler = (options = {}) => createDiscordIntegration({ env, readSession: () => session,
  loadRoles: async () => ({ [session.id]: 'vip' }), callBridge: async () => ({ linked: false, account: null }), ...options });

test('encrypted OAuth flows expire and cannot be modified', () => {
  const flow = sealFlow({ secret: 'never-public', exp: Date.now() + 300000 }, env.SESSION_SECRET);
  assert.ok(!flow.includes('never-public'));
  assert.equal(openFlow(flow, env.SESSION_SECRET).secret, 'never-public');
  assert.equal(openFlow(flow, 'wrong'), null);
  assert.equal(openFlow(flow, env.SESSION_SECRET, Date.now() + 310000), null);
  assert.equal(openFlow(flow.slice(0, -5) + 'aaaaa', env.SESSION_SECRET), null);
});
test('signed requests bind method, route, body, nonce and time', () => {
  const headers = signedHeaders(env.WEBSITE_BRIDGE_SECRET, 'GET', '/api/discord/roles');
  assert.equal(validRequest(env.WEBSITE_BRIDGE_SECRET, get('/api/discord/roles', headers)), true);
  assert.equal(validRequest(env.WEBSITE_BRIDGE_SECRET, get('/api/discord/sync', headers)), false);
  assert.equal(validRequest(env.WEBSITE_BRIDGE_SECRET, get('/api/discord/roles', headers), 'altered'), false);
  assert.equal(validRequest(env.WEBSITE_BRIDGE_SECRET, get('/api/discord/roles', headers), '', Date.now() + 70000), false);
});
test('linking requires Steam authentication and CSRF on the configured origin', async () => {
  assert.equal((await handler({ readSession: () => null })(post('/auth/discord'))).status, 401);
  assert.equal((await handler()(get('/auth/discord'))).status, 403);
  assert.equal((await handler()(post('/auth/discord', { Origin: 'https://attacker.example' }))).status, 403);
  assert.equal((await handler()(post('/auth/discord', { 'X-Swag-Csrf': 'wrong' }))).status, 403);
});
test('authorization uses identify only, PKCE, expiring HttpOnly state and the exact callback', async () => {
  const result = await handler()(post('/auth/discord'));
  assert.equal(result.status, 200);
  const cookie = result.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /Max-Age=300/);
  const url = new URL((await result.json()).url);
  assert.equal(url.searchParams.get('scope'), 'identify');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('redirect_uri'), origin + '/auth/discord/callback');
  const flow = openFlow(cookie.split(';')[0].split('=')[1], env.SESSION_SECRET);
  assert.equal(flow.steam_id, session.id);
  assert.equal(url.searchParams.get('code_challenge'), crypto.createHash('sha256').update(flow.verifier).digest('base64url'));
});
test('invalid callback state or another Steam session never reaches Discord or the bridge', async () => {
  const start = await handler()(post('/auth/discord'));
  const flowCookie = start.headers.get('set-cookie').split(';')[0];
  let calls = 0;
  const run = handler({ fetcher: async () => { calls++; throw new Error(); } });
  const result = await run(get('/auth/discord/callback?state=wrong&code=x', { Cookie: flowCookie }));
  assert.match(result.headers.get('location'), /invalid_state/); assert.equal(calls, 0);
  const query = new URL((await start.json()).url).searchParams;
  const other = handler({ readSession: () => ({ ...session, id: '76561190000000000' }), fetcher: async () => { calls++; } });
  const result2 = await other(get('/auth/discord/callback?state=' + query.get('state') + '&code=x', { Cookie: flowCookie }));
  assert.match(result2.headers.get('location'), /invalid_state/); assert.equal(calls, 0);
});
test('successful callback uses verified Discord identity and never returns access tokens', async () => {
  const start = await handler()(post('/auth/discord'));
  const state = new URL((await start.json()).url).searchParams.get('state');
  const flowCookie = start.headers.get('set-cookie').split(';')[0];
  let payload;
  const run = handler({ fetcher: async (url, init) => {
    if (url.endsWith('/oauth2/token')) {
      assert.ok(init.body.get('code_verifier')); assert.equal(init.body.get('client_secret'), env.DISCORD_CLIENT_SECRET);
      return Response.json({ access_token: 'PRIVATE-TOKEN', scope: 'identify' });
    }
    assert.equal(url, 'https://discord.com/api/v10/users/@me');
    assert.equal(init.headers.Authorization, 'Bearer PRIVATE-TOKEN');
    return Response.json({ id: '123456789012345678', username: 'Alice' });
  }, callBridge: async (route, data) => { assert.equal(route, '/v1/website/link'); payload = data; return {}; } });
  const result = await run(get('/auth/discord/callback?state=' + state + '&code=x', { Cookie: flowCookie }));
  assert.equal(payload.discord_id, '123456789012345678'); assert.equal(payload.steam_id, session.id);
  assert.equal(payload.oauth_nonce, state);
  assert.match(result.headers.get('location'), /discord=linked/);
  assert.ok(!JSON.stringify([...result.headers]).includes('PRIVATE-TOKEN'));
  assert.ok(!JSON.stringify(payload).includes('PRIVATE-TOKEN'));
});
test('a failed identity lookup never links, and duplicate links are reported without secrets', async () => {
  const start = await handler()(post('/auth/discord'));
  const state = new URL((await start.json()).url).searchParams.get('state');
  let calls = 0;
  const run = handler({ fetcher: async () => new Response('no', { status: 401 }), callBridge: async () => { calls++; } });
  const result = await run(get('/auth/discord/callback?state=' + state + '&code=x', { Cookie: start.headers.get('set-cookie').split(';')[0] }));
  assert.match(result.headers.get('location'), /authorization_failed/); assert.equal(calls, 0);
});
test('role feed fails closed on storage failure and signs the error', async () => {
  const headers = signedHeaders(env.WEBSITE_BRIDGE_SECRET, 'GET', '/api/discord/roles');
  assert.equal((await handler()(get('/api/discord/roles'))).status, 401);
  const result = await handler({ loadRoles: async () => { throw new Error('storage offline'); } })(get('/api/discord/roles', headers));
  assert.equal(result.status, 503);
  assert.equal(result.headers.get('X-Swag-Signature'), signature(env.WEBSITE_BRIDGE_SECRET, 'response',
    headers['X-Swag-Time'], headers['X-Swag-Nonce'], '/api/discord/roles', await result.text(), 503));
});
test('member refresh ignores attempted role injection', async () => {
  let args;
  const run = handler({ callBridge: async (...values) => { args = values; return {}; } });
  assert.equal((await run(post('/api/discord/sync'))).status, 202);
  assert.deepEqual(args, ['/v1/website/reconcile', {}]);
});

test('website unlink requests are disabled without changing a saved link or calling the bot', async () => {
  const calls = [], account = { discord_id: '123456789012345678', username: 'Alice', sync_state: 'synced' };
  const run = handler({ callBridge: async (route, payload) => {
    calls.push([route, payload]);
    assert.equal(route, '/v1/website/status');
    return { linked: true, account };
  } });
  for (const request of [get('/api/discord/unlink'), post('/api/discord/unlink'), post('/api/discord/unlink', { 'X-Swag-Csrf': 'wrong' }),
    new Request(origin + '/api/discord/unlink', { method: 'DELETE' })]) {
    const result = await run(request);
    assert.equal(result.status, 403);
    assert.deepEqual(await result.json(), { error: 'unlink_disabled' });
  }
  assert.equal(calls.length, 0);
  const result = await (await run(get('/api/discord'))).json();
  assert.equal(result.unlinkAllowed, false); assert.equal(result.linked, true);
  assert.deepEqual(result.account, account);
  assert.equal(calls.length, 1);
  assert.equal((await handler({ readSession: () => null })(post('/api/discord/unlink'))).status, 401);
});
test('bridge rejects unsigned, tampered, oversized and redirected responses', async () => {
  await assert.rejects(bridge('/v1/website/status', {}, { env, fetcher: async (_, init) => {
    assert.equal(init.redirect, 'error'); return Response.json({ linked: true });
  } }), /bridge_unavailable/);
});
