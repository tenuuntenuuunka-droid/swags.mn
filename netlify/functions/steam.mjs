// Netlify Function: бодит Steam нэвтрэлт (OpenID 2.0). Cookie-д гарын үсэгтэй session хадгална (серверийн төлөвгүй).
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createDiscordIntegration, bridge, csrfToken, checkCsrf, sealFlow, openFlow, flowCookie, cookie, equal } from '../lib/discord.mjs';

export const config = { path: ['/auth/steam', '/auth/steam/return', '/api/me', '/api/logout', '/api/skins', '/api/leaderboard', '/api/pfimg', '/api/player', '/api/team', '/api/staff', '/api/clans', '/api/clans.js', '/api/wars', '/auth/discord', '/auth/discord/callback', '/api/discord', '/api/discord/unlink', '/api/discord/sync', '/api/discord/roles'] };

const OPENID = 'https://steamcommunity.com/openid/login';
const NS = 'http://specs.openid.net/auth/2.0';

const secret = () => {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET env variable is not set');
  return s;
};
const sign = v => crypto.createHmac('sha256', secret()).update(v).digest('base64url');
const makeCookie = o => { const b = Buffer.from(JSON.stringify(o)).toString('base64url'); return b + '.' + sign(b); };
function readCookie(req) {
  const m = /(?:^|;\s*)swag=([^;]+)/.exec(req.headers.get('cookie') || ''); if (!m) return null;
  const [b, s] = m[1].split('.'); if (!b || !s) return null;
  const a = Buffer.from(sign(b)), c = Buffer.from(s);
  if (a.length !== c.length || !crypto.timingSafeEqual(a, c)) return null;
  try { const o = JSON.parse(Buffer.from(b, 'base64url').toString()); return o.exp > Date.now() ? o : null; } catch { return null; }
}
const cookieHdr = (v, age) => `swag=${v}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
const redirect = (loc, extra = {}) => new Response(null, { status: 302, headers: { Location: loc, ...extra } });
const json = (code, o, extra = {}) => new Response(JSON.stringify(o), { status: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra } });

async function verify(url, base) {
  const q = Object.fromEntries(url.searchParams);
  if (q['openid.ns'] !== NS || q['openid.mode'] !== 'id_res') return null;
  if (!(q['openid.return_to'] || '').startsWith(base + '/auth/steam/return')) return null;
  const p = new URLSearchParams(url.searchParams); p.set('openid.mode', 'check_authentication');
  const r = await fetch(OPENID, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: p });
  if (!/is_valid\s*:\s*true/.test(await r.text())) return null;
  const m = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/.exec(q['openid.claimed_id'] || '');
  return m ? m[1] : null;
}

// Rating: RATINGS_URL (JSON) эсвэл netlify/functions/ratings.json. Формат: {"7656119...": 1850} эсвэл [{"steamid":"7656119...","rating":1850}]
const nn = x => Math.max(0, Math.round(+x || 0));
function norm(id, v) {
  if (v == null) return null;
  if (typeof v !== 'object') return { id, rating: nn(v), stats: null };
  const stats = { kills: nn(v.kills ?? v.k), deaths: nn(v.deaths ?? v.d), assists: nn(v.assists ?? v.a), wins: nn(v.wins ?? v.w), losses: nn(v.losses ?? v.l),
    hs: nn(v.hs), shots: nn(v.shots), hits: nn(v.hits), damage: nn(v.damage ?? v.dmg), time: v.time || '', last: v.last || '' };
  return { id, rating: nn(v.rating ?? v.exp), stats: (stats.kills || stats.deaths || stats.wins || stats.losses) ? stats : null };
}
async function loadAll() {
  let d;
  if (process.env.RATINGS_URL) d = await (await fetch(process.env.RATINGS_URL)).json();
  else d = JSON.parse(readFileSync(new URL('./ratings.json', import.meta.url), 'utf8'));
  const arr = Array.isArray(d) ? d : (d.players || null);
  if (arr) return arr.map(x => norm(String(x.steamid || x.id || x.steamId), x)).filter(Boolean);
  return Object.keys(d).map(k => norm(k, d[k])).filter(Boolean);
}
async function ratingOf(id) {
  try {
    const all = (await loadAll()).filter(x => x.rating > 0).sort((a, b) => b.rating - a.rating);
    const i = all.findIndex(x => x.id === id);
    return i < 0 ? { rating: 0, stats: null, place: 0, players: all.length } : { rating: all[i].rating, stats: all[i].stats, place: i + 1, players: all.length };
  } catch (e) { console.error('rating', e.message); return { rating: 0, stats: null, place: 0, players: 0 }; }
}
const STAFF_ROLES = ['owner', 'coowner', 'founder', 'manager', 'moderator', 'boss', 'vip', 'admin'];
function seedStaff() {
  try { const d = JSON.parse(readFileSync(new URL('./staff.json', import.meta.url), 'utf8')); const o = {}; for (const k in d) if (/^\d{17}$/.test(k) && STAFF_ROLES.includes(d[k])) o[k] = d[k]; return o; }
  catch (e) { console.error('staff', e.message); return {}; }
}
// Staff жагсаалт: staff.json дахь "owner"-ууд (super owner) байнга түгжигдсэн. Бусад role-ыг сайтаас (Netlify Blobs) удирдана.
const strongStore = async name => { const { getStore } = await import('@netlify/blobs'); return getStore({ name, consistency: 'strong' }); };
const staffStore = async () => strongStore('staff');
// Нэвтэрсэн хүн бүрийн нэр/зургийг хадгална — role авсан хүн "Steam 123456" биш жинхэнэ нэрээрээ харагдана
async function saveProfile(p) { try { await (await strongStore('profiles')).setJSON(p.id, { name: p.name, avatar: p.avatar || '', profileUrl: p.profileUrl || '' }); } catch (e) { console.error('saveProfile', e.message); } }
async function savedProfile(id) { try { return await (await strongStore('profiles')).get(id, { type: 'json' }); } catch { return null; } }
async function loadStaff(strict = false) {
  const seed = seedStaff(), locked = {};
  for (const k in seed) if (seed[k] === 'owner') locked[k] = 'owner';
  let saved = null;
  try { saved = await (await staffStore()).get('all', { type: 'json' }); } catch (error) { if (strict) throw new Error('roles_unavailable'); saved = null; }
  if (strict && saved !== null && (typeof saved !== 'object' || Array.isArray(saved))) throw new Error('roles_unavailable');
  if (strict && saved && Object.entries(saved).some(([id, role]) => !/^\d{17}$/.test(id) || !STAFF_ROLES.includes(role))) throw new Error('roles_unavailable');
  if (!saved || typeof saved !== 'object') return { ...seed };
  const o = {}; for (const k in saved) if (/^\d{17}$/.test(k) && STAFF_ROLES.includes(saved[k])) o[k] = saved[k];
  return { ...o, ...locked };
}
const superOwners = () => Object.keys(seedStaff()).filter(k => seedStaff()[k] === 'owner');
// Owner role-той хүн сайтаас staff-д role өгөх / солих / хасах
async function staffHandler(req, url) {
  const me = readCookie(req); if (!me) return json(401, { error: 'not_logged_in' });
  let cur; try { cur = await loadStaff(true); } catch { return json(503, { error: 'storage_unavailable' }); }
  if (cur[me.id] !== 'owner') return json(403, { error: 'owner_only' });
  if (req.method === 'GET') return json(200, { roles: STAFF_ROLES, superOwners: superOwners() });
  if (!checkCsrf(req, me)) return json(403, { error: 'csrf' });
  let store; try { store = await staffStore(); } catch { return json(501, { error: 'storage_unavailable' }); }
  const sup = superOwners();
  const b = req.method === 'DELETE' ? { id: url.searchParams.get('id') } : await req.json().catch(() => ({}));
  const id = String(b.id || '').trim();
  if (!/^\d{17}$/.test(id)) return json(400, { error: 'bad_id' });
  if (sup.includes(id)) return json(403, { error: 'locked_owner' });
  const next = { ...cur }; for (const k of sup) delete next[k];
  if (req.method === 'DELETE') {
    if (cur[id] === 'owner' && !sup.includes(me.id)) return json(403, { error: 'super_owner_only' });
    delete next[id];
  } else if (req.method === 'POST') {
    const r = String(b.role || '').toLowerCase();
    if (!STAFF_ROLES.includes(r)) return json(400, { error: 'bad_role' });
    if ((r === 'owner' || cur[id] === 'owner') && !sup.includes(me.id)) return json(403, { error: 'super_owner_only' });
    if (id === me.id) return json(403, { error: 'self' });
    next[id] = r;
  } else return json(405, { error: 'method' });
  await store.setJSON('all', next);
  let discordSync = 'queued';
  try { await bridge('/v1/website/reconcile', {}); } catch { discordSync = 'pending'; }
  return json(200, { ok: true, discord_sync: discordSync });
}
const nameCache = new Map();
async function cachedProfile(id) {
  const c = nameCache.get(id); if (c && Date.now() - c.t < 36e5) return c.p;
  let p = await profile(id);
  if (!p.avatar) { const sv = await savedProfile(id); if (sv && sv.name) p = { id, name: sv.name, avatar: sv.avatar || '', profileUrl: sv.profileUrl || p.profileUrl }; }
  if (p.avatar) nameCache.set(id, { t: Date.now(), p }); return p;
}

async function profile(id) {
  const key = process.env.STEAM_API_KEY;
  const fallback = { id, name: 'Steam ' + id.slice(-6), avatar: '', profileUrl: `https://steamcommunity.com/profiles/${id}` };
  try {
    if (key) {
      const r = await fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${key}&steamids=${id}`);
      const p = (await r.json()).response.players[0];
      if (p) return { id, name: p.personaname, avatar: p.avatarfull, profileUrl: p.profileurl };
    } else {
      const x = await (await fetch(`https://steamcommunity.com/profiles/${id}?xml=1`)).text();
      const g = t => { const m = new RegExp(`<${t}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${t}>`).exec(x); return m && m[1].trim(); };
      if (g('steamID')) return { id, name: g('steamID'), avatar: g('avatarFull'), profileUrl: fallback.profileUrl };
    }
  } catch (e) { console.error(e); }
  return fallback;
}

// Skin loadout хадгалалт: Netlify Blobs (package.json дахь @netlify/blobs). Байхгүй бол 501 → клиент зөвхөн төхөөрөмж дээрээ хадгална.
async function skinStore(name = 'skins') { const { getStore } = await import('@netlify/blobs'); return getStore(name); }
const SKIN_KEYS = ['swagSkinLoadout', 'swagSkinExtras'];

// ---- Клан нээх (зөвхөн staff.json дахь "owner" role) ----
const clanStore = async () => skinStore('clans');
async function readClans() { try { return (await (await clanStore()).get('all', { type: 'json' })) || []; } catch { return []; } }
async function clansHandler(req, url) {
  const asJs = url.pathname === '/api/clans.js';
  const mem = c => Array.isArray(c.members) ? c.members : [];
  const me = readCookie(req);
  const isOwnerRole = !!me && (await loadStaff())[me.id] === 'owner';
  const canManage = c => !!me && (isOwnerRole || String(c.ownerId) === me.id);
  if (req.method === 'GET') {
    const list = await readClans();
    if (asJs) return new Response('window.SWAG_CLANS=' + JSON.stringify(list.map(c => [c.tag, c.name, c.color, c.motto, c.founded, mem(c).length || 1, c.ownerId, mem(c)])) + ';',
      { status: 200, headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' } });
    const t = (url.searchParams.get('tag') || '').toUpperCase();
    if (t) { const c = list.find(x => x.tag === t); if (!c || !canManage(c)) return json(403, { error: 'forbidden' }); return json(200, { requests: c.requests || [] }); }
    return json(200, list.map(c => ({ ...c, requests: undefined })));
  }
  if (!me) return json(401, { error: 'not_logged_in' });
  let store; try { store = await clanStore(); } catch { return json(501, { error: 'storage_unavailable' }); }
  const list = await readClans(), save = () => store.setJSON('all', list);
  if (req.method === 'DELETE') {
    if (!isOwnerRole) return json(403, { error: 'owner_only' });
    const tag = (url.searchParams.get('tag') || '').toUpperCase();
    await store.setJSON('all', list.filter(c => c.tag !== tag)); return json(200, { ok: true });
  }
  if (req.method !== 'POST') return json(405, { error: 'method' });
  const b = await req.json().catch(() => ({})), act = b.action || 'create';
  if (act === 'create') {
    if (!isOwnerRole) return json(403, { error: 'owner_only' });
    const name = String(b.name || '').trim().slice(0, 24), tag = String(b.tag || '').trim().toUpperCase();
    const color = /^#[0-9a-fA-F]{6}$/.test(b.color || '') ? b.color : '#9d00ff', motto = String(b.motto || '').trim().slice(0, 80);
    if (name.length < 2) return json(400, { error: 'name_short' });
    if (!/^[A-Z0-9]{3,7}$/.test(tag)) return json(400, { error: 'bad_tag' });
    if (list.some(c => c.tag === tag || c.name.toLowerCase() === name.toLowerCase())) return json(409, { error: 'duplicate' });
    const oid = b.ownerId && /^\d{17}$/.test(b.ownerId) ? b.ownerId : me.id, pr = await cachedProfile(oid);
    list.push({ tag, name, color, motto, founded: new Date().getFullYear(), ownerId: oid, members: [{ id: oid, name: pr.name, avatar: pr.avatar || '' }], requests: [] });
    await save(); return json(200, { ok: true });
  }
  const c = list.find(x => x.tag === String(b.tag || '').toUpperCase()); if (!c) return json(404, { error: 'no_clan' });
  c.members = mem(c); c.requests = c.requests || [];
  const id = String(b.id || '');
  if (act === 'join') {
    if (c.members.some(m => m.id === me.id)) return json(409, { error: 'already_member' });
    if (c.requests.some(m => m.id === me.id)) return json(409, { error: 'already_requested' });
    c.requests.push({ id: me.id, name: me.name, avatar: me.avatar || '' }); await save(); return json(200, { ok: true });
  }
  if (!canManage(c)) return json(403, { error: 'forbidden' });
  if (!/^\d{17}$/.test(id)) return json(400, { error: 'bad_id' });
  if (act === 'addMember' || act === 'approve') {
    if (!c.members.some(m => m.id === id)) { const rq = c.requests.find(r => r.id === id), pr = rq ? rq : await cachedProfile(id); c.members.push({ id, name: pr.name, avatar: pr.avatar || '' }); }
    c.requests = c.requests.filter(r => r.id !== id);
  } else if (act === 'reject') c.requests = c.requests.filter(r => r.id !== id);
  else if (act === 'removeMember') { if (id === String(c.ownerId)) return json(400, { error: 'cant_remove_leader' }); c.members = c.members.filter(m => m.id !== id); }
  else return json(400, { error: 'bad_action' });
  await save(); return json(200, { ok: true });
}


// ---- Clan War: хүсэлт → зөвшөөрөх (5 мин) → BAN/PICK (veto) → бэлэн ----
const WAR_MAPS = ['Mirage', 'Dust2', 'Inferno', 'Ancient', 'Nuke', 'Anubis', 'Cache', 'Overpass'];
const WAR_PLAN = { 1: 'bbbbbbb', 3: 'bbppbbb', 5: 'bbppppb' };   // b = ban, p = pick; үлдсэн 1 map = decider
const WAR_TTL = 5 * 60 * 1000, WAR_START = 3 * 60 * 1000;
const warStore = async () => strongStore('wars');
async function warsHandler(req) {
  const me = readCookie(req); if (!me) return json(401, { error: 'not_logged_in' });
  let store; try { store = await warStore(); } catch { return json(501, { error: 'storage_unavailable' }); }
  const now = Date.now();
  let wars = []; try { wars = (await store.get('all', { type: 'json' })) || []; } catch { wars = []; }
  let dirty = false;
  for (const w of wars) if (w.status === 'pending' && w.expires < now) { w.status = 'expired'; dirty = true; }
  const save = async () => { await store.setJSON('all', wars.slice(-50)); };
  if (req.method === 'GET') { if (dirty) await save(); return json(200, { now, wars: wars.slice(-30) }); }
  if (req.method !== 'POST') return json(405, { error: 'method' });
  const clans = await readClans(), clan = t => clans.find(c => c.tag === t);
  const leads = t => { const c = clan(t); return !!c && String(c.ownerId) === me.id; };
  const b = await req.json().catch(() => ({})), act = String(b.action || '');
  if (act === 'create') {
    const from = String(b.from || '').toUpperCase(), to = String(b.to || '').toUpperCase(), bo = +b.bo;
    if (!clan(from) || !clan(to) || from === to || !WAR_PLAN[bo]) return json(400, { error: 'bad_clan' });
    if (!leads(from)) return json(403, { error: 'leader_only' });
    if (wars.some(w => (w.status === 'pending' || w.status === 'veto') && [w.from, w.to].some(t => t === from || t === to))) return json(409, { error: 'busy' });
    wars.push({ id: crypto.randomBytes(6).toString('hex'), from, to, bo, status: 'pending', created: now, expires: now + WAR_TTL, steps: [], maps: [], startAt: 0 });
    await save(); return json(200, { ok: true });
  }
  const w = wars.find(x => x.id === String(b.id || '')); if (!w) return json(404, { error: 'not_found' });
  if (act === 'accept' || act === 'decline' || act === 'cancel') {
    if (w.status !== 'pending') { if (dirty) await save(); return json(409, { error: w.status === 'expired' ? 'expired' : 'not_pending' }); }
    if (act === 'cancel') { if (!leads(w.from)) return json(403, { error: 'forbidden' }); w.status = 'cancelled'; }
    else {
      if (!leads(w.to)) return json(403, { error: 'forbidden' });
      if (act === 'decline') w.status = 'declined';
      else { w.status = 'veto'; w.steps = [...WAR_PLAN[w.bo]].map((c, i) => ({ t: c === 'b' ? 'ban' : 'pick', by: i % 2 ? 'to' : 'from', map: null })); }
    }
    await save(); return json(200, { ok: true });
  }
  if (act === 'veto') {
    if (w.status !== 'veto') return json(409, { error: 'not_pending' });
    const m = String(b.map || ''), cur = w.steps.find(x => !x.map);
    if (!cur) return json(409, { error: 'not_pending' });
    if (!leads(w[cur.by])) return json(403, { error: 'not_your_turn' });
    if (!WAR_MAPS.includes(m)) return json(400, { error: 'bad_map' });
    if (w.steps.some(x => x.map === m)) return json(409, { error: 'taken' });
    cur.map = m;
    if (w.steps.every(x => x.map)) {
      const left = WAR_MAPS.find(x => !w.steps.some(y => y.map === x));
      w.maps = [...w.steps.filter(x => x.t === 'pick').map(x => x.map), left];
      w.status = 'ready'; w.startAt = now + WAR_START;
    }
    await save(); return json(200, { ok: true });
  }
  return json(400, { error: 'bad_action' });
}

const discordHandler = createDiscordIntegration({ readSession: readCookie, loadRoles: () => loadStaff(true) });

export default async (req) => {
  const url = new URL(req.url);
  const base = process.env.BASE_URL ? process.env.BASE_URL.replace(/\/$/, '') : url.origin;
  try {
    if (url.pathname.startsWith('/auth/discord') || url.pathname.startsWith('/api/discord')) return await discordHandler(req);
    if (url.pathname === '/auth/steam') {
      const state = crypto.randomBytes(24).toString('hex');
      const p = new URLSearchParams({ 'openid.ns': NS, 'openid.mode': 'checkid_setup',
        'openid.return_to': base + '/auth/steam/return?state=' + state, 'openid.realm': base,
        'openid.identity': NS + '/identifier_select', 'openid.claimed_id': NS + '/identifier_select' });
      return redirect(OPENID + '?' + p, { 'Set-Cookie': flowCookie('swag_steam_oauth', sealFlow({ state, exp: Date.now() + 300000 }, secret())) });
    }
    if (url.pathname === '/auth/steam/return') {
      const flow = openFlow(cookie(req, 'swag_steam_oauth'), secret());
      if (!flow || !equal(flow.state, url.searchParams.get('state')) || url.searchParams.get('openid.return_to') !== base + '/auth/steam/return?state=' + flow.state) return redirect('/?login=error&why=state');
      const id = await verify(url, base);
      if (!id) return redirect('/?login=error&why=verify');
      if (!process.env.SESSION_SECRET) return redirect('/?login=error&why=nosecret');
      const pr = await profile(id); await saveProfile(pr);
      return redirect('/?login=ok', { 'Set-Cookie': cookieHdr(makeCookie({ ...pr, exp: Date.now() + 30 * 864e5 }), 30 * 86400) });
    }
    if (url.pathname === '/api/me') {
      if (!process.env.SESSION_SECRET) return json(500, { error: 'SESSION_SECRET is not set (set it, then redeploy)' });
      const s = readCookie(req); if (!s) return json(401, { error: 'not_logged_in', hasCookie: /swag=/.test(req.headers.get('cookie') || '') });
      return json(200, { id: s.id, name: s.name, avatar: s.avatar, profileUrl: s.profileUrl, ...(await ratingOf(s.id)), staff: (await loadStaff())[s.id] || '', csrf: csrfToken(s) });
    }
    if (url.pathname === '/api/pfimg') {
      const kind = url.searchParams.get('kind'); if (kind !== 'banner' && kind !== 'avatar') return json(400, { error: 'bad_kind' });
      let store; try { store = await skinStore('pfimg'); } catch (e) { return json(501, { error: 'storage_unavailable' }); }
      if (req.method === 'GET') {
        const id = url.searchParams.get('id') || ''; if (!/^\d{17}$/.test(id)) return json(400, { error: 'bad_id' });
        const r = await store.getWithMetadata(id + ':' + kind, { type: 'arrayBuffer' });
        if (!r) return json(404, { error: 'none' });
        return new Response(r.data, { status: 200, headers: { 'Content-Type': r.metadata?.type || 'image/webp', 'Cache-Control': 'public, max-age=300' } });
      }
      const me = readCookie(req); if (!me) return json(401, { error: 'not_logged_in' });
      if (req.method === 'DELETE') { await store.delete(me.id + ':' + kind); return json(200, { ok: true }); }
      if (req.method === 'POST') {
        const type = (req.headers.get('content-type') || '').split(';')[0];
        if (!['image/gif', 'image/webp', 'image/jpeg', 'image/png'].includes(type)) return json(415, { error: 'bad_type' });
        const buf = await req.arrayBuffer(); if (buf.byteLength > 4500000) return json(413, { error: 'too_large' });
        await store.set(me.id + ':' + kind, buf, { metadata: { type } }); return json(200, { ok: true });
      }
      return json(405, { error: 'method' });
    }
    if (url.pathname === '/api/skins') {
      const me = readCookie(req); if (!me) return json(401, { error: 'not_logged_in' });
      let store; try { store = await skinStore(); } catch (e) { return json(501, { error: 'storage_unavailable' }); }
      if (req.method === 'POST') {
        const raw = await req.text(); if (raw.length > 400000) return json(413, { error: 'too_large' });
        const b = JSON.parse(raw), out = {};
        for (const k of SKIN_KEYS) if (typeof b[k] === 'string') out[k] = b[k];
        await store.setJSON(me.id, out); return json(200, { ok: true });
      }
      return json(200, (await store.get(me.id, { type: 'json' })) || {});
    }
    if (url.pathname === '/api/team') {
      const st = await loadStaff(), ids = Object.keys(st);
      const members = await Promise.all(ids.map(async id => { const pr = await cachedProfile(id); return { id, name: pr.name, avatar: pr.avatar, role: st[id] }; }));
      return json(200, { configured: true, members }, { 'Cache-Control': 'public, max-age=10' });
    }
    if (url.pathname === '/api/staff') return await staffHandler(req, url);
    if (url.pathname === '/api/player') {
      const id = url.searchParams.get('id') || ''; if (!/^\d{17}$/.test(id)) return json(400, { error: 'bad_id' });
      const r = await ratingOf(id), stf = (await loadStaff())[id] || '';
      if (!r.rating && !stf) return json(404, { error: 'not_found' });   // rating-гүй ч staff бол профайл нээгдэнэ
      const pr = await cachedProfile(id);
      return json(200, { id, name: pr.name, avatar: pr.avatar, profileUrl: pr.profileUrl, ...r, staff: stf }, { 'Cache-Control': 'public, max-age=10' });
    }
    if (url.pathname === '/api/leaderboard') {
      const all = (await loadAll()).filter(x => x.rating > 0).sort((a, b) => b.rating - a.rating).slice(0, 100);
      const out = await Promise.all(all.map(async x => {
        const pr = await cachedProfile(x.id), st = x.stats || {};
        return { steamid: x.id, name: pr.name, avatar: pr.avatar, exp: x.rating, k: st.kills || 0, d: st.deaths || 0, hs: st.hs || 0, time: st.time || '—', last: '—' };
      }));
      return json(200, out, { 'Cache-Control': 'public, max-age=60' });
    }
    if (url.pathname === '/api/clans' || url.pathname === '/api/clans.js') return await clansHandler(req, url);
    if (url.pathname === '/api/wars') return await warsHandler(req);
    if (url.pathname === '/api/logout') return json(200, { ok: true }, { 'Set-Cookie': cookieHdr('', 0) });
  } catch (e) { console.error(e); return redirect('/?login=error&why=' + encodeURIComponent(String(e.message).slice(0, 80))); }
  return new Response('Not found', { status: 404 });
};
