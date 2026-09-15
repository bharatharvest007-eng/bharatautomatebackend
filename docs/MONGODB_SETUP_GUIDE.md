# MongoDB Setup & Architecture Guide

This project is built from the ground up using **MongoDB** (via **Mongoose ODM**) as its primary document database. It does **not** use PostgreSQL, SQLite, or relational SQL.

---

## 1. Quick Start with MongoDB

### Option A: Local MongoDB (Default)
If you already have MongoDB installed locally as a Windows service or binary:
- Default connection string: `mongodb://localhost:27017/socialmedia_automation`
- Test connection:
  ```powershell
  node scripts/setup.mjs
  ```

### Option B: Docker Container
Run a lightweight local MongoDB instance with one command:
```powershell
docker run -d --name mongo-sma -p 27017:27017 -v mongo_data:/data/db mongo:latest
```

### Option C: MongoDB Atlas (Cloud)
1. Create a free cluster on [MongoDB Atlas](https://www.mongodb.com/cloud/atlas).
2. Create a database user and whitelist your IP (or `0.0.0.0/0` for development).
3. In your `.env` file, set your connection string:
   ```env
   DATABASE_URL=mongodb+srv://<username>:<password>@cluster0.abcde.mongodb.net/socialmedia_automation?retryWrites=true&w=majority
   ```

---

## 2. Initializing & Seeding the Database

Run the automated seeder to populate demo organizations, live automations, contacts, and templates:

```powershell
npm run db:seed
```

This populates:
- **Organization**: `org_demo` (Pro Workspace)
- **User**: `alex@creatorstudio.io` (Owner)
- **Social Account**: `@creator_studio` (Verified Instagram Professional Account)
- **Automations**:
  - Reel Keyword: `"GROWTH"` &rarr; Instant Blueprint DM
  - Story Mention: 6 Randomized Warm Auto-Replies
  - Comment Auto-Reply: Public comment engagement booster
- **Essentials**:
  - 4 Instagram Conversation Starters (Ice Breakers)
  - 4 Persistent DM Menu items (with WhatsApp `wa.me` redirect)
  - Brand Voice persona & guardrails
  - In-DM Lead Card ("VIP Crash Course")
  - Link in Bio Page (`/bio/creator_studio`) with custom links

---

## 3. MongoDB Architecture & Schema Overview

Every collection is defined cleanly with Mongoose models in `packages/db/src/models/`:

| Collection | Model File | Purpose |
|---|---|---|
| `organizations` | `Organization.ts` | Multi-tenant workspace definition with plan limits |
| `users` | `User.ts` | Team members with embedded `memberships` |
| `socialaccounts` | `SocialAccount.ts` | Instagram accounts, long-lived tokens, DM limits |
| `contacts` | `Contact.ts` | Audience CRM, follower status, tags, custom fields |
| `conversations` | `Conversation.ts` | 24-hour & 7-day `HUMAN_AGENT` messaging state |
| `messages` | `Message.ts` | Full inbound & outbound Instagram chat log |
| `automations` | `Automation.ts` | Keyword triggers, media scopes, visual flow graphs |
| `automationruns` | `AutomationRun.ts` | Execution history, step states, split tests |
| `commentlogs` | `CommentLog.ts` | Scanned comments, AI sentiment, spam auto-hide |
| `icebreakers` | `IceBreaker.ts` | Meta 4 Conversation Starters |
| `menuitems` | `MenuItem.ts` | 20-item Persistent DM Menu |
| `leadcards` | `LeadCard.ts` | In-DM form cards |
| `leadsubmissions`| `LeadSubmission.ts` | Captured lead contact info & answers |
| `biopages` | `BioPage.ts` | Custom link in bio pages with embedded `blocks` |
| `brandvoices` | `BrandVoice.ts` | Claude AI tutor persona, rules, and spam thresholds |
| `knowledgedocs` | `KnowledgeDoc.ts` | Knowledge base docs for retrieval augmented generation |
| `usagecounters` | `UsageCounter.ts` | High-speed atomic `$inc` counters for rate limits |
| `webhookevents` | `WebhookEvent.ts` | Raw Meta webhook delivery audit trail |

### High-Speed Atomic Counters
MongoDB's native `$inc` is used for ultra-fast, race-condition-free daily DM limits and rate counting via `packages/db/src/counters.ts`:
```ts
await UsageCounter.updateOne(
  { orgId, metric: 'dms_sent', period: '2026-09-15' },
  { $inc: { value: 1 } },
  { upsert: true }
);
```
