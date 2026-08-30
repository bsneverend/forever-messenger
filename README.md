# Forever

Private two-person web messenger built with Supabase.

## Files
- `index.html` — Login and Messenger UI
- `style.css` — Responsive desktop/mobile styling
- `app.js` — Supabase Auth, messages and realtime

## Supabase
The app uses the Supabase Project URL and Publishable Key configured in `app.js`.

Never place a database password, secret key, or service-role key in this repository.


## PWA
Forever is configured as an installable Progressive Web App (PWA).

Additional files:
- `manifest.json` — app identity and installation metadata
- `service-worker.js` — app shell caching
- `assets/icon-192.png` — standard app icon
- `assets/icon-512.png` — high-resolution app icon
- `assets/apple-touch-icon.png` — iPhone/iPad Home Screen icon
