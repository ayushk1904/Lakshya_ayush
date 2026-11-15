# Lakshya

An AI study app with study plans, concept explanations, answer evaluation, voice revision,
practice tests, study rooms and webcam proctoring. AI answers run on your own computer through
[Ollama](https://ollama.com) using **Qwen 2.5 7B**. No paid AI API key is needed.

## Run it

Install Node.js 22.19 or newer (24.6+ recommended), Python 3.12, [Ollama](https://ollama.com) and MongoDB
(or use an existing MongoDB Atlas database). A GPU with about 8 GB of memory is recommended;
CPU inference also works but takes longer.

From this folder on Windows:

```powershell
npm install
npm --prefix server install
npm --prefix client install
py -3.12 -m venv .venv
.venv\Scripts\python -m pip install -r planner-ai/requirements.txt -r proctor-ai/requirements.txt
ollama pull qwen2.5:7b
Copy-Item .env.example .env
```

Set `MONGODB_URI` and a long random `JWT_SECRET` in `.env`. Start MongoDB if you use a local
database, and keep Ollama running. Existing `server/.env` settings are also supported as fallbacks;
values in the root `.env` take precedence. Both files are ignored by Git.

Start everything with one command:

```powershell
npm start
```

On Windows you can also double-click **`start.bat`**. Open http://127.0.0.1:5000.
The launcher builds the website, starts both Python services and the backend, then checks that
MongoDB and Qwen are available. It can start Ollama if the local service is stopped.
Press Ctrl+C or close the launcher window to stop the app. An already running Ollama service is
left running.

On macOS/Linux, create the environment with `python3.12 -m venv .venv` and install with
`.venv/bin/python -m pip install -r planner-ai/requirements.txt -r proctor-ai/requirements.txt`.
Copy the example using `cp .env.example .env`, then run `npm start`.

## A public link that stays the same

Use the same local hosting pattern as Manzil AI: your computer runs the app and Ollama, and
[ngrok](https://ngrok.com/docs/gateway/agent/cli) supplies the public HTTPS address.

1. Create an ngrok account, then install the agent: `winget install ngrok.ngrok`.
2. Copy your authtoken from the [dashboard](https://dashboard.ngrok.com/get-started/your-authtoken)
   and run `ngrok config add-authtoken YOUR_TOKEN` once. Keep the token private.
3. Find your assigned domain under [Domains](https://dashboard.ngrok.com/domains).
   Add `NGROK_DOMAIN=your-assigned-domain.ngrok-free.dev` to the root `.env`, using the exact
   hostname from your dashboard, without `https://`.
4. Double-click **`start-fixed-link.bat`**, or run `npm run start:fixed`.
5. Open the printed `https://YOUR-DOMAIN` address. Check `/api/health` on that address:
   it should report `status: ok` and `database: connected`.

For a public link without specifying a domain, use **`start-public.bat`** or `npm run start:public`.
It uses `NGROK_DOMAIN` when set; otherwise ngrok selects your account's default address.
The ngrok agent must already be authenticated. A domain can serve one of your local projects at
a time; stop its other tunnel before using the same domain for Lakshya.

If Lakshya uses a different ngrok account from another project, set `NGROK_AUTHTOKEN` in this
project's private `.env` to the token from the account that owns its domain. This avoids changing
the other project's global ngrok credentials. The launcher passes an explicit, temporary private
config to the ngrok CLI and removes it on exit. Do not share or commit the token.
If Lakshya is already running locally, `npm run tunnel` opens just its public tunnel.
Running the launcher again detects a healthy existing Lakshya app and reuses its tunnel when
the domain and local port match, so an accidental second launch does not start duplicate servers.

## Keep Manzil AI and Lakshya online together

Both projects can run on the same computer. Keep Manzil AI on port `8000` and Lakshya on
port `5002` (set `PORT=5002` in Lakshya's `.env`). Start each project's `start-fixed-link.bat`
once and keep the original windows running. Each project needs its own ngrok domain/account
configuration; Lakshya's `NGROK_AUTHTOKEN` selects its account without changing Manzil's settings.
The two apps can use the same running Ollama service on port `11434`.

If both public links are already working, simply open them in your browser. You do not need
to start either app again. Closing a second launcher window does not stop the existing app.

The public address serves the built website and `/api` together. Room invite links use the
address open in the browser. Ollama (11434), Planner AI (8001) and Proctor AI (8002) stay private
on localhost. The launcher's build uses `/api` and the current browser origin automatically.
There is no separate frontend hosting service or cloud AI service to configure.

This setup works while your computer is on and the launcher is running. Anyone with the link
can reach registration and use an account, so share it only with people you trust. The free
ngrok plan may show a notice before the app. Press Ctrl+C to stop the app and its tunnel.
Uploads and saved study information remain in your configured MongoDB database.

## Environment variables

| Name | Purpose |
|---|---|
| `MONGODB_URI` | Required: local MongoDB or an Atlas connection string. |
| `JWT_SECRET` | Required: a long random secret for login tokens. |
| `OLLAMA_BASE_URL` | Default `http://127.0.0.1:11434`. Use the Ollama server base URL, without `/api`. |
| `OLLAMA_MODEL` | Default `qwen2.5:7b`. Pull the same model with `ollama pull`. |
| `OLLAMA_TIMEOUT_SECONDS` | Default `300`. Increase for slower local inference. |
| `OLLAMA_NUM_CTX`, `OLLAMA_MAX_CTX` | Default `8192` and `16384`. Short requests use the smaller GPU context; long evidence gets more room. |
| `OLLAMA_KEEP_ALIVE` | Default `-1`: keep Qwen loaded between requests. |
| `OLLAMA_LOG_TIMINGS` | Set `true` to log token counts and timing, without logging document text. |
| `NGROK_DOMAIN` | Your assigned fixed hostname; required by `start-fixed-link.bat`. |
| `NGROK_AUTHTOKEN` | Optional project-specific account token. The launcher explicitly selects it through a temporary private ngrok config. |
| `HOST`, `PORT` | Default `127.0.0.1` and `5000`. The ngrok launcher tunnels this port. |
| `NODE_USE_SYSTEM_CA` | `1` in the example: also trust OS certificate authorities, keeping TLS verification enabled. Useful for Atlas on networks with managed certificates. |
| `YOUTUBE_API_KEY` | Optional: concept explainer video search. |
| `SMTP_GMAIL_USER`, `SMTP_GMAIL_APP_PASSWORD`, `MAIL_FROM` | Optional: password reset emails. |
| `APP_TIMEZONE` | Optional; use `Asia/Kolkata` for India. |
| `PLANNER_AI_TOKEN`, `PROCTOR_AI_TOKEN` | Optional shared secrets for internal services. |
| `LAKSHYA_PYTHON` | Optional explicit Python executable. Otherwise root `.venv`, service `.venv`, then system Python are tried. |

The computer-vision proctor uses its existing OpenCV/YOLO models, independently of Qwen.
The planner retrieves evidence with BM25, so it does not need an Ollama embedding model.

## Development

For hot reload, run these in separate terminals:

```powershell
npm run server
npm run planner:dev
npm run proctor:dev
npm run client
```

Open the Vite address printed by `npm run client`. Vite proxies `/api` to port 5000 by default.
Only development needs that separate frontend port; the public launcher serves the production
build through Express. Optional client settings are documented in `client/.env.example`.

## Troubleshooting

- **Ollama unavailable or model missing:** start Ollama, run `ollama list`, then
  `ollama pull qwen2.5:7b`. Test the service at http://127.0.0.1:11434/api/tags.
- **AI answers are slow:** run `ollama ps`. On a supported NVIDIA machine, Qwen should report
  `100% GPU`. `100% CPU` is much slower; restarting Ollama after a GPU detection failure can
  recover acceleration. Keep your GPU driver and Ollama current. The backend preloads Qwen,
  keeps it resident, limits short answers, and monitors readiness every minute. Read
  `/api/ai/status` to see the loaded model and processor.
- **Database disconnected:** start MongoDB or fix `MONGODB_URI`. Authentication needs MongoDB;
  the launcher stops before opening a public tunnel if the database is unavailable.
- **Python package missing:** install both requirements files using the Python inside `.venv`.
- **Port already in use:** a healthy existing Lakshya app is reused. If a different app occupies
  the configured port, choose another `PORT` or stop that conflicting service. The launcher also
  checks ports 8001 and 8002 before starting new AI services.
- **ngrok authentication/domain error:** check `ngrok config check`, your authtoken and the
  exact domain in your dashboard. Close any tunnel already using that domain.
- **ngrok certificate error with Avast:** if Avast substitutes a certificate issued by
  `Avast Web/Mail Shield Untrusted Root`, add an HTTPS website exception for
  `connect.ngrok-agent.com` in Avast's Web Guard/Web Shield, then retry. See
  [Avast's exception instructions](https://support.avast.com/article/antivirus-scan-exclusions/).

See [Planner AI](planner-ai/README.md) and [Proctor AI](proctor-ai/README.md) for service details.

`npm run check:ai` measures the real explainer, quiz, coach, evaluator and Study Hub routes using
temporary test data that it removes afterward. It requires the configured database and Ollama;
add `-- --live` to check the already running backend. Timings are saved in `.cache/ai-feature-results.json`.
Run `.venv\Scripts\python planner-ai/check_ai.py` to measure syllabus indexing, study planning
and practice-paper generation with sample material. These checks run real inference, so let them
finish before measuring another request.
