# lakshya

## MongoDB auth setup

1. Start MongoDB locally so `mongodb://127.0.0.1:27017/lakshya` is reachable, or change `server/.env` to your MongoDB URI.
2. Keep `JWT_SECRET` set in `server/.env`.
3. Run the backend from the repo root with `npm run server`.
4. Run the frontend with `npm run client`.

Registration and login now depend on MongoDB being available. If MongoDB is down, the auth API returns `503` instead of silently using mock data.

## Deployment

Deploy the backend to Render and the frontend to Vercel.

### Render backend

1. In Render, create a new Web Service from this GitHub repo.
2. Render can auto-detect [`render.yaml`](c:\Users\Ayush Arvind Kamble\OneDrive\Documents\Desktop\Lakshya\render.yaml), or you can set the service manually with:
   - Root Directory: `server`
   - Build Command: `npm install`
   - Start Command: `npm start`
3. Add the environment variables from [`server/.env.example`](c:\Users\Ayush Arvind Kamble\OneDrive\Documents\Desktop\Lakshya\server\.env.example).
4. After deploy, open `https://YOUR-RENDER-URL/api/health` and confirm it returns JSON.

### Vercel frontend

1. In Vercel, import the same GitHub repo.
2. Set the Root Directory to `client`.
3. Framework preset: `Vite`.
4. Add `VITE_API_URL=https://YOUR-RENDER-URL/api`.
5. Redeploy and verify login/register requests go to Render.

The frontend already reads `VITE_API_URL`, so no code change is needed when switching from local backend to Render.

## Important

[`server/.env`](c:\Users\Ayush Arvind Kamble\OneDrive\Documents\Desktop\Lakshya\server\.env) currently contains real secrets. If that file was ever committed or pushed, rotate these immediately:

- `JWT_SECRET`
- `SMTP_GMAIL_APP_PASSWORD`
- `GROQ_API_KEY`
