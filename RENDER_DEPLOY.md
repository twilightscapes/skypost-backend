# Deploy to Render

## Quick Deploy Steps

1. **Create Render Account** (free tier): https://render.com

2. **Connect GitHub**:
   - Go to Render Dashboard → New → Web Service
   - Select GitHub → Connect GitHub account
   - Select `skypost-backend` repository

3. **Configure Service**:
   - **Name**: `skypost-license-backend`
   - **Branch**: `main`
   - **Root Directory**: `.` (leave empty, files are at root)
   - **Build Command**: `npm install`
   - **Start Command**: `node src/index-simple.js`
   - **Plan**: Free tier

4. **Deploy**: 
   - Click "Deploy" and wait 2-3 minutes
   - Check logs if deployment fails
   - Once live, you'll see a URL like `https://skypost-license-backend-xxxx.onrender.com`

5. **Update Stripe Webhook**:
   - Go to Stripe Dashboard → Developers → Webhooks
   - Click "Add Endpoint"
   - URL: `https://skypost-license-backend-xxxx.onrender.com/webhooks/stripe`
   - Events: `charge.succeeded`
   - Copy the "Signing secret" to `STRIPE_WEBHOOK_SECRET` env var in Render

6. **Test Backend**:
   ```bash
   curl https://skypost-license-backend-xxxx.onrender.com/
   # Should return: {"status":"ok"}
   ```

7. **Update Extension**:
   - Update [license.js](../safari-extension-pro/license.js)
   - Change backend URL from `localhost:3000` to your Render URL
   - Rebuild and test

## Troubleshooting

- **Render shows old code**: Clear cache in Render dashboard and redeploy
- **404 errors**: Check that files are at root (not in subdirectory)
- **Webhook not firing**: Verify webhook URL and signing secret match
- **Database not persisting**: SQLite file is stored in Render's /tmp, use external database for production

## Database Location

SQLite database is at `/tmp/licenses.db` on Render. This gets reset when dyno restarts.
For production, consider using Render's PostgreSQL add-on instead.
