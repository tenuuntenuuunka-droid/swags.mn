# Website role hierarchy

`SWAG > Owner > Co-Owner > Founder > Manager > Moderator > Boss > VIP > Admin`

SWAG includes Owner's website controls and can manage Owner assignments. Owners retain their existing staff and clan controls, but cannot grant, edit or remove SWAG. The deployment's root SWAG account and self-demotions/removals are protected. The staff console shows only assignments the signed-in account can make; the server independently enforces every change.

The root SWAG account is Steam ID `76561199845627878`. Steam ID `76561199487127340` remains Owner. Steam ID `76561198744192723` is removed from the seed Owners and from legacy stored Owner assignments during migration. This revocation does not prevent ordinary Steam login.

Existing staff data is read without resetting clans, account links or lower roles. New staff writes use a versioned record; explicit removals of seeded Owners persist across reloads. Stored data cannot override the root SWAG account.

These are website roles. A website SWAG assignment does not grant Discord server ownership or any Discord role automatically. Existing explicit Admin/VIP/Boss mappings continue to work.
