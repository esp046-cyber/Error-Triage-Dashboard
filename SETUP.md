# Setup — v3 (native iOS features + advanced n8n routing)

## What's new in this version

- **Files split**: `index.html`, `styles.css`, `app.js` (was one file)
- **Push notifications** for new errors (Safari 16.4+, installed PWA only)
- **App icon badge** showing the unresolved error count
- **In-app settings**: polling interval slider, client-tag filter dropdown, Clear Local Cache button
- **Circuit breaker**: workflows that fail >3 times in an hour get flagged in the UI, with a confirmation before you retry into the same failure
- **Dead Letter Queue (DLQ)**: a new hourly workflow that permanently logs anything still failing after 24 hours, before it ages out of n8n's history

Read this in order — some pieces (push) are meaningfully more involved than everything before it, and won't work on n8n Cloud (see below).

## 0. Deploy the frontend files

Upload all of these to your GitHub repo root, replacing the old single
`index.html`:

```
index.html
styles.css
app.js
sw.js
manifest.json
icon-192.png
icon-512.png
splash-1242x2208.png
splash-1125x2436.png
```

Nothing in these needs manual editing except optionally `VAPID_PUBLIC_KEY`
in `app.js` (step 3). The webhook URL, polling interval, and client filter
are all configured in-app via the ⚙️ Settings sheet, as before.

## 1. Basic setup (webhook URL, translation, retry)

Same as before — see the earlier setup steps if this is your first time:
n8n API key, `N8N_BASE_URL`, Anthropic credential, import
`get-errors-workflow.json` and `retry-error-workflow.json`, activate both,
paste the webhook base URL into the app's Settings sheet.

**Re-importing note:** this `get-errors-workflow.json` is a new version
(adds circuit breaker + push + a `/subscribe-push` endpoint). If you already
imported the v1 blueprint, either replace that workflow entirely with this
one, or manually add the new nodes — re-importing as a new workflow is
easier and won't affect `retry-error-workflow.json`.

## 2. Circuit breaker (works out of the box)

No extra setup — it's computed from data you already have. A workflow is
flagged `circuitBroken` when it's failed more than 3 times in the last hour,
using each workflow's own static data as a lightweight counter (no database
needed). In the app, flagged errors show an amber "⚡ Circuit broken" badge
and ask for confirmation before retrying.

## 3. Push notifications — **read this before enabling**

Real Web Push requires signing messages with a VAPID key pair, using the
`web-push` npm package inside n8n's Code node. This has one hard
requirement:

> **Push notifications only work on self-hosted n8n.** n8n Cloud's Code
> node runs in a sandbox that cannot `require()` external npm packages, so
> the push-sending node will silently no-op there. If you're on n8n Cloud,
> skip this section — everything else in the app works fine without it.

If you're self-hosted:

1. On the machine running n8n, install the package once:
   ```bash
   npm install web-push
   ```
   (If n8n runs in Docker, install it inside the container's n8n directory,
   or bake it into a custom image — exact path depends on your setup.)
2. Set the environment variable that allows the Code node to use it:
   ```
   NODE_FUNCTION_ALLOW_EXTERNAL=web-push
   ```
   Restart n8n after setting this.
3. Generate a VAPID key pair:
   ```bash
   npx web-push generate-vapid-keys
   ```
4. Set two more n8n environment variables: `VAPID_PUBLIC_KEY` and
   `VAPID_PRIVATE_KEY`, using the values just generated.
5. In `app.js`, find:
   ```js
   const VAPID_PUBLIC_KEY = "PASTE_YOUR_VAPID_PUBLIC_KEY_HERE";
   ```
   and paste in the **public** key only (the private key stays server-side,
   never in the frontend). Re-upload `app.js`.
6. On the iPhone: the PWA **must be installed to the home screen** first —
   Safari does not allow push permission prompts or subscriptions from a
   regular browser tab, even with everything else configured correctly.
7. Open the installed app → Settings (gear icon) → **Enable** under
   Notifications → accept the iOS permission prompt. You should see
   "✅ Notifications are on for this device."
8. Trigger a real new failure (or wait for one) — a push should arrive
   within about a minute (the workflow only pushes for errors it hasn't
   seen before, so re-polling the same error won't re-notify you).

**If it doesn't work:** open Safari's Web Inspector (connect the iPhone to
a Mac, Safari → Develop menu) and check the console for errors from
`enablePushNotifications()`, and check n8n's execution log for the "Send
Push Notifications" node — a caught `require('web-push')` failure there
means step 1–2 above didn't take effect.

## 4. App icon badge

Works automatically once the app is installed to the home screen, no setup
needed. It shows the current count of `failed` errors and clears itself
when everything's resolved. Support varies by iOS version — the app
feature-detects and simply skips this if `navigator.setAppBadge` isn't
available.

## 5. Dead Letter Queue (DLQ)

1. Set up a Google Sheet with a tab named exactly `DLQ Log` and these
   column headers in row 1: `Execution ID`, `Client`, `Workflow`,
   `Started At`, `Archived At`, `Raw Error`.
2. In n8n, add a **Google Sheets OAuth2** credential (Credentials → New →
   Google Sheets OAuth2 API) and sign in.
3. Import `dlq-workflow.json`.
4. Open the **Log to Google Sheets** node: select your new credential, and
   set the Sheet ID to your spreadsheet's ID (the long string in its URL).
5. Re-select your **n8n API** credential on both HTTP Request nodes
   (import strips credential references, as before).
6. **Activate** the workflow. It runs every hour, finds executions still
   failing after 24 hours, logs them to the sheet, and then deletes them
   from n8n's execution history via the API.
7. Prefer Postgres over Google Sheets? Replace the **Log to Google Sheets**
   node with a Postgres **Insert** node using the same six fields — the
   upstream data shape is identical either way.
8. If you'd rather n8n's execution history stay untouched (and just rely
   on n8n's own execution-pruning settings), delete the **Clear From
   Execution History** node — the Google Sheets log will still happen.

## 6. Everything else (recap from before)

- **Test Connection** in Settings still works the same way.
- **Refresh Interval slider** (5s/15s/60s) is purely client-side — no n8n
  changes needed, it just changes how often the app polls.
- **Client Tag dropdown** in Settings mirrors the filter chips on the main
  screen — both read from the same `client` field (your workflow tags).
- **Clear Local Cache** wipes this device's saved webhook URL, poll
  setting, and cached files, then reloads to the onboarding screen. Use it
  if the app seems stuck or Safari's storage limits are causing issues.

## 7. API key / Header Auth (v4)

The app now has an optional **n8n Webhook Auth Token** field in Settings.
When set, every request (`get-errors`, `retry-error`, `subscribe-push`,
and Test Connection) sends `Authorization: Bearer <token>`.

This is client-side only — the token is just a header the app attaches.
For it to actually protect anything, add **Header Auth** to each Webhook
node in your n8n workflows:

1. In each Webhook trigger node (Get Errors, Retry Error, Subscribe Push),
   set **Authentication** to **Header Auth**.
2. Create a Header Auth credential: header name `Authorization`, value
   `Bearer <your-chosen-token>` (pick any long random string).
3. Use that same token in the app's Settings sheet.

Leave the field blank if you don't want this — everything works exactly as
before without it.

## 8. Fatal error recovery

If the app hits an unrecoverable JavaScript error (corrupted localStorage,
an unexpected exception during startup, or a stray unhandled promise
rejection), it now shows a "Something went wrong" screen instead of going
blank, with a **Clear Cache & Reload** button. This wipes local settings
(webhook URL, token, poll interval) and cached files, then reloads to the
onboarding screen — the same effect as the Clear Local Cache button in
Settings, just reachable even if the rest of the UI is broken.
