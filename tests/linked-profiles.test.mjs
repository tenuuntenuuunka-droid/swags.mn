import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { linkedProfiles, discordFields } from '../netlify/lib/linked-profiles.mjs';
import { signature } from '../netlify/lib/discord.mjs';
import handler from '../netlify/functions/steam.mjs';

const owner = '76561199487127340', originalOwner = '76561198744192723';
const discordId = '123456789012345678';

test('roster lookups batch unique valid IDs and expose only public identity', async () => {
  const calls = [];
  const ids = Array.from({ length: 101 }, (_, i) => String(76561190000000000n + BigInt(i)));
  const result = await linkedProfiles([...ids, ids[0], 'invalid'], { callBridge: async (route, body) => {
    assert.equal(route, '/v1/website/profiles'); calls.push(body.steam_ids);
    return { profiles: Object.fromEntries([...body.steam_ids.map(id => [id, { discord_id: discordId, username: '<V12>', sync_state: 'private', token: 'private' }]), ['not-requested', { discord_id: discordId, username: 'hidden' }]]) };
  } });
  assert.deepEqual(calls.map(chunk => chunk.length), [50, 50, 1]);
  assert.equal(Object.keys(result.profiles).length, 101);
  assert.deepEqual(result.profiles[ids[0]], { id: discordId, username: '<V12>' });
  assert.equal(result.profiles['not-requested'], undefined);
  assert.equal(discordFields(result, ids[0]).discord_status, 'linked');
});

test('outages remain distinct from an unlinked account and do not break Steam data', async () => {
  const offline = await linkedProfiles([owner], { callBridge: async () => { throw Error('offline'); } });
  assert.deepEqual(discordFields(offline, owner), { discord: null, discord_status: 'unavailable' });
  const empty = await linkedProfiles([owner], { callBridge: async () => ({ profiles: {} }) });
  assert.deepEqual(discordFields(empty, owner), { discord: null, discord_status: 'unlinked' });
  const malformed = await linkedProfiles([owner], { callBridge: async () => ({ profiles: { [owner]: { discord_id: 'javascript:alert(1)', username: 'bad' } } }) });
  assert.equal(malformed.profiles[owner], undefined);
});

test('real profile, team and session routes include verified Discord and server-owned roles', async t => {
  const previous = { ...process.env }, key = 'test-only-secret-'.repeat(5), origin = 'https://swag-login-test.example';
  Object.assign(process.env, { SESSION_SECRET: key, BASE_URL: origin, DISCORD_BRIDGE_URL: 'https://bot.example.test', WEBSITE_BRIDGE_SECRET: key });
  delete process.env.STEAM_API_KEY;
  t.after(() => { for (const name of Object.keys(process.env)) if (!(name in previous)) delete process.env[name]; Object.assign(process.env, previous); });
  t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === 'https://bot.example.test/v1/website/profiles') {
      const ids = JSON.parse(options.body).steam_ids;
      const body = JSON.stringify({ profiles: ids.includes(owner) ? { [owner]: { discord_id: discordId, username: 'V12' } } : {} });
      return new Response(body, { headers: { 'X-Swag-Signature': signature(key, 'response', options.headers['X-Swag-Time'], options.headers['X-Swag-Nonce'], '/v1/website/profiles', body, 200) } });
    }
    assert.match(url, /^https:\/\/steamcommunity\.com\/profiles\/\d{17}\?xml=1$/);
    return new Response('<profile><steamID>Steam test</steamID><avatarFull>https://example.com/avatar.png</avatarFull></profile>');
  });
  const sessionCookie = (id, extra = {}) => {
    const body = Buffer.from(JSON.stringify({ id, name: 'Steam test', exp: Date.now() + 60000, ...extra })).toString('base64url');
    return 'swag=' + body + '.' + crypto.createHmac('sha256', key).update(body).digest('base64url');
  };
  const me = await (await handler(new Request(origin + '/api/me', { headers: { Cookie: sessionCookie(owner) } }))).json();
  assert.equal(me.staff, 'owner'); assert.deepEqual(me.discord, { id: discordId, username: 'V12' });
  const other = await (await handler(new Request(origin + '/api/me', { headers: { Cookie: sessionCookie('76561190000000000', { staff: 'owner' }) } }))).json();
  assert.equal(other.staff, '');
  const player = await (await handler(new Request(origin + '/api/player?id=' + owner))).json();
  assert.equal(player.staff, 'owner'); assert.deepEqual(player.discord, me.discord);
  const team = await (await handler(new Request(origin + '/api/team'))).json();
  assert.equal(team.members.find(member => member.id === owner).discord.username, 'V12');
  assert.equal(team.members.find(member => member.id === originalOwner).role, 'owner');
});
