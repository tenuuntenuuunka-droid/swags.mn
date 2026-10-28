# SWAGCS website update

This package updates the existing website design and retains Steam sign-in, Discord account linking, linked identities in clans and profiles, website-to-Discord role synchronization, role timers, and SWAG-only administrative disconnect controls.

Deploy to the existing Netlify project to retain its environment settings and Netlify Blobs records. Upload this complete ZIP through that project's Deploys page. Do not create a replacement project or reset the data stores.

Keep the existing Discord callback and bot bridge configuration. Private secrets belong in hosting environment variables, never in the ZIP or browser HTML. Run `npm test` for the integration checks.

The uploaded additional Owner seed is excluded; the existing seed and stored Owner/SWAG assignments are preserved. Existing account links, clans, role timers and role mappings remain in their current stores.

Owner-approved roles and timers work with the existing bot. Online payment verification remains manual. Read CONNECT-DISCORD.md, ROLE-TIMERS.md and WEBSITE-ROLES.md for the controls.

[Download the complete updated website ZIP](swag-discord-final.zip).
