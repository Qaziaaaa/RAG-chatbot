# Deployment Guide — RAG Chatbot

**Stack:** Node.js/Express backend → Railway · React/Vite frontend → Vercel · Database → Supabase

---

## Prerequisites

Accounts you need (all free):

| Service | Purpose | Sign up |
|---|---|---|
| [Supabase](https://supabase.com) | Database + Auth | Already set up |
| [Groq](https://console.groq.com/keys) | LLM API | Free key |
| [Jina AI](https://jina.ai/api-dashboard/key-manager) | Embeddings API | Free key |
| [Railway](https://railway.app) | Backend hosting | Free tier |
| [Vercel](https://vercel.com) | Frontend hosting | Free tier |
| GitHub | Source control | Push your repo |

---

## Step 1 — Push to GitHub

Make sure your code is pushed to a GitHub repository.

```bash
git add .
git commit -m "ready for deployment"
git push origin main
```

> **Important:** Confirm `.gitignore` excludes `backend/.env` and `frontend/.env` — never commit secrets.

---

## Step 2 — Supabase Database Setup

If you haven't run the migrations yet:

1. Go to your [Supabase dashboard](https://supabase.com) → SQL Editor
2. Run each file in order:

```
backend/database/schema.sql              ← base tables + pgvector
backend/database/schema_v2_migration.sql ← file_type, upload_jobs
backend/database/schema_v3_migration.sql ← user_id isolation
```

3. Collect these values from **Settings → API**:
   - `SUPABASE_URL` — e.g. `https://abcxyz.supabase.co`
   - `SUPABASE_ANON_KEY` — starts with `eyJ...`
   - `SUPABASE_SERVICE_ROLE_KEY` — starts with `eyJ...` (keep secret)

4. From **Authentication → URL Configuration**, note your site URL (you'll update this after Vercel deploy).

---

## Step 3 — Deploy Backend to Railway

### 3.1 Create the project

1. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
2. Select your repository
3. Click **Add service** → **GitHub Repo**
4. In service settings → **Root Directory**: set to `backend`
5. Railway auto-detects Node.js and runs `npm start`

### 3.2 Set environment variables

In Railway → your service → **Variables**, add all of these:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | *(leave blank — Railway injects this automatically)* |
| `GROQ_API_KEY` | your Groq API key |
| `LLM_MODEL` | `llama-3.1-8b-instant` |
| `SUPABASE_URL` | your Supabase project URL |
| `SUPABASE_ANON_KEY` | your Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | your Supabase service role key |
| `JINA_API_KEY` | your Jina AI key |
| `ALLOWED_ORIGINS` | *(leave blank for now — add Vercel URL after Step 4)* |

### 3.3 Deploy and verify

Railway deploys automatically. Once done, you get a URL like:
```
https://your-app-name.railway.app
```

Test it:
```
GET https://your-app-name.railway.app/api/health
```

Expected response:
```json
{ "status": "ok", "database": "connected", "llm": "configured" }
```

---

## Step 4 — Deploy Frontend to Vercel

### 4.1 Update vercel.json

Open `frontend/vercel.json` and replace the placeholder with your Railway URL:

```json
{
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://your-app-name.railway.app/api/:path*"
    }
  ]
}
```

Commit and push this change:
```bash
git add frontend/vercel.json
git commit -m "fix: set Railway backend URL in vercel.json"
git push origin main
```

### 4.2 Create the Vercel project

1. Go to [vercel.com](https://vercel.com) → **New Project** → **Import from GitHub**
2. Select your repository
3. Configure:
   - **Root Directory**: `frontend`
   - **Framework Preset**: Vite *(auto-detected)*
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`

### 4.3 Set environment variables in Vercel

In Vercel → your project → **Settings → Environment Variables**:

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | your Supabase anon key |

> Note: `VITE_` prefix is required — Vite only exposes env vars with this prefix to the browser.

### 4.4 Deploy

Click **Deploy**. Vercel gives you a URL like:
```
https://your-app-name.vercel.app
```

---

## Step 5 — Wire Everything Together

### 5.1 Update CORS on the backend

Go back to Railway → Variables and add:

```
ALLOWED_ORIGINS=https://your-app-name.vercel.app
```

Railway auto-redeploys on variable changes.

### 5.2 Update Supabase Auth redirect URLs

In Supabase → **Authentication → URL Configuration**:

- **Site URL**: `https://your-app-name.vercel.app`
- **Redirect URLs**: add `https://your-app-name.vercel.app/**`

This is required for email confirmation links and OAuth redirects to work correctly.

---

## Step 6 — Keep-Alive Setup (Free Tier)

Supabase free projects pause after 7 days of inactivity. The backend already pings the DB every 3 days in production, but if the backend itself sleeps (Railway free tier sleeps after inactivity), set up an external cron:

1. Go to [cron-job.org](https://cron-job.org) → Create cronjob
2. URL: `https://your-app-name.railway.app/api/health`
3. Schedule: every 14 minutes (keeps Railway awake) or every 3 days (just for Supabase)

---

## Step 7 — Smoke Test Checklist

Run through this after deployment:

- [ ] `GET /api/health` returns `{ "status": "ok", "database": "connected" }`
- [ ] Frontend loads at your Vercel URL
- [ ] Sign up with email works (check for confirmation email)
- [ ] Log in works
- [ ] Upload a PDF or text file — status shows "processing" then "ready"
- [ ] Ask a question — streaming response appears word-by-word
- [ ] Source citations appear below the answer
- [ ] Delete a document — it disappears from the list
- [ ] Sign out — document list clears

---

## Environment Variables Reference

### Backend (`backend/.env` / Railway Variables)

| Variable | Required | Description |
|---|---|---|
| `NODE_ENV` | Yes | Set to `production` |
| `PORT` | No | Injected by Railway automatically |
| `GROQ_API_KEY` | Yes | Groq LLM API key |
| `LLM_MODEL` | No | Default: `llama-3.1-8b-instant` |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_ANON_KEY` | Yes | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key (server-side only) |
| `JINA_API_KEY` | Yes | Jina AI embeddings key |
| `ALLOWED_ORIGINS` | Yes (prod) | Comma-separated list of allowed frontend URLs |

### Frontend (`frontend/.env` / Vercel Variables)

| Variable | Required | Description |
|---|---|---|
| `VITE_SUPABASE_URL` | Yes | Same as backend `SUPABASE_URL` |
| `VITE_SUPABASE_ANON_KEY` | Yes | Same as backend `SUPABASE_ANON_KEY` |

---

## Free Tier Limits

| Service | Free Tier |
|---|---|
| Railway | $5 credit/month (enough for a small app) |
| Vercel | Unlimited deployments, 100GB bandwidth/month |
| Supabase | 500MB database, pauses after 7 days inactivity |
| Groq | 14,400 requests/day, 1M tokens/day |
| Jina AI | 1M tokens free |

---

## Troubleshooting

**Backend won't start on Railway**
- Check Variables tab — all 4 required vars must be set (`GROQ_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `JINA_API_KEY`)
- Check Deploy Logs for the specific error

**Frontend shows "Could not reach the server"**
- Verify `frontend/vercel.json` has the correct Railway URL
- Check that `ALLOWED_ORIGINS` on Railway includes your Vercel URL exactly (no trailing slash)

**Uploads fail silently**
- Check Railway logs for embedding errors
- Verify `JINA_API_KEY` is set and valid

**Auth emails not arriving**
- Check Supabase → Authentication → URL Configuration has the correct Site URL
- Check spam folder

**Supabase "project paused" error**
- Go to Supabase dashboard and click "Restore project"
- Set up the cron-job.org keep-alive ping

---

## Updating the App

After making code changes:

```bash
git add .
git commit -m "your change description"
git push origin main
```

Both Railway and Vercel auto-deploy on push to `main`.
