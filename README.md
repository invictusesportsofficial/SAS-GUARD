# How to protect your existing site with SAS

You have your own website. SAS acts as the bouncer.
You add **one file** and **one line per page** — that's the entire integration.

---

## Step 1 — Tell SAS about your domain

In your **Vercel project** (the SAS deployment):

1. Go to → **Settings → Environment Variables**
2. Add or edit:

   | Name | Value |
   |------|-------|
   | `ALLOWED_ORIGINS` | `yoursite.com,www.yoursite.com` |

   Use comma-separated hostnames — no `https://`, no trailing slash.

3. Click **Save** → Vercel redeploys automatically (~60 seconds)

---

## Step 2 — Add `sas-guard.js` to your project

Copy `sas-guard.js` into your project's **public/static folder** — wherever you serve JS files from.

Examples:
- Plain HTML site → project root (same folder as your HTML files)
- Express/Node → `public/sas-guard.js`
- Laravel/PHP → `public/sas-guard.js`
- Django → `static/sas-guard.js`
- WordPress → `wp-content/themes/yourtheme/sas-guard.js`

Open `sas-guard.js` and change **one line**:
```js
var SAS_URL = 'https://YOUR-SAS-APP.vercel.app'; // ← your real SAS URL
```

---

## Step 3 — Add one line to every page you want protected

Add this as the **very first `<script>` tag inside `<head>`** — before any other scripts:

```html
<head>
  <script src="/sas-guard.js"></script>   ← add this line
  <title>My Page</title>
  ...
</head>
```

**That's it.** Any page with this tag is now protected by SAS.
Any page without it stays public.

---

## Step 4 — Optional: add a "blocked" page to your site

When SAS denies access (system disabled, bad token), it redirects to `/blocked.html` on your site.

Create a simple `blocked.html` — or change `BLOCKED_PATH` in `sas-guard.js` to wherever you want:
```js
var BLOCKED_PATH = '/error.html';   // your existing error page
```

Or set it to `null` to show an inline fallback message instead.

---

## How the flow works (for reference)

```
User visits yoursite.com/dashboard.html
        ↓
sas-guard.js runs, hides the page
        ↓
  Token in sessionStorage? ──yes──→ POST /api/verify → granted → show page ✓
        ↓ no
  Redirect to SAS gateway
  (sas.vercel.app/api/gateway?return=yoursite.com/dashboard.html)
        ↓
  SAS checks: is access enabled? (from admin dashboard)
        ↓ yes
  SAS issues JWT → redirects back:
  yoursite.com/dashboard.html?sas_token=eyJ...
        ↓
  sas-guard.js picks up sas_token, saves to sessionStorage
        ↓
  POST /api/verify → granted → show page ✓
```

On every **subsequent page** your visitor opens (in the same tab),
the token from sessionStorage is reused — no redirect needed.

---

## Controlling access from SAS dashboard

Visit `https://your-sas-app.vercel.app/admin`

- **Enable access** → your site is open, SAS issues tokens
- **Disable access** → SAS stops issuing tokens, all visitors are blocked instantly
- **View logs** → see every access attempt: IP (masked), status, timestamp

No changes to your site needed. Toggle once → affects every visitor immediately.

---

## Troubleshooting

### Still seeing redirect loops?
- Make sure `ALLOWED_ORIGINS` in Vercel includes your exact hostname (e.g. `yoursite.com`, not `https://yoursite.com`)
- Open browser DevTools → Network tab — look at the `/api/verify` response
- Check `sessionStorage` in DevTools → Application → Session Storage — is `sas_token` being set?

### "Access denied" immediately after getting a token?
- Token expired in transit (very unlikely with 5 min TTL)
- Check Vercel Function logs: SAS project → Deployments → Functions → `api/verify`

### sas-guard.js blocks pages even when not logged in?
- Check that `SAS_URL` in `sas-guard.js` is correct (no trailing slash)
- Check that access is **Enabled** in the SAS admin dashboard

### My site uses `?token=` for something else
- `sas-guard.js` uses `?sas_token=` (not `?token=`) to avoid collisions ✓

### CORS error in browser console?
- Make sure your SAS deployment has the `ALLOWED_ORIGINS` env var set
- Redeploy SAS after adding it (Vercel → Deployments → Redeploy)
