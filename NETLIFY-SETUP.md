# Deploying SWAG to a new Netlify project

The source and ZIP do not include private server credentials. A new Netlify project does not inherit the environment variables or stored data of `swagcs3.netlify.app`.

## Steam login

In **Project configuration → Environment variables**, configure:

| Name | Value |
| --- | --- |
| `BASE_URL` | The exact HTTPS address of your project, without a trailing slash, for example `https://your-project.netlify.app`. This public address does not need the secret flag. |
| `SESSION_SECRET` | A private, randomly generated, persistent secret. Preserve the existing value when updating an existing project. |
| `STEAM_API_KEY` | Optional; improves Steam profile lookups. Login can work without it. |

Make the settings available to **Functions** in **Production**. Mark `SESSION_SECRET` and `STEAM_API_KEY` as secrets; `BASE_URL` is public. Never commit real secrets to GitHub, place them in `public/`, or include them in a public ZIP. Netlify's environment import accepts the contents of a private `.env` file; uploading a file as a website asset does not configure environment variables.

Deploy again after setting the variables. Verify the deploy includes the `steam` function. If **Sign in through Steam** returns `SESSION_SECRET env variable is not set`, the deployed function still lacks the setting: check its name, scope, production context, and redeploy.

The project must be public for ordinary visitors to use it without a Netlify account. Review **Project configuration → General → Visitor access** before publishing.

## Discord account linking

Steam login alone needs no Discord credentials. Follow `CONNECT-DISCORD.md` for the additional Discord settings. When changing the site address, use the new address in `BASE_URL`, register its exact `/auth/discord/callback` URL in the Discord Developer Portal, and update the bot's configured website address. Existing stored roles and account data are not automatically transferred to a new Netlify project.

Owner approval is supported. Real payment verification remains disabled until a payment provider is configured.
