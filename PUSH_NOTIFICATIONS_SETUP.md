# Forever push notifications

The Forever frontend and Supabase database are prepared for Web Push notifications.

## What is already implemented

- Bell button in the Forever sidebar.
- Browser notification permission request from a user action.
- Web Push subscription using a VAPID public key.
- Subscription storage in `public.push_subscriptions` with RLS.
- Service-worker `push` and `notificationclick` handlers.
- Supabase Edge Function `send-push` for message delivery.
- Expired push subscriptions are automatically removed by the Edge Function.
- Sender is excluded from the notification recipient list.

## One-time Supabase configuration still required

The private VAPID key must stay server-side and cannot be committed to GitHub or placed in `notification.js`.

### 1. Generate your VAPID key pair

Use a machine where Node.js is installed:

```bash
npx web-push generate-vapid-keys
```

Keep both values safe. The public key goes into `notification.js`; the private key must only be a Supabase secret.

If you replace the public key, update `FOREVER_VAPID_PUBLIC_KEY` in `notification.js` and commit it.

### 2. Set Supabase Edge Function secrets

In Supabase Dashboard → Edge Functions → Secrets, add:

- `VAPID_PUBLIC_KEY` = your VAPID public key
- `VAPID_PRIVATE_KEY` = your VAPID private key
- `VAPID_SUBJECT` = e.g. `mailto:your-email@example.com`

Do not put the private key in GitHub, frontend JavaScript, SQL, or chat.

### 3. Create a database webhook

In Supabase Dashboard → Database → Webhooks, create an `INSERT` webhook for:

- Table: `public.messages`
- Event: `INSERT`
- Target: Edge Function `send-push`
- Method: `POST`
- Content type: JSON

The webhook must send an `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` header so the Edge Function can authenticate the database event. Keep the service-role key server-side.

The webhook body should contain the inserted row as `record`, as provided by Supabase database webhooks.

### 4. Test on desktop

1. Log in to Forever.
2. Click the bell icon.
3. Allow notifications.
4. Log into the second Forever account in another browser/device.
5. Send a message to the first account.
6. The first account should receive a system notification.

### 5. Test on iPhone

Install Forever to the Home Screen first. Open Forever from the Home Screen, then tap the bell icon and allow notifications. iOS requires the notification permission request to come from a user action in the installed Home Screen web app.

## Security

The browser only receives the VAPID public key. The VAPID private key and Supabase service-role key must remain in Supabase server-side configuration.
