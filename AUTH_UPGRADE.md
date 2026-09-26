# Authentication & Account System Upgrade

This upgrade adds real, production-grade authentication and account
management on top of the existing backend/database from the previous pass.
No existing UI or features were removed — this only adds new capability.

## 1. Files created

**Backend**
- `server/src/utils/tokens.js` — random token generation + SHA-256 hashing (reset/verify tokens are never stored raw)
- `server/src/services/sessionService.js` — access/refresh token issuance, rotation, revocation, activity history
- `server/src/services/emailService.js` — dev-mode email stub (logs + returns the link; documented as the real-provider integration point)

**Frontend**
- `web/src/ForgotPassword.jsx`, `ResetPassword.jsx`, `VerifyEmail.jsx` — new auth pages
- `web/src/AccountSettings.jsx` — profile editing, verification status, security (change password, active sessions), social platform management

## 2. Files modified

- `server/src/db/schema.sql` / `server/prisma/schema.prisma` — 3 new tables (see below)
- `server/src/routes/auth.js` — full rewrite: register/login now issue access+refresh token pairs; added refresh, logout, logout-all, forgot-password, reset-password, change-password, verify-email/request, verify-email/confirm, sessions
- `server/src/routes/users.js` — added `GET /users/me/account` (combined identity + profile + real campaign history + real wallet totals)
- `server/src/routes/admin.js` — added user search (`?q=`, `?role=`, `?status=`), `GET /admin/users/:id/profile` (full detail), `GET /admin/users/:id/activity` (real login history)
- `server/src/app.js` — added a stricter rate limit specifically on `/auth/forgot-password`
- `server/.env` — `JWT_EXPIRES_IN` shortened to `15m` (access token); added `APP_URL`
- `web/src/api.js` — rewritten token layer: access+refresh tokens, automatic silent refresh-and-retry on a 401
- `web/src/App.jsx` — reads `?token=` from `/reset-password` and `/verify-email` links; routes to the new pages
- `web/src/AuthPage.jsx` — "Forgot password?" link, 8-character minimum, shows the dev verification link after signup
- `web/src/Dashboard.jsx` — added "Account settings" entry (available to every role) alongside the existing role dashboards

## 3. Database changes

Three new tables, all with proper PKs, FKs (`ON DELETE CASCADE`), and indexes:

- **`password_reset_tokens`** `(id, user_id, token_hash UNIQUE, expires_at, used_at, created_at)`
- **`email_verification_tokens`** `(id, user_id, token_hash UNIQUE, expires_at, used_at, created_at)`
- **`user_sessions`** `(id, user_id, refresh_token_hash UNIQUE, user_agent, ip_address, expires_at, created_at, last_used_at, revoked_at)` — backs revocable refresh tokens *and* doubles as the real login/activity history shown to users and admins.

Tokens are **never stored raw** — only a SHA-256 hash, exactly like passwords are never stored raw (bcrypt, cost factor 12).

## 4. Authentication configuration required

- `JWT_SECRET` — must be a long random string in production (currently a dev placeholder in `.env`)
- Access tokens expire in **15 minutes**; refresh tokens in **30 days** and are stored hashed, so any single one can be individually revoked (`/auth/logout`) or all of a user's sessions at once (`/auth/logout-all`, and automatically on password reset)
- No real email provider is connected — see `emailService.js`. In development, verification/reset links are logged to the server console **and** returned directly in the API response (`devVerifyLink` / `devResetLink`), gated by `NODE_ENV !== "production"`. **This must be removed before production** — see §8.

## 5. Environment variables

Added to `server/.env`:
```
JWT_EXPIRES_IN="15m"      # was 7d — access tokens are now short-lived by design
APP_URL="http://localhost:5173"   # used to build verification/reset links
```
(`JWT_SECRET`, `DATABASE_URL`, `CORS_ORIGIN`, `PORT`, `NODE_ENV` unchanged from the previous pass.)

## 6. API endpoints created

```
POST /auth/register              {name,email,password,role,referralCode?}
POST /auth/login                 {email,password}
POST /auth/refresh               {refreshToken} → new token pair (rotates)
POST /auth/logout                {refreshToken} → revokes one session
POST /auth/logout-all            (auth) → revokes every session for the user
GET  /auth/sessions              (auth) → real login/activity history
POST /auth/verify-email/request  (auth) → issues a new verification token
POST /auth/verify-email/confirm  {token}
POST /auth/forgot-password       {email} → always generic response (no enumeration)
POST /auth/reset-password        {token,newPassword} → revokes all sessions on success
POST /auth/change-password       (auth) {currentPassword,newPassword}

GET  /users/me/account           (auth) → identity + profile + real campaign history + real wallet totals

GET  /admin/users?q=&role=&status=        (admin) → search/filter
GET  /admin/users/:id/profile             (admin) → full account detail
GET  /admin/users/:id/activity            (admin) → real login history
```

## 7. How to test registration/login

```bash
cd server
npm install
node src/db/seed.js
npm run dev
```

```bash
# Register — copy the devVerifyLink from the response
curl -X POST http://localhost:4000/api/auth/register -H "Content-Type: application/json" \
  -d '{"name":"Test User","email":"test@example.com","password":"password123","role":"CREATOR"}'

# Confirm the email (grab the token= value from devVerifyLink)
curl -X POST http://localhost:4000/api/auth/verify-email/confirm -H "Content-Type: application/json" \
  -d '{"token":"<paste token here>"}'

# Log in
curl -X POST http://localhost:4000/api/auth/login -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'
```

Or just use the UI at `http://localhost:5173` — register, and the app shows the dev verification link directly on screen (no email server needed to test the full flow).

Every case below was verified with curl during this build (see conversation transcript for full output):
- Wrong password / unknown email return the identical generic error (no account enumeration)
- Forgot-password always returns the same response whether or not the email exists
- Resetting a password immediately invalidates every existing session
- A used or expired reset/verify token is rejected
- Refresh tokens rotate on every use; the old one stops working immediately
- A creator token cannot reach any `/admin/*` route
- An advertiser cannot fund, view, or list applications on another advertiser's campaign
- Injecting `"role":"ADMIN"` into a profile-update request body is silently ignored — role never changes

## 8. Remaining configuration before production

1. **Connect a real email provider** (Postmark/SES/SendGrid) in `emailService.js`, and remove the `devVerifyLink`/`devResetLink` fields from the API responses in `auth.js` (currently gated by `NODE_ENV`, but double-check before deploying).
2. **Move refresh tokens to httpOnly cookies** instead of `localStorage` for stronger XSS protection — the current localStorage approach is a common, reasonable SPA pattern but cookies are stronger if your frontend and API can share a domain/subdomain in production.
3. **Set a strong, unique `JWT_SECRET`** via a real secrets manager, not `.env`.
4. **Enable HTTPS everywhere** and set `Secure`/`SameSite` cookie flags if you adopt the cookie approach above.
5. **Add CAPTCHA or similar** on register/login/forgot-password if abuse becomes a concern beyond the current rate limits.
6. **OAuth platform verification** for social accounts is still not connected (unchanged from the previous pass) — `social_accounts.verified_at` stays `NULL` until that's built.
