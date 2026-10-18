import { bridge } from './discord.mjs';

export function publicDiscord(value) {
  const id = String(value?.discord_id || '');
  if (!/^\d{17,20}$/.test(id) || typeof value?.username !== 'string') return null;
  return { id, username: value.username.slice(0, 80) };
}

// One authenticated round trip per group, rather than one request per roster member.
export async function linkedProfiles(ids, { callBridge = bridge } = {}) {
  const requested = [...new Set(ids.map(String).filter(id => /^\d{17}$/.test(id)))];
  const profiles = Object.create(null);
  if (!requested.length) return { profiles, available: true };
  try {
    for (let index = 0; index < requested.length; index += 50) {
      const chunk = requested.slice(index, index + 50);
      const result = await callBridge('/v1/website/profiles', { steam_ids: chunk });
      if (!result?.profiles || typeof result.profiles !== 'object' || Array.isArray(result.profiles)) throw new Error('invalid_profiles');
      for (const id of chunk) {
        const profile = publicDiscord(result?.profiles?.[id]);
        if (profile) profiles[id] = profile;
      }
    }
    return { profiles, available: true };
  } catch {
    return { profiles: Object.create(null), available: false };
  }
}

export function discordFields(result, id) {
  const discord = result.profiles[String(id)] || null;
  return { discord, discord_status: discord ? 'linked' : result.available ? 'unlinked' : 'unavailable' };
}
