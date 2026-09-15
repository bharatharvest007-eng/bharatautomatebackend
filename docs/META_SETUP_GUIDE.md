# Meta Instagram Graph API Setup Guide

This platform connects directly to **live Instagram Professional (Creator or Business) accounts** using official Meta Graph API endpoints (v21.0).

---

## 1. Prerequisites
- An **Instagram Professional Account** (Creator or Business). Personal Instagram accounts do not support Graph APIs.
- A **Facebook Page** linked to your Instagram Professional Account.
- A **Meta Developer Account** at [developers.facebook.com](https://developers.facebook.com).

---

## 2. Creating Your Meta Developer App
1. Go to [developers.facebook.com/apps](https://developers.facebook.com/apps) and click **Create App**.
2. Select **Business** as the app type.
3. Name your app (e.g. `AutoDM Production Engine`).
4. Add the following products to your app:
   - **Instagram Graph API**
   - **Messenger** (Instagram Messaging)

---

## 3. Configuring Webhooks

Meta requires an **HTTPS** URL to receive live Instagram webhooks.

### Local Development Tunnel
To test with live Instagram accounts on your machine, launch the included webhook tunnel:
```powershell
npm run tunnel
```
Or use Cloudflare Tunnel:
```powershell
cloudflared tunnel --url http://localhost:3001
```

### In Meta App Dashboard:
1. Navigate to **Instagram** &rarr; **Webhooks**.
2. Set **Callback URL**:
   ```
   https://<your-tunnel-url>/webhooks/instagram
   ```
3. Set **Verify Token**:
   ```
   dev-meta-webhook-verify-token-change-me
   ```
   *(Must match `WEBHOOK_SECRET` in your `.env` file)*.
4. Click **Verify and Save**.
5. Subscribe to the following webhook fields:
   - `messages` (inbound direct messages & quick replies)
   - `comments` (post and reel comments)
   - `messaging_postbacks` (interactive button clicks)
   - `messaging_seen` (read receipts)
   - `mention` (when someone @mentions your profile in comments or captions)

---

## 4. App Permissions & OAuth Scopes

In your Meta App &rarr; **App Review** / **Permissions and Features**, request:
- `instagram_basic`
- `instagram_manage_messages` (sending/receiving DMs, persistent menu, ice breakers)
- `instagram_manage_comments` (comment reading, public auto-reply, auto-hide spam)
- `pages_manage_metadata`
- `pages_read_engagement`
- `pages_show_list`

---

## 5. Connecting Your Live Account

1. Set your Meta credentials in `.env`:
   ```env
   META_APP_ID=your_meta_app_id
   META_APP_SECRET=your_meta_app_secret
   META_REDIRECT_URI=http://localhost:3001/oauth/instagram/callback
   ```
2. Start the dev server:
   ```powershell
   npm run dev
   ```
3. Visit the dashboard at `http://localhost:3000/accounts` and click **Connect Instagram Account**.
4. Log in with your Facebook/Instagram credentials and authorize the permissions.
5. AutoDM exchanges the short-lived authorization code for a **60-day Long-Lived User Access Token** and automatically handles background token refreshes via cron.

---

## 6. Meta Messaging Policy Compliance

AutoDM implements 100% compliance with Meta Graph API rules:
1. **24-Hour Messaging Window**: Freeform standard messages can be sent within 24 hours of the user's latest inbound message.
2. **`HUMAN_AGENT` Tag (7-Day Extension)**: Handover messages sent by human agents use the approved `HUMAN_AGENT` message tag, extending the window to 7 days for customer inquiries.
3. **Private Replies to Comments**:
   - Meta limits private replies to **exactly 1 message per comment**.
   - Private replies can only be sent within **7 days** of the comment creation timestamp.
   - Handled automatically by the **Rewind** engine and comment workers.
4. **Rate Limiting**:
   - AutoDM enforces strict token-bucket pacing (under 100 calls/sec for text messages, 750 private replies/hour) to guarantee your account is never suspended.
