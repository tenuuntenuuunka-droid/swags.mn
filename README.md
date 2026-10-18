# SWAG CS2 website

SWAG website source with Steam sign-in and Discord account linking.

The **top-right Discord icon** opens **Connect Discord**. Its interface, styles and browser scripts are included in `public/index.html`. Once the server settings are configured, members can link their Discord account to their signed-in Steam profile and receive explicitly mapped, owner-approved Discord roles from the existing SWAG bot.

## Deploy the source

`netlify.toml` publishes `public/` and builds the functions in `netlify/functions/`. For a new Netlify project, follow **[NETLIFY-SETUP.md](NETLIFY-SETUP.md)**: configure its public `BASE_URL` and a private `SESSION_SECRET` available to production Functions, then redeploy. A new project does not inherit another site's variables or stored data. When updating an existing project, retain its Netlify Blobs stores and Steam session secret. The ZIP files are downloadable copies of the source.

Follow **[CONNECT-DISCORD.md](CONNECT-DISCORD.md)** for the exact Discord callback URL, server environment settings and `/website map` commands. `.env.example` contains names and blank placeholders only. Configure real credentials in the hosting service, never in `index.html` or Git.

## Preview and checks

Open `public/index.html` to preview the website. Real account linking and role updates use the hosted server functions and bot bridge. The legacy `server.js` provides basic local Steam support; use Netlify's development workflow for the complete function-based site.

```sh
npm install
npm test
```

## Included

- Steam sign-in with a short-lived login state check.
- Discord identity verification using OAuth authorization code flow, PKCE and Steam-bound encrypted state.
- Account linking and a role-refresh control; browser writes require CSRF checks. Website unlinking is disabled in the interface and on the server, including for Owner and SWAG accounts.
- Linked Discord identities in profiles, clan status and rosters, staff cards, account menus and leaderboards.
- [SWAG above Owner](WEBSITE-ROLES.md), with server-enforced authority and protected SWAG assignments.
- An authenticated role snapshot for the Railway bot; the bot token stays on Railway.
- Owner-approved Admin/VIP/Boss and explicit additional role mappings.

Online payment verification and automatic subscription expiry are not enabled. Owners must verify payments and manage website roles manually until a verified QPay integration is configured. This does not grant Counter-Strike server permissions.

**[Download the final website ZIP](swag-discord-final.zip)**, or read **[START-HERE.txt](START-HERE.txt)**.
