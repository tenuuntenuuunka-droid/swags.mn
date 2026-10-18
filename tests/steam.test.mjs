import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../netlify/functions/steam.mjs';

const origin = 'https://swag-login-test.example';
const steamId = '76561198744192723';
const ns = 'http://specs.openid.net/auth/2.0';

function settings(t, configured = true) {
  const previous = { ...process.env };
  for (const key of ['BASE_URL', 'SESSION_SECRET', 'STEAM_API_KEY', 'DISCORD_CLIENT_SECRET', 'WEBSITE_BRIDGE_SECRET']) delete process.env[key];
  if (configured) {
    process.env.BASE_URL = origin;
    process.env.SESSION_SECRET = 'test-only-session-secret-'.repeat(3);
  }
  t.after(() => {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  });
}

async function begin() {
  const result = await handler(new Request(origin + '/auth/steam'));
  assert.equal(result.status, 302);
  const steam = new URL(result.headers.get('location'));
  assert.equal(steam.origin + steam.pathname, 'https://steamcommunity.com/openid/login');
  return { steam, cookie: result.headers.get('set-cookie').split(';')[0] };
}

function callback(steam) {
  const result = new URL(steam.searchParams.get('openid.return_to'));
  result.searchParams.set('openid.ns', ns);
  result.searchParams.set('openid.mode', 'id_res');
  result.searchParams.set('openid.return_to', steam.searchParams.get('openid.return_to'));
  result.searchParams.set('openid.claimed_id', 'https://steamcommunity.com/openid/id/' + steamId);
  return result;
}

test('a new Netlify project reports its missing session configuration', async t => {
  settings(t, false);
  t.mock.method(console, 'error', () => {});
  const result = await handler(new Request(origin + '/auth/steam'));
  assert.match(new URL(result.headers.get('location'), origin).searchParams.get('why'), /SESSION_SECRET/);
  const me = await handler(new Request(origin + '/api/me'));
  assert.equal(me.status, 500);
  assert.match((await me.json()).error, /SESSION_SECRET/);
});

test('Steam uses the new project URL without any Discord credentials', async t => {
  settings(t);
  const { steam, cookie } = await begin();
  assert.equal(steam.searchParams.get('openid.realm'), origin);
  assert.equal(new URL(steam.searchParams.get('openid.return_to')).origin, origin);
  assert.match(cookie, /^swag_steam_oauth=/);
});

test('verified Steam callback creates a session recognized by api/me', async t => {
  settings(t);
  t.mock.method(console, 'error', () => {}); // No Netlify storage credentials in offline tests.
  let verifications = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === 'https://steamcommunity.com/openid/login') {
      verifications++;
      assert.equal(options.method, 'POST');
      assert.equal(options.body.get('openid.mode'), 'check_authentication');
      return new Response('is_valid:true\n');
    }
    assert.equal(url, `https://steamcommunity.com/profiles/${steamId}?xml=1`);
    return new Response('<profile><steamID><![CDATA[SWAG Test]]></steamID><avatarFull>https://example.com/avatar.png</avatarFull></profile>');
  });
  const { steam, cookie } = await begin();
  const result = await handler(new Request(callback(steam), { headers: { Cookie: cookie } }));
  assert.equal(result.headers.get('location'), '/?login=ok');
  assert.equal(verifications, 1);
  assert.match(result.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Lax/);
  const me = await handler(new Request(origin + '/api/me', { headers: { Cookie: result.headers.get('set-cookie').split(';')[0] } }));
  assert.equal(me.status, 200);
  const profile = await me.json();
  assert.equal(profile.id, steamId);
  assert.equal(profile.name, 'SWAG Test');
  assert.equal(profile.staff, 'owner');
  assert.ok(profile.csrf);
});

test('callbacks without the login cookie or Steam verification cannot sign in', async t => {
  settings(t);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('is_valid:false\n'); });
  const { steam, cookie } = await begin();
  const missing = await handler(new Request(callback(steam)));
  assert.equal(missing.headers.get('location'), '/?login=error&why=state');
  assert.equal(calls, 0);
  const unverified = await handler(new Request(callback(steam), { headers: { Cookie: cookie } }));
  assert.equal(unverified.headers.get('location'), '/?login=error&why=verify');
  assert.equal(calls, 1);
  assert.equal(unverified.headers.get('set-cookie'), null);
});
