# Connect SWAG's website and Discord bot

Use the Netlify project where this website is deployed. A purchased domain is unnecessary. The prepared bot bridge address is **https://swag-bot-production-a20f.up.railway.app**; private settings are supplied separately. Steam stays the website login; a member then connects their Discord account using the **top-right Discord icon**, **Profile → Discord**, or the profile menu. The complete ZIP includes the account-link interface styles and scripts in `public/index.html`.

The website owner assigns Admin, VIP, Boss or another approved role through the existing **Role Console**. The bot reads that approved list and grants the mapped Discord role to the linked member. Linking and owner-approved role sync are implemented. **QPay remains a demo**; there is no automatic payment confirmation or automatic expiry. Until a verified payment integration is configured, the owner must verify payments and assign/remove website roles manually. These changes do not grant Counter-Strike game-server permissions.

## Netlify setup

1. Extract this archive and open the directory containing `netlify.toml`, `package.json`, `public/`, and `netlify/`. Updating an existing project retains its `staff`, profiles, skins, clans, and wars Blobs stores. A new project has separate variables and storage; see `NETLIFY-SETUP.md` before deploying.
2. In Netlify's environment settings for **production Functions**, preserve the current `SESSION_SECRET`, `STEAM_API_KEY`, and all other existing settings. Set:

   | Name | Value |
   |---|---|
   | `BASE_URL` | This project's exact HTTPS address, without a path or trailing slash |
   | `DISCORD_CLIENT_ID` | `1559602636217651220` |
   | `DISCORD_CLIENT_SECRET` | The application's existing OAuth2 client secret, supplied privately by its owner |
   | `DISCORD_BRIDGE_URL` | The existing bot bridge HTTPS address above |
   | `WEBSITE_BRIDGE_SECRET` | Supplied privately; must match the existing Railway value |

   `DISCORD_CLIENT_SECRET` is **not** the bot token. The bot token stays on Railway. Mark `DISCORD_CLIENT_SECRET`, `WEBSITE_BRIDGE_SECRET`, and `SESSION_SECRET` as secrets. The site address, client ID, and bridge address are public configuration and do not need the secret flag. Keep private values in Netlify's server environment and out of the source repository, `public/`, browser code, and chat messages. Do not upload private settings files as website assets.

3. Deploy the complete project, **including its functions**, through Netlify's Git-connected build, the complete project ZIP upload, or the official CLI. Verify that the completed production build includes the `steam` function; uploading only `index.html` is insufficient. With Node.js and npm installed, the CLI alternative is:

   ```powershell
   npm install
   npm test
   npx netlify-cli login
   npx netlify-cli link
   npx netlify-cli deploy --build --prod
   ```

   In `link`, select the intended existing Netlify project. Review the deployment target before publishing. The `netlify.toml` already selects `public/` and `netlify/functions/`. Wait for the production build to finish after changing environment settings. Preserve the Steam session secret so existing sign-ins remain valid.

4. Confirm `/api/me` still recognizes a signed-in Steam user. In Profile → Discord, the Connect Discord button should become available. Signing in with Steam from scratch now uses a short-lived state cookie, so old in-progress Steam login tabs should be restarted.

## For the Discord application/server owner

1. Open [the existing application's OAuth2 settings](https://discord.com/developers/applications/1559602636217651220/oauth2). Add this project's exact HTTPS address followed by `/auth/discord/callback` and save. For example, replace `your-project` with the real project name:

   ```text
   https://your-project.netlify.app/auth/discord/callback
   ```

   Keep the bot private and retain its existing installation settings. Account linking requests only `identify`; it does not request a member's email, messages, or automatic server joining. Use the OAuth2 client secret for Netlify; there is no need to reset the bot token. On Railway, set `WEBSITE_BASE_URL` to the same website address as Netlify's `BASE_URL`, preserving `WEBSITE_BRIDGE_SECRET`, and redeploy the bot when changing the address.

2. In the original Discord server **1558730863208964137**, configure the matching existing Discord roles:

   ```text
   /website map website_role:admin role:@Admin
   /website map website_role:vip role:@VIP
   /website map website_role:boss role:@Boss
   ```

   Choose the actual role from Discord's selector; names above are examples. Additional website roles supported for explicit mapping are `moderator`, `manager`, `founder`, `coowner`, and `owner`. No Discord role is mapped automatically by name. Ordinary managers can map only roles below their own highest role. Only the Discord server owner may map administrator/server-management roles or Owner/Co-Owner/Founder website roles. The bot needs Manage Roles and a higher role position than every target role.

3. Run `/website status` to review mappings. `/website unmap` stops granting a mapping and removes only grants created by this integration after a successful refresh. `/website sync` queues a refresh. Prefix examples: `?website`, `?website map vip @VIP`, `?website sync`.

## Acceptance check

1. A consenting member signs in through Steam and connects their own Discord account. Confirm Discord displays the SWAG application and the `identify` scope before authorizing it. The member must join the original server themselves if not already present.
2. An authorized website owner assigns that member a test website role. Within roughly **15–60 seconds** while both services are running, the corresponding mapped Discord role should appear. Use the account dialog's **Role шинэчлэх** button to request an earlier refresh.
3. Change/remove the website role and verify that the integration's previous role is removed. Unrelated roles must remain. A mapped role that existed before integration sync is preserved as manually assigned; it is not adopted for automatic removal.
4. Unlink Discord and confirm that integration-added roles are removed before the link is deleted. If the bot cannot remove a role, unlinking reports a failure and retains the link for retry.

Account links and the integration's role-grant records live in the existing Railway SQLite volume. One Discord account can link to one Steam profile per server, enforced by database uniqueness. OAuth state is encrypted, time-limited and bound to the signed-in Steam account; browser writes require CSRF checks. The bot and site authenticate requests/responses with a separate shared secret. Failed storage reads, invalid signatures and network failures preserve existing grants instead of treating an unavailable role list as empty. No actual member roles were changed during automated tests.

If a member sees `unmapped_role`, configure `/website map`. `role_not_manageable` means the bot role position/permissions need fixing. `not_in_server` means the member needs to join SWAG Discord. Connection unavailable means check the Netlify function environment, deployment status, Railway service, and private shared secret; never paste secrets into logs or support chats.

References: [Discord OAuth2](https://docs.discord.com/developers/topics/oauth2), [role assignment API](https://docs.discord.com/developers/resources/guild#add-guild-member-role), [Netlify CLI deployments](https://docs.netlify.com/cli/get-started/#deploy-your-site), [Netlify Functions](https://docs.netlify.com/build/functions/overview/).
