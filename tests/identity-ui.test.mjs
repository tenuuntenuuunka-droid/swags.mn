import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const helpers = html.split('/* Discord identity helpers */')[1].split('/* /Discord identity helpers */')[0];
const profile = html.slice(html.indexOf('  function renderProfilePage()'), html.indexOf('  function openProfile()'));
const steam = html.slice(html.indexOf('  function renderSteam()'), html.indexOf('  var CMDS ='));
const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const account = { id: '123456789012345678', username: 'V12' };

test('own and public profiles display linked Discord instead of a generic connect prompt', () => {
  const root = { style: { setProperty() {} }, innerHTML: '' };
  const person = { id: '76561199487127340', name: 'Steam test', staff: 'owner', discord: account };
  const context = vm.createContext({ esc, window: {}, $: () => root, pfView: null, steamUser: person, pfCustom: {} });
  vm.runInContext(helpers + profile + '\nrenderProfilePage();', context);
  assert.match(root.innerHTML, /Discord · V12/);
  assert.match(root.innerHTML, /https:\/\/discord.com\/users\/123456789012345678/);
  assert.match(root.innerHTML, /★ Owner/);
  assert.match(root.innerHTML, /Холболт удирдах/);
  context.pfView = { ...person, _from: 'clan' };
  vm.runInContext('renderProfilePage();', context);
  assert.match(root.innerHTML, /Discord · V12/);
  assert.match(root.innerHTML, /← Клан/);
  assert.doesNotMatch(root.innerHTML, /data-discord-open/);
});

test('Discord badges escape names and reject executable profile links', () => {
  const context = vm.createContext({ esc, window: {} });
  vm.runInContext(helpers, context);
  assert.equal(context.discordBadge({ id: 'javascript:alert(1)', username: 'bad' }), '');
  const rendered = context.discordBadge({ ...account, username: '<img src=x onerror="bad">' });
  assert.match(rendered, /&lt;img/);
  assert.doesNotMatch(rendered, /<img/);
});

test('clan member rows keep the Steam profile ID and show the linked Discord name', () => {
  const code = html.slice(html.indexOf('  function openClan(tag)'), html.indexOf('  var curClan = null;'));
  const elements = {};
  const $ = id => elements[id] ||= { innerHTML: '', textContent: '', hidden: false, setAttribute() {} };
  const dialog = { open: false, showModal() { this.open = true; } };
  const member = ['Steam test', 'Ахлагч', 0, 0, '', '76561199487127340', account];
  const clan = { tag: 'SWG', name: 'SWAG', motto: '', members: [member], color: '#9d00ff', rank: 1, elo: 0, wins: 0, losses: 0, founded: 2026 };
  const context = vm.createContext({ $, esc, window: {}, clans: [clan], clanDlg: dialog, curClan: null,
    emblem: () => '', fmt: String, winPct: () => 0, tile: () => '', formDots: () => '',
    avatarHtml: () => '', applyBanners() {}, isClanOwner: () => true, renderManage() {} });
  vm.runInContext(helpers + code + "\nopenClan('SWG');", context);
  assert.match($('cdBody').innerHTML, /Discord · V12/);
  assert.match($('cdBody').innerHTML, /data-clan-player="76561199487127340"/);
  assert.equal(dialog.open, true);
});

test('clan prerequisites and account menu follow live linked, unlinked and unavailable states', () => {
  const elements = {};
  function $(id) {
    if (!elements[id]) {
      const children = {};
      elements[id] = { hidden: false, textContent: '', innerHTML: '', className: '', style: {}, querySelector(name) { return children[name] ||= { textContent: '' }; } };
    }
    return elements[id];
  }
  const context = vm.createContext({ $, esc, steamUser: { id: '76561199487127340', name: 'Steam test', staff: 'owner', discord: account, discord_status: 'linked' },
    setAv() {}, closePop() {}, renderRankMe() {}, renderProfilePage() {} });
  vm.runInContext(steam + '\nrenderSteam();', context);
  assert.equal($('ccDiscord').className, 'ok');
  assert.equal($('ccDiscord').querySelector('small').textContent, 'V12');
  assert.equal($('ccWarn').hidden, true);
  assert.equal($('popDiscord').textContent, 'Discord · V12');
  assert.equal($('popRole').textContent, 'Website · OWNER');
  context.steamUser.discord = null; context.steamUser.discord_status = 'unlinked';
  vm.runInContext('renderSteam();', context);
  assert.equal($('ccDiscord').className, ''); assert.equal($('ccWarn').hidden, false);
  assert.equal($('popDiscord').textContent, '');
  context.steamUser.discord_status = 'unavailable';
  vm.runInContext('renderSteam();', context);
  assert.match($('ccDiscord').querySelector('small').textContent, /Түр боломжгүй/);
  assert.match($('ccWarnText').textContent, /шалгаж чадсангүй/);
});
