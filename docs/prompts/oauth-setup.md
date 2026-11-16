# Prompt: set up GitHub and Google sign-in for the hosted site

Paste everything below the line into a Claude session that can drive a browser on your own computer (Claude in Chrome, or the desktop app's built-in browser). Fill in the two placeholders first. Nothing in this file is secret; the secrets are typed or copied only inside the browser.

---

You are helping the owner of the open-source project SandBag turn on **GitHub and Google sign-in** for its hosted deployment. The app and its code are already deployed and healthy; sign-in fails with `{"error_code":"validation_failed","msg":"Unsupported provider: provider is not enabled"}` because neither provider is enabled in the hosted Supabase project, and the OAuth apps don't exist yet.

## Check first
Providers may already be enabled in Supabase even if an earlier error said otherwise: open each provider panel before creating anything, and only create what is missing. Known pitfalls from the first run: Google's consent screen must be **External** (Internal gives `403 org_internal`), the Google client's redirect URI must be the Supabase callback (else `redirect_uri_mismatch`), and the Supabase **Site URL** must be the bare origin, not the `/auth/callback**` pattern.

## Values
- Site URL (Vercel deployment): `<SITE_URL>` (for example `https://something.vercel.app`, no trailing slash)
- Supabase project ref: `<PROJECT_REF>` (the part before `.supabase.co` in the project URL)
- Supabase callback URL (derived): `https://<PROJECT_REF>.supabase.co/auth/v1/callback`

## Rules
1. **Never put a secret in the chat, a file, a URL or a log.** Client secrets are copied from the provider page and pasted straight into the Supabase field in the browser, and never echoed back. If a step needs a secret you cannot copy in the browser, tell me where to find it and wait.
2. I log in myself. If a page asks for a password, 2FA or a CAPTCHA, stop and tell me.
3. Change only what is listed here. Do not touch billing, other projects, other OAuth apps, database settings, or any provider other than GitHub and Google.
4. Before each final "Save", "Create" or "Publish" click, say in one line what you are about to change.
5. If a screen differs from these steps, describe what you see and ask rather than guessing.

## Steps
**A. GitHub**
1. Supabase dashboard, project `<PROJECT_REF>`, Authentication, Sign In / Providers, GitHub. Note the callback URL it displays and check it matches the derived one above.
2. github.com, Settings, Developer settings, OAuth Apps, New OAuth App. Application name `SandBag`. Homepage URL `<SITE_URL>`. Authorization callback URL: the Supabase callback URL. Register it.
3. Copy the Client ID. Generate a new client secret and copy it immediately (GitHub shows it once).
4. Back in Supabase: enable GitHub, paste the Client ID and the secret, Save.

**B. Google**
1. Google Cloud Console: create or choose a project named `SandBag`. APIs & Services, OAuth consent screen: User type External, app name `SandBag`, support and developer email set to mine, default scopes only (`openid`, `email`, `profile`). Leave it in **Testing** and add my Google account (and any testers I name) under Test users.
2. APIs & Services, Credentials, Create credentials, OAuth client ID, Web application, name `SandBag web`. Under Authorized redirect URIs add exactly the Supabase callback URL. Leave Authorized JavaScript origins empty. Create.
3. Copy the Client ID and Client secret.
4. Back in Supabase: Authentication, Providers, Google: enable, paste both, Save.

**C. Redirects (Supabase, Authentication, URL Configuration)**
1. Site URL: `<SITE_URL>`.
2. Redirect URLs: add `<SITE_URL>/auth/callback**` (the trailing `**` is required). Keep any existing entries.

## Verify
1. Open `<SITE_URL>/sign-in` and use "Continue with GitHub". Expect: GitHub consent, then a return to `<SITE_URL>/account?welcome=1` on a first sign-in. Then sign out and repeat with Google.
2. If something fails, read Supabase, Logs, Auth Logs for that minute and report the exact error line. Common causes: `redirect_uri mismatch` (callback typed wrong), `?error=callback` (redirect URL missing or `**` missing), landing on localhost (Site URL still default).

## Report back (no secrets)
Which provider worked, which did not, the exact error text for any failure, and anything you changed beyond the list above. Leave Google in Testing mode and tell me that publishing it is a separate decision.
