# Farm Box Social Media Automate — Production Setup & Architecture Guide

This guide details how **Farm Box** connects Meta Graph API (Instagram & Facebook) and WhatsApp Business Cloud API with `socialmedi_automate` to automate customer acquisition, daily harvest announcements, comment-to-cart conversions, and bilingual customer support.

---

## 1. Architecture Overview

```
                      +---------------------------------------+
                      |          Farm Box Customers          |
                      |   Instagram Reel / FB Post / WhatsApp |
                      +-------------------+-------------------+
                                          |
                Comments / DMs / Webhook  |  Meta Graph API v21.0
                                          v
+---------------------------------------------------------------------------------+
|                       socialmedi_automate Backend                               |
|                                                                                 |
|  [Security & Auth Layer]                                                        |
|   • Raw UTF-8 Buffer HMAC SHA256 Webhook Verification (`X-Hub-Signature-256`)   |
|   • AES-256-GCM Token Encryption at Rest (`enc:v1:...`)                         |
|   • Multi-Tenant Organization Scoping (`orgId`)                                 |
|                                                                                 |
|  [Flow & Conversion Engine]                                                     |
|   • Comment-to-DM triggers (FRESH, BOX, కూరగాయలు, ఆర్డర్, RECIPE)              |
|   • Interactive WhatsApp Buttons & Delivery Slot Selectors                      |
|   • Automatic Lead Capture (Phone, Email, Address, Slot Preferences)            |
|                                                                                 |
|  [Farm Box Commerce Bridge]                                                     |
|   • Telugu produce catalog (300+ items from FarmboxBackendOct8th)               |
|   • Weekly Box (₹399), Fruit Basket (₹499), Greens Detox (₹249)                 |
|   • "Cook the Harvest" recipe ingredient baskets & 1-click cart links          |
|                                                                                 |
|  [Background Workers]                                                           |
|   • 60-Day Meta Token Auto-Refresh Sweep (`tokens.refresh`, runs every 12h)     |
|   • Durable WhatsApp Broadcast Queue (`campaigns.send_broadcast`)               |
|   • Automated Post & Reel Scheduler (`posts.publish_due`, runs every 1m)        |
+---------------------------------------------------------------------------------+
```

---

## 2. Meta App & Instagram Graph API Configuration

### Step 2.1: Create Meta Developer App
1. Go to [Meta for Developers](https://developers.facebook.com/).
2. Click **My Apps** > **Create App** > Select **Business** type.
3. App Name: `Farm Box Automation`.

### Step 2.2: Add Required Products & Permissions
Under **App Dashboard**, add:
- **Instagram Graph API**:
  - `instagram_basic`
  - `instagram_manage_comments`
  - `instagram_manage_messages`
  - `instagram_content_publish`
  - `pages_read_engagement`
  - `pages_manage_posts`
  - `pages_manage_metadata`
- **Facebook Login for Business** (or System User token generation).

### Step 2.3: Configure Webhooks
1. Under **Instagram** / **Webhooks**, set:
   - **Callback URL**: `https://<YOUR_DOMAIN>/api/meta/webhook`
   - **Verify Token**: Same value as `META_VERIFY_TOKEN` in `.env`.
2. Subscribe to fields:
   - `comments`
   - `messages`
   - `messaging_postbacks`
   - `messaging_optins`
3. Under **Page** Webhooks, subscribe to:
   - `feed`
   - `messages`

---

## 3. WhatsApp Business Cloud API Configuration

### Step 3.1: Meta Business Manager Setup
1. In Meta Business Manager, go to **System Users** > Create a system user `FarmBoxBot`.
2. Assign assets:
   - WhatsApp Business Account (WABA).
3. Generate System User Access Token with:
   - `whatsapp_business_messaging`
   - `whatsapp_business_management`

### Step 3.2: Connecting to Farm Box
1. Open Farm Box Dashboard at `/accounts`.
2. Click **Connect WhatsApp Number**.
3. Input:
   - **Phone Number ID**: From Meta WhatsApp Getting Started dashboard.
   - **WABA ID**: WhatsApp Business Account ID.
   - **System User Access Token**: Generated above.
4. The system validates the number, encrypts the token at rest using AES-256-GCM, and enables the WhatsApp Cloud API integration.

---

## 4. Environment Variables (`.env`)

```ini
PORT=4000
NODE_ENV=production
APP_BASE_URL=https://automate.farmbox.in

# MongoDB
MONGO_URI=mongodb://localhost:27017/farmbox_automate

# Security & Encryption (AES-256-GCM)
TOKEN_ENCRYPTION_KEY=64_character_hex_key_here
COOKIE_SECURE=true
COOKIE_SAMESITE=lax

# Meta App Credentials
META_APP_ID=your_meta_app_id
META_APP_SECRET=your_meta_app_secret
META_VERIFY_TOKEN=your_secure_random_verify_token

# Anthropic Claude API (Bilingual Grocery Concierge)
ANTHROPIC_API_KEY=sk-ant-api03-...

# Farm Box Backend URL
FARMBOX_BACKEND_URL=http://localhost:5001
FARMBOX_FRONTEND_URL=https://farmbox.in
```

---

## 5. Turnkey Farm Box Starter Automations

### 1. Fresh Harvest Box Alert (Comment-to-DM)
- **Trigger**: Comment on any Instagram Reel or Post with `FRESH`, `BOX`, `కూరగాయలు`, or `ఆర్డర్`.
- **Public Reply**: Randomized Telugu/English fresh farm greeting.
- **Private DM**: Weekly Fresh Vegetable Box (₹399) details and 1-click cart link.
- **Follow-up**: Asks preferred delivery slot (Morning 6-9 AM or Evening 5-8 PM) and automatically stores customer contact as a Lead in the CRM!

### 2. WhatsApp Instant Order Bot
- **Trigger**: Inbound WhatsApp text `ORDER`, `MENU`, `START`, `HI`, or `నమస్తే`.
- **Interactive Menu**:
  1. Weekly Vegetable Box (₹399)
  2. Fresh Fruit Basket (₹499)
  3. Greens Detox Box (₹249)
- **Address Capture**: Captures customer address and checks morning/evening delivery availability.

### 3. "Cook the Harvest" Recipe to Cart
- **Trigger**: Comment `RECIPE` or `COOK` or `వండు`.
- **Private DM**: Step-by-step recipe card + 1-click pre-filled cart link with fresh organic ingredients.

---

## 6. Durable Background Jobs

| Job Name | Interval | Purpose |
|---|---|---|
| `tokens.refresh` | Every 12 Hours | Sweeps Instagram & FB Page tokens expiring in ≤ 15 days and refreshes with Meta Graph API. |
| `posts.publish_due` | Every 1 Minute | Inspects `ScheduledPost` queue and executes Meta Graph API container publishing for due posts/Reels. |
| `campaigns.send_broadcast` | On Enqueue | Robust, throttled WhatsApp/IG broadcast batcher resilient across server restarts. |
| `campaigns.resume_dangling` | Server Startup | Automatically recovers and resumes broadcasts interrupted by server restarts. |
