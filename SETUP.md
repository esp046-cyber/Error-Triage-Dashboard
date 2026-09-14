# Wiring up the live backend

This turns the static PWA from mock data into a live dashboard backed by two
n8n workflows. Five files ship together:

- `index.html`, `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png` — the PWA (upload to GitHub Pages, same as before)
- `get-errors-workflow.json` — import into n8n, powers `GET /get-errors`
- `retry-error-workflow.json` — import into n8n, powers `POST /retry-error`

## 1. Generate an n8n API key

Both workflows call n8n's own REST API (`/api/v1/executions`) to read and
retry executions, so n8n needs to be able to authenticate to itself.

1. In your n8n instance: **Settings → n8n API → Create an API key**.
2. Copy the key immediately — n8n only shows it once.
3. In n8n, go to **Credentials → New → n8n API**, paste the key in, and save
   it (e.g. name it "n8n account"). This is the credential both imported
   workflows expect on their HTTP Request nodes.
4. Note your instance's base URL (e.g. `https://your-instance.app.n8n.cloud`
   or your self-hosted domain) — you'll set it as an environment variable
   next.

## 2. Set N8N_BASE_URL

The workflows reference `{{$env.N8N_BASE_URL}}` so the same blueprint works
across environments without hardcoding a URL.

- **Self-hosted**: add `N8N_BASE_URL=https://your-domain.com` to your n8n
  environment variables (`.env` file or however you configure the n8n
  process), then restart n8n.
- **n8n Cloud**: go to **Settings → Variables → Add Variable**, name it
  `N8N_BASE_URL`, set it to your instance URL.

## 3. Add an Anthropic API credential

The `get-errors` workflow's "Translate Error (Claude)" node needs an API
key to call `api.anthropic.com`.

1. Get a key from the [Anthropic Console](https://console.anthropic.com/).
2. In n8n: **Credentials → New → Header Auth**. Set the header name to
   `x-api-key` and the value to your key. Save it (e.g. "Anthropic API key").
3. After importing `get-errors-workflow.json`, open the "Translate Error
   (Claude)" node and select this credential (n8n doesn't export credential
   secrets, so you'll need to re-attach it once after import).

## 4. Import both workflows

1. In n8n: **Workflows → Import from File** → select `get-errors-workflow.json`.
2. Repeat for `retry-error-workflow.json`.
3. In each imported workflow, re-select your **n8n API** credential on the
   HTTP Request nodes that call `/api/v1/executions` (n8n strips credential
   references on import as a security measure).
4. **Activate** both workflows (toggle in the top-right of each workflow).
5. Each workflow's Webhook node shows a **Production URL** once active —
   confirm they end in `/webhook/get-errors` and `/webhook/retry-error`.

## 5. Tag workflows by client (optional but recommended)

The `get-errors` workflow reads the client name from the failing workflow's
first **tag**. In each of your client-facing n8n workflows, add a tag with
the client's name (e.g. "Acme Corp") so the dashboard can group and filter
by client. Untagged workflows show up under "Unassigned."

## 6. Point the frontend at your instance

In `index.html`, find this near the top of the `<script>` block:

```js
const API_BASE = "https://your-n8n-instance.example.com/webhook"; // <-- EDIT ME
```

Replace it with your instance's webhook base URL (everything up to and
including `/webhook`, no trailing slash), then re-upload `index.html` to
your GitHub repo.

## 7. CORS

Both webhook nodes are configured with `allowedOrigins: "*"` so requests
from your GitHub Pages origin are allowed. If you see CORS errors in Safari's
console after deploying:

- Narrow `allowedOrigins` to your exact Pages URL once things work (e.g.
  `https://your-username.github.io`) instead of leaving it as `*`.
- The retry POST sends a JSON body, which triggers a CORS **preflight**
  (an automatic `OPTIONS` request) from the browser. Recent n8n versions
  handle this automatically when `allowedOrigins` is set on the Webhook
  node; if you're on an older version and see preflight failures, add a
  second Webhook node on the same path listening for `OPTIONS` that
  immediately responds 200 with the same CORS headers.

## 8. Verify

- Open the deployed PWA — the subhead should change from "Loading…" to a
  real count within a few seconds.
- Trigger a real failure in one of your n8n workflows (or temporarily break
  a node) and confirm it appears in the feed within 10 seconds (the poll
  interval).
- Tap into it, confirm the Claude-generated plain-English translation shows
  up, then tap **Retry workflow** and confirm the execution re-runs in n8n.
