# lakshya

## MongoDB auth setup

1. Start MongoDB locally so `mongodb://127.0.0.1:27017/lakshya` is reachable, or change `server/.env` to your MongoDB URI.
2. Keep `JWT_SECRET` set in `server/.env`.
3. Run the backend from the repo root with `npm run server`.
4. Run the frontend with `npm run client`.

Registration and login now depend on MongoDB being available. If MongoDB is down, the auth API returns `503` instead of silently using mock data.
