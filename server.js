// swag.mn — бодит Steam нэвтрэлт (Steam OpenID 2.0). Гадны сан шаардахгүй, Node 18+.
// Ажиллуулах: npm start  →  http://localhost:3000
// Production: BASE_URL=https://swag.mn STEAM_API_KEY=xxxx SESSION_SECRET=урт-санамсаргүй npm start
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const BASE = (process.env.BASE_URL || 'http://localhost:' + PORT).replace(/\/$/, '');
const KEY = process.env.STEAM_API_KEY || '';           // заавал биш; байвал Web API ашиглана
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SECURE = BASE.startsWith('https');
const OPENID = 'https://steamcommunity.com/openid/login';
const NS = 'http://specs.openid.net/auth/2.0';

const sign = v => crypto.createHmac('sha256', SECRET).update(v).digest('base64url');
function makeCookie(obj) { const b = Buffer.from(JSON.stringify(obj)).toString('base64url'); return b + '.' + sign(b); }
function readCookie(req) {
  const m = /(?:^|;\s*)swag=([^;]+)/.exec(req.headers.cookie || ''); if (!m) return null;
  const [b, s] = m[1].split('.'); if (!b || !s) return null;
  const ok = Buffer.from(sign(b)), got = Buffer.from(s);
  if (ok.length !== got.length || !crypto.timingSafeEqual(ok, got)) return null;
  try { const o = JSON.parse(Buffer.from(b, 'base64url').toString()); return o.exp > Date.now() ? o : null; } catch { return null; }
}
const setCookie = (res, v, maxAge) => res.setHeader('Set-Cookie',
  `swag=${v}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}` + (SECURE ? '; Secure' : ''));

// Steam-ээр баталгаажуулалт: callback-ийг Steam руу буцааж "is_valid:true" авна (хуурамч ID-аас хамгаална)
async function verify(q) {
  if (q['openid.ns'] !== NS || q['openid.mode'] !== 'id_res') return null;
  if (!q['openid.return_to'] || !q['openid.return_to'].startsWith(BASE + '/auth/steam/return')) return null;
  const p = new URLSearchParams(); for (const k in q) p.set(k, q[k]); p.set('openid.mode', 'check_authentication');
  const r = await fetch(OPENID, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: p });
  if (!/is_valid\s*:\s*true/.test(await r.text())) return null;
  const m = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/.exec(q['openid.claimed_id'] || '');
  return m ? m[1] : null;
}

// Профайл: нэр + зураг + холбоос
async function profile(id) {
  if (KEY) {
    const r = await fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${KEY}&steamids=${id}`);
    const p = (await r.json()).response.players[0];
    if (p) return { id, name: p.personaname, avatar: p.avatarfull, profileUrl: p.profileurl };
  } else {
    const x = await (await fetch(`https://steamcommunity.com/profiles/${id}?xml=1`)).text();   // түлхүүргүй, нийтийн профайл
    const g = t => { const m = new RegExp(`<${t}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${t}>`).exec(x); return m && m[1].trim(); };
    if (g('steamID')) return { id, name: g('steamID'), avatar: g('avatarFull'), profileUrl: `https://steamcommunity.com/profiles/${id}` };
  }
  return { id, name: 'Steam ' + id.slice(-6), avatar: '', profileUrl: `https://steamcommunity.com/profiles/${id}` };
}

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const json = (res, code, o) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o)); };

http.createServer(async (req, res) => {
  const u = new URL(req.url, BASE);
  try {
    if (u.pathname === '/auth/steam') {
      const p = new URLSearchParams({ 'openid.ns': NS, 'openid.mode': 'checkid_setup',
        'openid.return_to': BASE + '/auth/steam/return', 'openid.realm': BASE,
        'openid.identity': NS + '/identifier_select', 'openid.claimed_id': NS + '/identifier_select' });
      res.writeHead(302, { Location: OPENID + '?' + p }); return res.end();
    }
    if (u.pathname === '/auth/steam/return') {
      const id = await verify(Object.fromEntries(u.searchParams));
      if (!id) { res.writeHead(302, { Location: '/?login=error' }); return res.end(); }
      const pr = await profile(id);
      setCookie(res, makeCookie({ ...pr, exp: Date.now() + 30 * 864e5 }), 30 * 86400);
      res.writeHead(302, { Location: '/?login=ok' }); return res.end();
    }
    if (u.pathname === '/api/me') { const s = readCookie(req); if (!s) return json(res, 401, { error: 'not_logged_in' });
      const { id, name, avatar, profileUrl } = s; return json(res, 200, { id, name, avatar, profileUrl }); }
    if (u.pathname === '/api/logout' && req.method === 'POST') { setCookie(res, '', 0); return json(res, 200, { ok: true }); }
    if (u.pathname === '/api/leaderboard' || u.pathname === '/api/team') return json(res, 404, {});

    const f = path.join(__dirname, 'public', u.pathname === '/' ? 'index.html' : path.normalize(u.pathname));
    if (!f.startsWith(path.join(__dirname, 'public')) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  } catch (e) { console.error(e); res.writeHead(302, { Location: '/?login=error' }); res.end(); }
}).listen(PORT, () => console.log('SWAG server: ' + BASE));
