import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { staffState, resolveStaff, staffDocument, changeStaff, addRoleMonths } from '../netlify/lib/staff.mjs';
import { createDiscordIntegration, signedHeaders } from '../netlify/lib/discord.mjs';

const seed = JSON.parse(readFileSync(new URL('../netlify/functions/staff.json', import.meta.url)));
const owner = '76561199487127340', swag = '76561199845627878', member = '76561190000000001', other = '76561190000000002';
const now = Date.parse('2026-10-18T16:30:00.000Z'); // Oct 19 in Ulaanbaatar.
const initial = () => staffState(seed, { [other]: 'moderator' }, now);
const grant = (role, extra = {}) => changeStaff(seed, initial(), owner, { id: member, role, ...extra }, 'POST', now);

test('existing paid roles migrate as permanent and do not invent historical start dates', () => {
  const state = staffState(seed, { version: 2, roles: { [member]: 'vip' } }, now);
  assert.deepEqual(state.terms[member], { role: 'vip', sinceAt: null, expiresAt: null, expired: false });
  const saved = staffDocument(seed, state.assigned, state.terms);
  assert.equal(saved.version, 3); assert.equal(resolveStaff(seed, saved, now)[member], 'vip');
  assert.equal(saved.terms[member].sinceAt, null);
});

test('new Admin, VIP and Boss use their package calendar months and record the real grant time', () => {
  for (const [role, expiry] of [['admin', '2026-11-18T16:30:00.000Z'], ['vip', '2027-04-18T16:30:00.000Z'], ['boss', '2027-10-18T16:30:00.000Z']]) {
    const doc = grant(role);
    assert.equal(doc.terms[member].sinceAt, new Date(now).toISOString());
    assert.equal(doc.terms[member].expiresAt, expiry);
    assert.equal(doc.roles[other], 'moderator');
  }
  assert.equal(grant('admin', { duration: 'permanent' }).terms[member].expiresAt, null);
});

test('calendar month durations clamp short months and respect Ulaanbaatar day boundaries', () => {
  assert.equal(addRoleMonths(Date.parse('2027-01-31T10:00:00.000Z'), 1), '2027-02-28T10:00:00.000Z');
  assert.equal(addRoleMonths(Date.parse('2028-01-31T10:00:00.000Z'), 1), '2028-02-29T10:00:00.000Z');
  assert.equal(addRoleMonths(Date.parse('2026-12-31T16:30:00.000Z'), 1), '2027-01-31T16:30:00.000Z');
  assert.equal(grant('vip', { duration: '3' }).terms[member].expiresAt, '2027-01-18T16:30:00.000Z');
  for (let months = 1; months <= 12; months++) assert.ok(grant('vip', { duration: String(months) }).terms[member].expiresAt);
});

test('expiry removes effective website authority exactly at its deadline without deleting renewal history', () => {
  const doc = grant('admin'), boundary = Date.parse(doc.terms[member].expiresAt);
  assert.equal(resolveStaff(seed, doc, boundary - 1)[member], 'admin');
  const expired = staffState(seed, doc, boundary);
  assert.equal(expired.roles[member], undefined); assert.equal(expired.assigned[member], 'admin');
  assert.equal(expired.terms[member].expired, true);
  const otherChange = changeStaff(seed, expired, owner, { id: other, role: 'manager' }, 'POST', boundary);
  assert.equal(otherChange.roles[member], 'admin');
  assert.deepEqual(otherChange.terms[member], doc.terms[member]);
  assert.equal(resolveStaff(seed, otherChange, boundary)[member], undefined);
});

test('renewal preserves Staff since and expired roles can be renewed or made permanent', () => {
  const doc = grant('vip', { duration: 1 }), later = Date.parse('2026-12-01T00:00:00.000Z');
  const state = staffState(seed, doc, later);
  const renewed = changeStaff(seed, state, owner, { id: member, role: 'vip', duration: 6, previousExpiresAt: doc.terms[member].expiresAt }, 'PATCH', later);
  assert.equal(renewed.terms[member].sinceAt, doc.terms[member].sinceAt);
  const editedDate = changeStaff(seed, state, owner, { id: member, role: 'vip', duration: 6, sinceDate: '2026-10-19' }, 'PATCH', later);
  assert.equal(editedDate.terms[member].sinceAt, doc.terms[member].sinceAt);
  assert.equal(resolveStaff(seed, renewed, later)[member], 'vip');
  const permanent = changeStaff(seed, state, swag, { id: member, role: 'vip', duration: 'permanent' }, 'PATCH', later);
  assert.equal(permanent.terms[member].expiresAt, null);
  assert.equal(resolveStaff(seed, permanent, later + 50 * 365 * 864e5)[member], 'vip');
});

test('Owners may choose a custom local deadline and backfill a known start date', () => {
  const legacy = staffState(seed, { [member]: 'boss' }, now);
  const doc = changeStaff(seed, legacy, owner, { id: member, role: 'boss', duration: 'custom', expiresLocal: '2026-10-26T23:59', sinceDate: '2026-09-26' }, 'PATCH', now);
  assert.equal(doc.terms[member].sinceAt, '2026-09-25T16:00:00.000Z');
  assert.equal(doc.terms[member].expiresAt, '2026-10-26T15:59:00.000Z');
});

test('expiry edits cannot bypass the existing Owner/SWAG permission hierarchy', () => {
  const doc = grant('admin'), state = staffState(seed, doc, now);
  for (const role of ['founder', 'manager', 'moderator', 'vip', 'admin', '']) {
    const actorState = { ...state, roles: { ...state.roles, [other]: role } };
    assert.throws(() => changeStaff(seed, actorState, other, { id: member, role: 'admin', duration: 'permanent' }, 'PATCH', now), /owner_only/);
  }
  assert.throws(() => changeStaff(seed, state, owner, { id: swag, role: 'swag', duration: 'permanent' }, 'PATCH', now), /locked_swag/);
  assert.throws(() => changeStaff(seed, state, swag, { id: owner, role: 'owner', duration: 1 }, 'PATCH', now), /not_timed_role/);
  assert.throws(() => changeStaff(seed, state, owner, { id: owner, role: 'owner', duration: 1 }, 'PATCH', now), /self/);
});

test('invalid dates and durations never create a permanent assignment accidentally', () => {
  for (const duration of [0, 13, -1, 1.5, true, false, null, [2], {}, 'invalid']) assert.throws(() => grant('admin', { duration }), /bad_duration/);
  for (const expiresLocal of ['2026-02-30T12:00', 'bad', '2026-10-18T12:00']) assert.throws(() => grant('admin', { duration: 'custom', expiresLocal }), /bad_date|expiry_in_past/);
  assert.throws(() => grant('admin', { sinceDate: '2026-11-01' }), /since_in_future/);
  assert.throws(() => grant('admin', { sinceDate: '2026-02-30' }), /bad_date/);
  const doc = grant('admin'); doc.terms[member].expiresAt = 'garbage';
  assert.throws(() => staffState(seed, doc, now), /roles_unavailable/);
});

test('date edits reject a role or expiry that changed while its dialog was open', () => {
  const state = staffState(seed, grant('vip'), now);
  assert.throws(() => changeStaff(seed, state, owner, { id: member, role: 'admin', duration: 1 }, 'PATCH', now), /role_changed/);
  assert.throws(() => changeStaff(seed, state, owner, { id: member, role: 'vip', duration: 1, previousExpiresAt: null }, 'PATCH', now), /time_changed/);
});

test('the real signed bot role feed excludes expired grants and retains permanent ones', async () => {
  const doc = grant('admin'), boundary = Date.parse(doc.terms[member].expiresAt);
  doc.roles[other] = 'boss'; doc.terms[other] = { role: 'boss', sinceAt: null, expiresAt: null };
  const env = { BASE_URL: 'https://role-test.example', SESSION_SECRET: 'a'.repeat(64), WEBSITE_BRIDGE_SECRET: 'b'.repeat(64) };
  const run = createDiscordIntegration({ env, readSession: () => null, loadRoles: async () => resolveStaff(seed, doc, boundary) });
  const headers = signedHeaders(env.WEBSITE_BRIDGE_SECRET, 'GET', '/api/discord/roles');
  const result = await run(new Request(env.BASE_URL + '/api/discord/roles', { headers }));
  assert.equal(result.status, 200);
  const roles = (await result.json()).roles;
  assert.equal(roles[member], undefined); assert.equal(roles[other], 'boss'); assert.equal(roles[swag], 'swag');
});
