import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Rank helpers live in index.html's big closure; every logged-in player now has a rank (Silver I at 0 EXP).
const rankStubs = { tierOf: () => ({ c: '#9aa3ad' }), describe: () => ({ name: 'Silver I', pct: 0, next: '', nx: null }), rankImgs: () => '', pfK: () => '', pfRing: () => '' };

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const helpers = html.split('/* Role timing helpers */')[1].split('/* /Role timing helpers */')[0];
const profile = html.slice(html.indexOf('  function renderProfilePage()'), html.indexOf('  function openProfile()'));
const discordHelpers = html.split('/* Discord identity helpers */')[1].split('/* /Discord identity helpers */')[0];
const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const term = { role: 'vip', sinceAt: '2026-09-25T16:00:00.000Z', expiresAt: '2026-10-25T16:00:00.000Z', expired: false };

test('timing display matches the supplied labels, local dates, countdown and permanent state', () => {
  const context = vm.createContext({ esc, window: {} }); vm.runInContext(helpers, context);
  const rendered = context.roleTiming(term, Date.parse('2026-10-18T16:00:00.000Z'));
  assert.match(rendered, /STAFF SINCE/); assert.match(rendered, /2026-09-26/);
  assert.match(rendered, /EXPIRES/); assert.match(rendered, /7d left · 2026-10-26/);
  assert.match(context.roleTiming({ ...term, expiresAt: null }), /Permanent/);
  assert.match(context.roleTiming({ ...term, expired: true }), /Expired/);
  assert.match(context.roleTiming({ ...term, sinceAt: null, expiresAt: null }), /<strong>—<\/strong>/);
  const options = context.roleDurationOptions('permanent', true);
  assert.match(options, /value="1"/); assert.match(options, /value="12"/);
  assert.match(options, /value="permanent" selected/); assert.match(options, /value="custom"/);
});

test('public profiles show role dates but only Owner and SWAG see the time editor', () => {
  const root = { style: { setProperty() {} }, innerHTML: '' };
  const target = { id: '76561190000000001', name: 'VIP member', staff: 'vip', roleTerm: term, discord: null };
  const context = vm.createContext({ ...rankStubs, esc, window: {}, $: () => root, pfView: target, steamUser: { id: '76561199487127340', staff: 'owner' }, pfCustom: {} });
  vm.runInContext(helpers + discordHelpers + profile + '\nrenderProfilePage();', context);
  assert.match(root.innerHTML, /STAFF SINCE/); assert.match(root.innerHTML, /data-pf="role-time"/);
  context.steamUser.staff = 'swag'; vm.runInContext('renderProfilePage();', context);
  assert.match(root.innerHTML, /data-pf="role-time"/);
  context.steamUser.staff = 'founder'; vm.runInContext('renderProfilePage();', context);
  assert.doesNotMatch(root.innerHTML, /data-pf="role-time"/);
});

function editor() {
  const elements = {}, handlers = {}, calls = [], events = [];
  const element = id => elements[id] ||= {
    value: '', textContent: '', disabled: false, open: false, hidden: false, className: '',
    set innerHTML(value) { this.html = value; if (id === 'rtDuration') this.value = /<option value="([^"]+)" selected/.exec(value)?.[1] || '1'; },
    get innerHTML() { return this.html || ''; }, showModal() { this.open = true; }, close() { this.open = false; },
    addEventListener(type, handler) { handlers[id + ':' + type] = handler; }
  };
  const context = vm.createContext({ window: {}, document: { getElementById: element, addEventListener() {}, dispatchEvent(event) { events.push(event); } },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    esc, initOwner() {}, load() {}, render() {},
    fetch: async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ ok: true }) }; }
  });
  const start = html.indexOf('  var ROLES = ['), end = html.indexOf('  function parseId(', start);
  vm.runInContext(helpers + html.slice(start, end), context);
  context.isOwner = true; context.meU = { id: '76561199487127340', staff: 'owner', csrf: 'test-csrf' };
  return { context, element, handlers, calls, events };
}

test('Owner editor loads existing dates and saves an authorized permanent change for exactly that member', async () => {
  const { context, element, handlers, calls, events } = editor();
  context.window.swagEditRoleTime({ id: '76561190000000001', name: 'VIP member', role: 'vip', roleTerm: term });
  assert.equal(element('roleTimeDlg').open, true);
  assert.equal(element('rtDuration').value, 'custom');
  assert.equal(element('rtSince').value, '2026-09-26');
  assert.equal(element('rtExpiry').value, '2026-10-26T00:00');
  element('rtDuration').value = 'permanent'; handlers['rtDuration:change']();
  assert.equal(element('rtExpiry').disabled, true); assert.equal(element('rtExpiry').value, '');
  handlers['rtSave:click'](); await new Promise(setImmediate);
  assert.equal(calls.length, 1); assert.equal(calls[0].url, '/api/staff');
  assert.equal(calls[0].options.method, 'PATCH'); assert.equal(calls[0].options.headers['X-Swag-Csrf'], 'test-csrf');
  assert.deepEqual(JSON.parse(calls[0].options.body), { id: '76561190000000001', role: 'vip', duration: 'permanent', sinceDate: '2026-09-26', previousExpiresAt: term.expiresAt });
  assert.equal(element('roleTimeDlg').open, false); assert.equal(events[0].type, 'swag-role-time');
});

test('a lower role cannot open the editor and a failed save keeps it open', async () => {
  const { context, element, handlers, calls } = editor();
  const member = { id: '76561190000000001', name: 'VIP member', role: 'vip', roleTerm: term };
  context.isOwner = false; context.window.swagEditRoleTime(member);
  assert.equal(element('roleTimeDlg').open, false); assert.equal(calls.length, 0);
  context.isOwner = true; context.window.swagEditRoleTime(member);
  context.fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: 'expiry_in_past' }) });
  handlers['rtSave:click'](); await new Promise(setImmediate);
  assert.equal(element('roleTimeDlg').open, true); assert.match(element('rtMessage').textContent, /ирээдүйд/);
});
