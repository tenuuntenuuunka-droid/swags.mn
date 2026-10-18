import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STAFF_ROLES, isWebsiteAdmin, resolveStaff, staffAccess, staffChangeError, staffDocument } from '../netlify/lib/staff.mjs';

const seed = JSON.parse(readFileSync(new URL('../netlify/functions/staff.json', import.meta.url)));
const swag = '76561199845627878', owner = '76561199487127340', retired = '76561198744192723';
const delegated = '76561190000000001', member = '76561190000000002';
const roles = () => resolveStaff(seed, { [delegated]: 'owner', [member]: 'vip', [retired]: 'owner' });

test('SWAG is first in the hierarchy and the requested accounts are seeded correctly', () => {
  assert.deepEqual(STAFF_ROLES.slice(0, 2), ['swag', 'owner']);
  assert.equal(seed[swag], 'swag'); assert.equal(seed[owner], 'owner');
  assert.equal(seed[retired], undefined);
  assert.equal(isWebsiteAdmin('swag'), true); assert.equal(isWebsiteAdmin('owner'), true);
  assert.equal(isWebsiteAdmin('manager'), false);
});

test('legacy migration revokes the former Owner and preserves other staff and the current Owner', () => {
  const resolved = roles();
  assert.equal(resolved[retired], undefined); assert.equal(resolved[owner], 'owner');
  assert.equal(resolved[delegated], 'owner'); assert.equal(resolved[member], 'vip');
  assert.equal(resolved[swag], 'swag');
  assert.equal(resolveStaff(seed, null)[retired], undefined);
  assert.equal(resolveStaff(seed, { [swag]: 'admin' })[swag], 'swag');
});

test('SWAG can manage Owners while an Owner cannot grant, demote or remove SWAG', () => {
  const current = roles();
  assert.equal(staffChangeError(seed, current, swag, owner, 'vip', 'POST'), '');
  assert.equal(staffChangeError(seed, current, swag, owner, '', 'DELETE'), '');
  assert.equal(staffChangeError(seed, current, swag, member, 'owner', 'POST'), '');
  assert.equal(staffChangeError(seed, current, owner, member, 'swag', 'POST'), 'swag_only');
  for (const actor of [owner, delegated]) {
    assert.equal(staffChangeError(seed, current, actor, swag, '', 'DELETE'), 'locked_swag');
    assert.equal(staffChangeError(seed, current, actor, swag, 'vip', 'POST'), 'locked_swag');
    const peer = { ...current, [member]: 'swag' };
    assert.equal(staffChangeError(seed, peer, actor, member, '', 'DELETE'), 'swag_only');
    assert.equal(staffChangeError(seed, peer, actor, member, 'admin', 'POST'), 'swag_only');
  }
});

test('Owner keeps previous staff powers and delegated Owners retain their restrictions', () => {
  const current = roles();
  assert.equal(staffChangeError(seed, current, owner, member, 'admin', 'POST'), '');
  assert.equal(staffChangeError(seed, current, owner, member, '', 'DELETE'), '');
  assert.equal(staffChangeError(seed, current, owner, member, 'owner', 'POST'), '');
  assert.equal(staffChangeError(seed, current, owner, delegated, 'manager', 'POST'), '');
  assert.equal(staffChangeError(seed, current, delegated, member, 'owner', 'POST'), 'super_owner_only');
  assert.equal(staffChangeError(seed, current, delegated, owner, '', 'DELETE'), 'locked_owner');
  assert.equal(staffChangeError(seed, current, delegated, member, 'admin', 'POST'), '');
  assert.equal(staffChangeError(seed, current, member, owner, 'admin', 'POST'), 'owner_only');
  for (const actor of [swag, owner, delegated]) {
    assert.equal(staffChangeError(seed, current, actor, actor, '', 'DELETE'), 'self');
    assert.equal(staffChangeError(seed, current, actor, actor, 'admin', 'POST'), 'self');
  }
});

test('server access metadata hides SWAG assignments from Owners and protects root SWAG', () => {
  const current = roles(), rootAccess = staffAccess(seed, current, swag), ownerAccess = staffAccess(seed, current, owner);
  assert.deepEqual(rootAccess.assignableRoles, STAFF_ROLES);
  assert.equal(rootAccess.lockedUsers.includes(owner), false);
  assert.equal(ownerAccess.assignableRoles.includes('owner'), true);
  assert.equal(ownerAccess.assignableRoles.includes('swag'), false);
  assert.equal(ownerAccess.lockedUsers.includes(swag), true);
  assert.equal(staffAccess(seed, current, delegated).assignableRoles.includes('owner'), false);
  assert.deepEqual(staffAccess(seed, current, member).assignableRoles, []);
});

test('persisted Owner removals and demotions survive reload without deleting other staff', () => {
  const current = roles(); delete current[owner];
  const saved = staffDocument(seed, current);
  assert.equal(saved.roles[owner], null);
  let reloaded = resolveStaff(seed, saved);
  assert.equal(reloaded[owner], undefined); assert.equal(reloaded[member], 'vip');
  current[owner] = 'admin'; reloaded = resolveStaff(seed, staffDocument(seed, current));
  assert.equal(reloaded[owner], 'admin'); assert.equal(reloaded[swag], 'swag');
  assert.equal(resolveStaff(seed, { version: 2, roles: { [swag]: null } })[swag], 'swag');
});

test('invalid stored role data fails closed and new mutations validate IDs and roles', () => {
  for (const document of [[], false, { version: 2, roles: null }, { version: 2 }, { bad: 'owner' }, { [member]: 'root' }]) {
    assert.throws(() => resolveStaff(seed, document), /roles_unavailable/);
  }
  assert.equal(staffChangeError(seed, roles(), owner, 'not-a-steamid', 'vip', 'POST'), 'bad_id');
  assert.equal(staffChangeError(seed, roles(), owner, member, 'root', 'POST'), 'bad_role');
  assert.equal(staffChangeError(seed, roles(), owner, member, '', 'PATCH'), 'method');
});
