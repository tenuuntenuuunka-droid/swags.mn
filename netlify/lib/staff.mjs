// Website authority only. Discord permissions require separate explicit mappings.
export const STAFF_ROLES = ['swag', 'owner', 'coowner', 'founder', 'manager', 'moderator', 'boss', 'vip', 'admin'];
export const isWebsiteAdmin = role => role === 'swag' || role === 'owner';
const validId = id => /^\d{17}$/.test(id);
const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
const retiredOwner = '76561198744192723';

export function resolveStaff(seed, document) {
  const versioned = record(document) && document.version === 2;
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
  return roles;
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

export function staffDocument(seed, roles) {
  const saved = { ...roles };
  for (const id of Object.keys(seed)) if (!(id in roles)) saved[id] = null;
  return { version: 2, roles: saved };
}
