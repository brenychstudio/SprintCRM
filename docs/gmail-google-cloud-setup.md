# Gmail OAuth production setup checklist

Use this only during `CRM-GMAIL-00A-ACCEPT`. Do not paste credentials into chat, issues, PRs, logs, or documentation, and never commit them.

## Google Cloud

- Select the intended controlled Google Cloud project.
- Enable the Gmail API.
- Configure the OAuth consent screen and application identity.
- Configure test users while the consent screen remains in testing mode, where applicable.
- Create an OAuth client of type **Web application**.
- Add the exact deployed `gmail-oauth-callback` URL as an authorized redirect URI. Do not use wildcards.
- Confirm the requested consent scopes are only `openid`, `email`, `profile`, and `https://www.googleapis.com/auth/gmail.send`.
- Do not add Gmail readonly, metadata, modify, compose, settings, or full-mail scopes.

## Supabase Edge Function secrets/configuration

Set these outside source control:

```text
GMAIL_CONNECTION_ENABLED
GOOGLE_OAUTH_CLIENT_ID
GOOGLE_OAUTH_CLIENT_SECRET
GOOGLE_OAUTH_REDIRECT_URI
APP_BASE_URL
```

The redirect URI must exactly match Google Cloud configuration. `APP_BASE_URL` must be the trusted SprintCRM origin used for the fixed `/settings` return. Keep the server switch false until migration review, function deployment, and secret verification are complete. Keep `VITE_GMAIL_CONNECTION_ENABLED=false` until the server boundary is ready. Keep controlled-send flags disabled.

## Acceptance smoke

- Apply only the reviewed additive migration and deploy the three OAuth functions with their intended JWT settings.
- Enable the server and client connection flags.
- Authenticate to SprintCRM and click Connect Gmail once.
- Verify Google shows only the approved scopes.
- Return to `/settings` and perform an authoritative mailbox-account reread.
- Confirm no message, Gmail draft, inbox read, external message, send request, or Bridge operation was created.
- Disconnect and verify the observed revocation outcome plus disconnected account state.
- Reconnect once and verify the same Google `sub` account is updated and the Vault secret is rotated.
- Re-disable flags immediately if any state, identity, scope, redirect, token-custody, or audit invariant fails.

## Accepted production configuration

CRM-GMAIL-00A connection acceptance passed on 2026-08-13 with this non-secret configuration:

- Google Auth Platform audience: **External / Testing**;
- OAuth client: **Web application**;
- redirect: the exact deployed Supabase Edge `gmail-oauth-callback` URL, with no wildcard;
- requested identity scopes: `openid`, `email`, and `profile`;
- requested Gmail capability: `https://www.googleapis.com/auth/gmail.send`;
- Gmail readonly, metadata, modify, compose, settings, and full-mail scopes: absent;
- real supervised connect, disconnect, and same-identity reconnect: verified;
- refresh credential custody: Supabase Vault reference verified without plaintext read;
- send execution, provider drafts, inbox/reply sync, and automation: disabled/not implemented.

External / Testing authorization is suitable for this supervised acceptance but is not a claim of permanent verified public OAuth availability. Secrets, test-user identity details, provider subjects, and token values do not belong in this document.
