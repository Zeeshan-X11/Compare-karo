# Google sign-in setup

Nestly supports server-side Google OpenID Connect using the official `google-auth-library`. Login and signup include Continue with Google. Until both client credentials are configured, the button is disabled and email/password continues to work.

## Operator setup (required before live use)

1. In your own Google Cloud project, configure Google Auth Platform branding, audience and the OAuth consent screen. Use your real app name, support contact, home page and privacy policy. During testing, add the intended test accounts. Follow Google's publishing/verification requirements for your audience before public launch.
2. Create an OAuth client with application type **Web application**. Configure this exact authorized redirect URI for the local preview: `http://127.0.0.1:8080/auth/google/callback`.
3. Set these values privately in `.env` (or `.env.production` on the Docker host): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_ORIGIN`. For the preview, use `APP_ORIGIN=http://127.0.0.1:8080`. Do not paste the secret into chat, source control, frontend JavaScript, or a screenshot.
4. For production, use your real HTTPS origin and register the matching URI ending in `/auth/google/callback`. Open Nestly using that exact origin: `localhost` and `127.0.0.1` are different cookie origins. The callback is configured server-side; request Host headers cannot change it. No JavaScript origin or browser Google SDK is needed for this server redirect flow.
5. Back up MongoDB and run `npm run db:indexes` against the intended database before enabling production traffic. This creates the sparse unique Google identity index and the expiring OAuth-attempt index without deleting records. Index conflicts fail and must be investigated; never delete real users to bypass a conflict.
6. Restart the preview process, or rebuild/restart the documented Linux deployment with `docker compose --env-file .env.production up -d --build app`. Existing email, MongoDB, session and MFA configuration remains required.
7. Test with your own Google account: student signup, owner signup, logout/login, cancellation, existing-account linking, and admin MFA. These provider-backed checks require your credentials; isolated automated tests cannot prove your Google Cloud configuration is correct.

Official setup reference: [Google OAuth for web server applications](https://developers.google.com/identity/protocols/oauth2/web-server) and [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect).

## Account and security behavior

- New Google logins create student accounts. New owners must choose **List and manage my PG** on signup. Existing roles are preserved; public signup cannot grant admin access. Property approval requirements are unchanged.
- An existing password account is never automatically linked merely because the email matches. First sign in with the Nestly password, visit Account security, confirm the password, then connect the Google account with the same verified email.
- Google identities use the stable subject identifier. Changed Google email, suspended Nestly accounts, invalid tokens, expired state, replay and session mismatches are rejected. Administrator MFA still runs after Google sign-in. A Google-only account promoted to admin must first set a Nestly password through the existing verified-email recovery flow before enrolling in MFA; recovery requires the configured email provider.
- OAuth state is session-bound and consumed atomically, expires after ten minutes, and uses PKCE and a nonce. The official library checks token signature, issuer, audience and expiration; Nestly also checks nonce, authorized party and verified email. Access/refresh tokens are not persisted. Temporary verifier/nonce records expire through MongoDB TTL and are deleted on callback.
- Linking and successful sign-ins are audited without logging provider tokens or credentials. Sessions rotate on successful login. Private responses use no-store headers.
- Keep production sessions and OAuth attempts in MongoDB across restarts. Use outbound HTTPS to Google and synchronized server time. Disable request query logging for OAuth callback URLs at any external proxy/observability service.

## Verification boundary

The test suite uses an isolated disposable MongoDB and simulated Google exchange responses. Separate signed-token tests exercise the real Google library's verifier with locally generated RSA keys, without using real Google accounts. A passing suite does not verify live Google consent, your credentials, DNS, or production delivery. Configure credentials and complete step 7 before calling Google sign-in launch-ready.
