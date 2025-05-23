# RSS Notifications Service - Complete Deployment Guide

## 📋 Prerequisites
- Node.js v20+ installed
- Cloudflare account
- Wrangler CLI installed: `npm install -g wrangler`
- Logged into Wrangler: `wrangler login`

## 🚀 Step-by-Step Deployment

### Step 0: Set Environment Variable (for testing)
```bash
# Export your broadcast token for easy testing
export BROADCAST_TOKEN="my-super-secure-broadcast-token-123"
```
**Note:** This is just for convenience during testing. The actual token is securely stored in Cloudflare via `wrangler secret put`.

### Step 1: Create Project Directory
```bash
mkdir rss-notifications-service
cd rss-notifications-service
mkdir src
```

### Step 2: Create wrangler.toml
Create `wrangler.toml` in the root directory:

```toml
name = "rss-notifications-service"
main = "src/index.js"
compatibility_date = "2024-01-01"

[[d1_databases]]
binding = "DB"
database_name = "rss-notifications-service-db"
database_id = "PLACEHOLDER_FOR_DATABASE_ID"
```

### Step 3: Create the Worker Code
Create `src/index.js` and copy the complete worker code from the artifact.

### Step 4: Create D1 Database
```bash
wrangler d1 create rss-notifications-service-db
```

**Expected output:**
```
✅ Successfully created DB 'rss-notifications-service-db' in region WEUR
Created your database using D1's new storage backend. The new storage backend is not yet recommended for production workloads, but backs up your data via point-in-time restore.

[[d1_databases]]
binding = "DB"
database_name = "rss-notifications-service-db"
database_id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"

```

### Step 5: Update wrangler.toml with Database ID
Replace `PLACEHOLDER_FOR_DATABASE_ID` in your `wrangler.toml` with the actual database ID from Step 4:

```toml
name = "rss-notifications-service"
main = "src/index.js"
compatibility_date = "2024-01-01"

[[d1_databases]]
binding = "DB"
database_name = "rss-notifications-service-db"
database_id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"  # ← Your actual ID here
```

### Step 6: Set Broadcast Token (Secret)
```bash
wrangler secret put BROADCAST_TOKEN
```

When prompted, enter a secure token (save this somewhere safe!):
```
Enter a secret value: my-super-secure-broadcast-token-123
```

### Step 7: Deploy the Worker
```bash
wrangler deploy
```

**Expected output:**
```
✅ Successfully published your Worker to:
https://rss-notifications-service.your-username.workers.dev
```

## 🌐 Optional: Add Custom Domain

### Update wrangler.toml for Custom Domain:

```toml
name = "rss-notifications-service"
main = "src/index.js"
compatibility_date = "2024-01-01"

# Custom domain (no wildcards or paths - they're not allowed)
routes = [
  { pattern = "feed.polysend.io", custom_domain = true }
]

[[d1_databases]]
binding = "DB"
database_name = "rss-notifications-service-db"
database_id = "2767890a-072a-410e-867e-8648e3cef718"
```

### Setup Steps:

1. **Add domain to Cloudflare (if needed):**
   - Go to Cloudflare Dashboard → Add site
   - Add `polysend.io` and follow setup instructions

2. **Configure custom domain:**
   - You can set up the DNS record via Cloudflare UI if preferred
   - Or the domain routing might be handled automatically when you deploy

3. **Deploy with custom domain:**
   ```bash
   wrangler deploy
   ```

4. **Verify setup:**
   ```bash
   curl https://feed.polysend.io/feed.xml
   ```

**Note:** Custom domains automatically handle all paths (`/feed.xml`, `/broadcast`, etc.) without needing wildcards.

## 🎉 Your RSS Service is Live!

### RSS Feed URLs:
- **XML Feed:** `https://feed.polysend.io/feed.xml`
- **JSON Feed:** `https://feed.polysend.io/feed.json`
- **API Docs:** `https://feed.polysend.io/`

### Test the Service:

#### 1. Check if it's working:
```bash
curl https://feed.polysend.io/feed.xml
```

#### 2. Update feed settings:
```bash
curl -X POST https://feed.polysend.io/settings \
  -H "Authorization: Bearer $BROADCAST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "My RSS Notifications Service",
    "description": "Updates and notifications from my service",
    "link": "https://myapp.com"
  }'
```

#### 3. Broadcast your first message:
```bash
curl -X POST https://feed.polysend.io/broadcast \
  -H "Authorization: Bearer $BROADCAST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Welcome to RSS Service!",
    "description": "Your RSS notification service is now live and ready to use.",
    "link": "https://polysend.io/welcome"
  }'
```

#### 4. Check your RSS feed:
```bash
curl https://feed.polysend.io/feed.xml
```

## 📁 Final Project Structure
```
rss-notifications-service/
├── src/
│   └── index.js           # Worker code
├── wrangler.toml          # Cloudflare config
└── README.md              # Optional documentation
```

## 🔧 Management Commands

### View database content:
```bash
wrangler d1 execute rss-notifications-service-db --command "SELECT * FROM feed_items;"
```

### View logs:
```bash
wrangler tail
```

### Update worker:
```bash
wrangler deploy
```

## 🛡️ Security Notes
- Keep your `BROADCAST_TOKEN` secret and secure
- Never commit secrets to version control
- The token is required for all admin operations (POST, PUT, DELETE)

## 🎯 Next Steps
1. Integrate the RSS feed URL into your client applications
2. Use the `/broadcast` endpoint to send notifications
3. Subscribe to your feed in RSS readers for testing
4. Set up monitoring and alerts as needed

Your RSS Notifications Service is now live and ready to use! 🚀