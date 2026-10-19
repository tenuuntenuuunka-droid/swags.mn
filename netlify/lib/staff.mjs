// Website authority only. Discord permissions require separate explicit mappings.
export const STAFF_ROLES = ['swag', 'owner', 'coowner', 'founder', 'manager', 'moderator', 'boss', 'vip', 'admin'];
export const isWebsiteAdmin = role => role === 'swag' || role === 'owner';
export const TIMED_ROLES = ['admin', 'vip', 'boss'];
export const DEFAULT_MONTHS = { admin: 1, vip: 6, boss: 12 };
const validId = id => /^\d{17}$/.test(id);
const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
const retiredOwner = '76561198744192723';

export function staffState(seed, document, now = Date.now()) {
  const versioned = record(document) && [2, 3].includes(document.version);
  const saved = versioned ? document.roles : document;
  if (versioned && !record(saved)) throw new Error('roles_unavailable');
  if (saved !== null && (!record(saved) || Object.entries(saved).some(([id, role]) =>
    !validId(id) || (role !== null && !STAFF_ROLES.includes(role))))) throw new Error('roles_unavailable');
  const roles = { ...seed };
  for (const [id, role] of Object.entries(saved || {})) {
    if (role === null) delete roles[id];
    else roles[id] = role;
  }
  // Apply the requested revocation once when reading pre-SWAG staff data.
  if (!versioned && roles[retiredOwner] === 'owner') delete roles[retiredOwner];
  // The deployment's root SWAG account cannot be displaced by stored roles.
  for (const [id, role] of Object.entries(seed)) if (role === 'swag') roles[id] = role;
  const assigned = { ...roles }, terms = {};
  const storedTerms = document?.version === 3 ? document.terms : {};
  if (!record(storedTerms)) throw new Error('roles_unavailable');
  const stamp = value => value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);
  for (const [id, term] of Object.entries(storedTerms)) {
    if (!validId(id) || !record(term) || !TIMED_ROLES.includes(assigned[id]) || term.role !== assigned[id] ||
        !stamp(term.sinceAt) || !stamp(term.expiresAt) || (term.sinceAt && term.expiresAt && term.expiresAt <= term.sinceAt)) throw new Error('roles_unavailable');
  }
  for (const [id, role] of Object.entries(assigned)) {
    if (!TIMED_ROLES.includes(role)) continue;
    if (document?.version === 3 && !storedTerms[id]) throw new Error('roles_unavailable');
    const term = storedTerms[id] || { role, sinceAt: null, expiresAt: null };
    const expired = !!term.expiresAt && Date.parse(term.expiresAt) <= now;
    terms[id] = { role, sinceAt: term.sinceAt, expiresAt: term.expiresAt, expired };
    if (expired) delete roles[id];
  }
  return { roles, assigned, terms };
}
export const resolveStaff = (seed, document, now = Date.now()) => staffState(seed, document, now).roles;

// Calendar months use the website's Ulaanbaatar calendar, including short months.
const UB_OFFSET = 8 * 60 * 60 * 1000;
export function addRoleMonths(now, months) {
  const local = new Date(now + UB_OFFSET), day = local.getUTCDate();
  local.setUTCDate(1); local.setUTCMonth(local.getUTCMonth() + months);
  const last = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 0)).getUTCDate();
  local.setUTCDate(Math.min(day, last));
  return new Date(local.getTime() - UB_OFFSET).toISOString();
}
function localStamp(value, dateOnly = false) {
  const pattern = dateOnly ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
  if (typeof value !== 'string' || !pattern.test(value)) throw new Error('bad_date');
  const time = Date.parse(value + (dateOnly ? 'T00:00' : '') + ':00+08:00');
  if (!Number.isFinite(time) || new Date(time + UB_OFFSET).toISOString().slice(0, dateOnly ? 10 : 16) !== value) throw new Error('bad_date');
  return new Date(time).toISOString();
}
export function roleTermChange(previous, role, body, now = Date.now(), isNew = false) {
  let sinceAt = !isNew && previous ? previous.sinceAt : new Date(now).toISOString();
  if (body.sinceDate !== undefined && typeof body.sinceDate !== 'string') throw new Error('bad_date');
  if (body.sinceDate) {
    const chosen = localStamp(body.sinceDate, true);
    if (Date.parse(chosen) > now) throw new Error('since_in_future');
    // An unchanged date field must not erase the original grant's time of day.
    if (!sinceAt || new Date(Date.parse(sinceAt) + UB_OFFSET).toISOString().slice(0, 10) !== body.sinceDate) sinceAt = chosen;
  }
  let expiresAt;
  const duration = body.duration;
  if (duration === undefined && !isNew && previous) expiresAt = previous.expiresAt;
  else if (duration === 'permanent') expiresAt = null;
  else if (duration === 'custom') expiresAt = localStamp(body.expiresLocal);
  else {
    if (duration !== undefined && !['string', 'number'].includes(typeof duration)) throw new Error('bad_duration');
    const months = duration === undefined ? DEFAULT_MONTHS[role] : Number(duration);
    if (!Number.isInteger(months) || months < 1 || months > 12 || typeof duration === 'boolean') throw new Error('bad_duration');
    expiresAt = addRoleMonths(now, months);
  }
  if (expiresAt && Date.parse(expiresAt) <= now) throw new Error('expiry_in_past');
  if (sinceAt && expiresAt && expiresAt <= sinceAt) throw new Error('bad_date');
  return { role, sinceAt, expiresAt };
}

export function staffAccess(seed, roles, actor) {
  const swag = roles[actor] === 'swag';
  const canOwner = swag || (seed[actor] === 'owner' && roles[actor] === 'owner');
  return {
    canManage: isWebsiteAdmin(roles[actor]),
    assignableRoles: isWebsiteAdmin(roles[actor]) ? STAFF_ROLES.filter(role =>
      (role !== 'swag' || swag) && (role !== 'owner' || canOwner)) : [],
    lockedUsers: Object.keys(seed).filter(id => seed[id] === 'swag' || (!swag && seed[id] === 'owner')),
  };
}

export function staffChangeError(seed, roles, actor, id, role, method) {
  const access = staffAccess(seed, roles, actor);
  if (!access.canManage) return 'owner_only';
  if (!['POST', 'DELETE'].includes(method)) return 'method';
  if (!validId(id)) return 'bad_id';
  if (id === actor) return 'self';
  if (seed[id] === 'swag') return 'locked_swag';
  if (roles[actor] !== 'swag' && (roles[id] === 'swag' || role === 'swag')) return 'swag_only';
  if (access.lockedUsers.includes(id)) return 'locked_owner';
  if ((roles[id] === 'owner' || role === 'owner') && !access.assignableRoles.includes('owner')) return 'super_owner_only';
  if (method === 'POST' && !access.assignableRoles.includes(role)) return 'bad_role';
  return '';
}

export function staffDocument(seed, roles, terms = {}) {
  const saved = { ...roles };
  for (const id of Object.keys(seed)) if (!(id in roles)) saved[id] = null;
  const savedTerms = {};
  for (const [id, role] of Object.entries(roles)) if (TIMED_ROLES.includes(role)) {
    const previous = terms[id];
    savedTerms[id] = { role, sinceAt: previous?.role === role ? previous.sinceAt : null, expiresAt: previous?.role === role ? previous.expiresAt : null };
  }
  return { version: 3, roles: saved, terms: savedTerms };
}

// This is the shared mutation path used by the real staff endpoint and its tests.
export function changeStaff(seed, state, actor, body, method, now = Date.now()) {
  if (!record(body)) throw new Error('bad_id');
  const id = String(body.id || '').trim();
  const role = method === 'PATCH' ? state.assigned[id] : String(body.role || '').toLowerCase();
  const error = staffChangeError(seed, state.roles, actor, id, role, method === 'PATCH' ? 'POST' : method);
  if (error) throw new Error(error);
  if (method === 'PATCH' && !TIMED_ROLES.includes(role)) throw new Error('not_timed_role');
  if (method === 'PATCH' && body.role !== role) throw new Error('role_changed');
  if (method === 'PATCH' && 'previousExpiresAt' in body && body.previousExpiresAt !== state.terms[id]?.expiresAt) throw new Error('time_changed');
  const next = { ...state.assigned }, terms = { ...state.terms };
  if (method === 'DELETE') { delete next[id]; delete terms[id]; }
  else {
    if (TIMED_ROLES.includes(role)) terms[id] = roleTermChange(terms[id], role, body, now, state.assigned[id] !== role);
    else if (body.duration !== undefined) throw new Error('not_timed_role');
    else delete terms[id];
    next[id] = role;
  }
  return staffDocument(seed, next, terms);
}
