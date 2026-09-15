/* ==========================================================================
   ZERO-CODE CONFIG
   The n8n webhook base URL lives in this browser's localStorage instead of
   being hardcoded — set once via the ⚙️ Settings sheet, no file editing.
   ========================================================================== */

const STORAGE_KEY = "wdib_webhook_base";
const POLL_STORAGE_KEY = "wdib_poll_ms";
const POLL_OPTIONS_MS = [5000, 15000, 60000]; // slider positions 0/1/2
const DEFAULT_POLL_MS = 10000;
let pollTimer = null;

/* Web Push (native iOS 16.4+ notifications).
   Generate a VAPID key pair once with:
     npx web-push generate-vapid-keys
   Paste the PUBLIC key below. The PRIVATE key goes into n8n as an
   environment variable / credential — see SETUP.md. Push notifications
   simply won't be offered to the user until this is filled in. */
const VAPID_PUBLIC_KEY = "PASTE_YOUR_VAPID_PUBLIC_KEY_HERE";

function getWebhookBase() {
  return (localStorage.getItem(STORAGE_KEY) || "").trim().replace(/\/$/, "");
}
function setWebhookBase(url) {
  localStorage.setItem(STORAGE_KEY, url.trim().replace(/\/$/, ""));
}
function isConfigured() {
  return getWebhookBase().length > 0;
}
function getErrorsUrl() {
  return `${getWebhookBase()}/get-errors`;
}
function retryErrorUrl() {
  return `${getWebhookBase()}/retry-error`;
}
function subscribePushUrl() {
  return `${getWebhookBase()}/subscribe-push`;
}

function getPollMs() {
  const saved = parseInt(localStorage.getItem(POLL_STORAGE_KEY), 10);
  return POLL_OPTIONS_MS.includes(saved) ? saved : DEFAULT_POLL_MS;
}
function setPollMs(ms) {
  localStorage.setItem(POLL_STORAGE_KEY, String(ms));
}

/* ==========================================================================
   STATE + RENDER
   `errors` is populated entirely from the live backend — no seeded/mock
   entries here. `client` values come from whatever workflow tags your n8n
   instance returns, so the filter chip row is built dynamically too.
   ========================================================================== */

let errors = [];
let activeFilter = "All";
let openErrorId = null;
let isFirstLoad = true;

const feedEl = document.getElementById("feed");
const chipRowEl = document.getElementById("chipRow");
const subheadEl = document.getElementById("subhead");

function minutesSince(isoString) {
  if (!isoString) return 0;
  const diffMs = Date.now() - new Date(isoString).getTime();
  return Math.max(0, Math.round(diffMs / 60000));
}

function timeAgo(isoString) {
  const mins = minutesSince(isoString);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  return `${h}h ago`;
}

function renderChips() {
  const clients = [...new Set(errors.map(e => e.client))].sort();
  const filters = ["All", ...clients];
  chipRowEl.innerHTML = filters.map(f =>
    `<button class="chip ${f === activeFilter ? "active" : ""}" data-filter="${f}">${f}</button>`
  ).join("");
  chipRowEl.querySelectorAll(".chip").forEach(chip => {
    chip.addEventListener("click", () => {
      activeFilter = chip.dataset.filter;
      renderChips();
      renderFeed();
    });
  });
}

function renderFeed() {
  const visible = errors.filter(e => activeFilter === "All" || e.client === activeFilter);
  const failingCount = errors.filter(e => e.status === "failed").length;

  subheadEl.textContent = failingCount === 0
    ? "All workflows healthy"
    : `${failingCount} workflow${failingCount === 1 ? "" : "s"} need attention`;

  if (visible.length === 0) {
    feedEl.innerHTML = `
      <div class="empty-state">
        <div class="glyph">✅</div>
        <p>No errors for ${activeFilter} — all workflows healthy.</p>
      </div>`;
    return;
  }

  feedEl.innerHTML = visible.map(e => `
    <button class="error-card" data-id="${e.id}">
      <div class="card-top-row">
        <div class="client-tag">
          <span class="status-dot ${e.status}"></span>
          ${e.client}
        </div>
        <span class="status-label ${e.status}">${e.status}</span>
      </div>
      ${e.circuitBroken ? `<div class="circuit-badge">⚡ Circuit broken — failing repeatedly</div>` : ""}
      <div class="workflow-name">${e.workflow}</div>
      <div class="node-name">${e.node}</div>
      <div class="card-bottom-row">
        <span class="timestamp">${timeAgo(e.startedAt)}</span>
        <span class="chevron">›</span>
      </div>
    </button>
  `).join("");

  feedEl.querySelectorAll(".error-card").forEach(card => {
    card.addEventListener("click", () => openSheet(card.dataset.id));
  });
}

/* ==========================================================================
   DETAIL SHEET
   ========================================================================== */

const sheetEl = document.getElementById("sheet");
const scrimEl = document.getElementById("scrim");
const sheetScrollEl = document.getElementById("sheetScroll");
const retryBtn = document.getElementById("retryBtn");
const retryLabel = document.getElementById("retryLabel");

function openSheet(id) {
  openErrorId = id;
  const e = errors.find(x => x.id === id);
  renderSheetContent(e);
  sheetEl.classList.add("open");
  scrimEl.classList.add("open");
  sheetEl.setAttribute("aria-hidden", "false");
  resetRetryButton(e);
}

function closeSheet() {
  sheetEl.classList.remove("open");
  scrimEl.classList.remove("open");
  sheetEl.setAttribute("aria-hidden", "true");
  openErrorId = null;
}

function renderSheetContent(e) {
  sheetScrollEl.innerHTML = `
    <div class="sheet-header">
      <div class="client-tag" style="margin-bottom:8px;">
        <span class="status-dot ${e.status}"></span>
        ${e.client} · <span class="status-label ${e.status}" style="margin-left:2px;">${e.status}</span>
      </div>
      <div class="workflow-name">${e.workflow}</div>
      <div class="node-name">${e.node}</div>
    </div>

    ${e.circuitBroken ? `<div class="circuit-badge" style="margin-bottom:16px;">⚡ Circuit broken — this workflow has failed repeatedly in the last hour</div>` : ""}

    <div class="translation-card" style="margin-bottom:16px;">
      <div class="translation-label">PLAIN ENGLISH</div>
      ${e.translation
        ? `<div class="translation-text">${e.translation}</div>`
        : `<div class="translation-loading"><span class="spinner" style="border-top-color:var(--action); border-color:rgba(76,141,255,0.3); border-top-color:var(--action);"></span> Translating error…</div>`
      }
    </div>

    <div class="accordion" id="traceAccordion" style="margin-bottom:16px;">
      <button class="accordion-toggle" id="traceToggle">
        Raw stack trace
        <span class="chevron">›</span>
      </button>
      <div class="accordion-body">
        <pre class="stack-trace">${e.raw}</pre>
      </div>
    </div>

    <div class="meta-list">
      <div><span>Client</span><span>${e.client}</span></div>
      <div><span>Node</span><span>${e.node}</span></div>
      <div><span>Last run</span><span>${timeAgo(e.startedAt)}</span></div>
    </div>
  `;

  document.getElementById("traceToggle").addEventListener("click", () => {
    document.getElementById("traceAccordion").classList.toggle("open");
  });
}

function resetRetryButton(e) {
  retryBtn.disabled = false;
  retryBtn.classList.remove("resolved", "failed-again");
  retryLabel.innerHTML =
    e.status === "resolved" ? "Retry again" : "Retry workflow &nbsp;↻";
}

/* Posts to the n8n retry-error webhook to actually re-trigger the failed
   execution. Optimistically flips the row to "retrying" so the UI feels
   instant, then reconciles with whatever the next poll returns. */
retryBtn.addEventListener("click", async () => {
  if (!openErrorId) return;
  const e = errors.find(x => x.id === openErrorId);

  if (e.circuitBroken) {
    const proceed = confirm(
      `${e.workflow} has failed more than 3 times in the last hour. Retrying now will likely hit the same problem again — continue anyway?`
    );
    if (!proceed) return;
  }

  retryBtn.disabled = true;
  retryLabel.innerHTML = `<span class="spinner"></span> Retrying…`;
  e.status = "retrying";
  renderFeed();

  try {
    const res = await fetch(retryErrorUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ executionId: e.executionId })
    });
    const data = await res.json();

    if (!res.ok || data.success === false) {
      throw new Error(data.error || `Retry request failed (${res.status})`);
    }

    retryBtn.classList.add("resolved");
    retryLabel.textContent = "Retry sent ✓";
    setConnBanner(false);

    // Give n8n a moment to actually run the workflow, then re-poll for the
    // real outcome instead of guessing at it client-side.
    setTimeout(fetchErrors, 3000);
  } catch (err) {
    console.error("Retry failed:", err);
    e.status = "failed";
    retryBtn.classList.add("failed-again");
    retryLabel.textContent = "Retry failed — tap to try again";
    retryBtn.disabled = false;
    renderFeed();
  }
});

scrimEl.addEventListener("click", closeSheet);

/* ==========================================================================
   LIVE FETCH + POLLING
   ========================================================================== */

const connBannerEl = document.getElementById("connBanner");
const connBannerTextEl = document.getElementById("connBannerText");

function setConnBanner(show, message) {
  connBannerEl.classList.toggle("show", show);
  if (message) connBannerTextEl.textContent = message;
}

async function fetchErrors() {
  if (!isConfigured()) return;
  try {
    const res = await fetch(getErrorsUrl(), { headers: { "Accept": "application/json" } });
    if (!res.ok) throw new Error(`Backend returned ${res.status}`);
    const data = await res.json();

    errors = (data.errors || []).map(e => ({ ...e, id: e.executionId }));
    setConnBanner(false);
    renderChips();
    renderFeed();
    populateClientFilterSelect();
    updateAppBadge();

    // Keep the open detail sheet in sync with the latest poll, in case a
    // retry resolved (or re-failed) while the user was looking at it.
    if (openErrorId) {
      const updated = errors.find(x => x.id === openErrorId);
      if (updated) {
        renderSheetContent(updated);
        resetRetryButton(updated);
      } else {
        // The execution no longer appears in the failed-executions list,
        // which means the retry succeeded — n8n's /executions?status=error
        // filter simply won't return it anymore.
        retryBtn.classList.remove("failed-again");
        retryBtn.classList.add("resolved");
        retryBtn.disabled = true;
        retryLabel.textContent = "Resolved ✓";
      }
    }
  } catch (err) {
    console.error("Failed to fetch errors:", err);
    setConnBanner(
      true,
      "Can't reach your n8n instance right now. Showing the last data received."
    );
    // Still render whatever we already have, subhead included.
    if (isFirstLoad) {
      subheadEl.textContent = "Couldn't load the error feed";
      renderChips();
      renderFeed();
    }
  } finally {
    isFirstLoad = false;
  }
}

/* ==========================================================================
   APP ICON BADGING (Safari 16.4+, installed PWA only)
   ========================================================================== */

function updateAppBadge() {
  if (!("setAppBadge" in navigator)) return; // not supported on this browser
  const unresolvedCount = errors.filter(e => e.status === "failed").length;
  try {
    if (unresolvedCount > 0) {
      navigator.setAppBadge(unresolvedCount).catch(() => {});
    } else if ("clearAppBadge" in navigator) {
      navigator.clearAppBadge().catch(() => {});
    }
  } catch (err) {
    // Badging API can throw on unsupported platforms even after the
    // feature-detect above (older Safari betas) — fail silently.
  }
}

/* ==========================================================================
   WEB PUSH NOTIFICATIONS (Safari 16.4+, installed PWA only)
   Real push delivery requires the get-errors n8n workflow to be configured
   with a matching VAPID private key — see SETUP.md. Without VAPID_PUBLIC_KEY
   filled in above, these functions no-op so the rest of the app still works.
   ========================================================================== */

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

function pushConfigured() {
  return (
    VAPID_PUBLIC_KEY &&
    VAPID_PUBLIC_KEY !== "PASTE_YOUR_VAPID_PUBLIC_KEY_HERE" &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

async function enablePushNotifications() {
  if (!pushConfigured()) {
    alert("Push notifications aren't set up yet — add a VAPID public key in app.js and import subscribe-push support in your n8n workflow first (see SETUP.md).");
    return false;
  }
  if (!isConfigured()) {
    alert("Connect your n8n instance first, then enable notifications.");
    return false;
  }

  try {
    // iOS Safari requires this call to happen inside a user gesture
    // (a tap), which is why this only runs from the Enable button —
    // never automatically on page load.
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      updateNotifStatusText();
      return false;
    }

    const reg = await navigator.serviceWorker.ready;
    let subscription = await reg.pushManager.getSubscription();
    if (!subscription) {
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });
    }

    await fetch(subscribePushUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription)
    });

    updateNotifStatusText();
    return true;
  } catch (err) {
    console.error("Failed to enable push notifications:", err);
    alert("Couldn't enable notifications. Make sure the app is installed to your home screen (Add to Home Screen) — Safari only allows push from installed PWAs.");
    return false;
  }
}

function updateNotifStatusText() {
  const el = document.getElementById("notifStatusText");
  const btn = document.getElementById("enableNotifsBtn");
  if (!el || !btn) return;

  if (!("Notification" in window)) {
    el.textContent = "Notifications aren't supported in this browser.";
    btn.style.display = "none";
    return;
  }
  if (Notification.permission === "granted") {
    el.textContent = "✅ Notifications are on for this device.";
    btn.textContent = "Re-sync";
  } else if (Notification.permission === "denied") {
    el.textContent = "Notifications are blocked in Safari settings for this app.";
    btn.style.display = "none";
  } else {
    el.textContent = "Get a push alert the moment a new workflow error comes in.";
    btn.textContent = "Enable";
  }
}

/* ==========================================================================
   ONBOARDING + SETTINGS SHEET
   ========================================================================== */

const onboardingEl = document.getElementById("onboarding");
const gearBtn = document.getElementById("gearBtn");
const configureNowBtn = document.getElementById("configureNowBtn");
const settingsSheetEl = document.getElementById("settingsSheet");
const settingsScrimEl = document.getElementById("settingsScrim");
const webhookInput = document.getElementById("webhookInput");
const testConnBtn = document.getElementById("testConnBtn");
const testResultEl = document.getElementById("testResult");
const saveSettingsBtn = document.getElementById("saveSettingsBtn");
const pollSlider = document.getElementById("pollSlider");
const pollValueLabel = document.getElementById("pollValueLabel");
const clientFilterSelect = document.getElementById("clientFilterSelect");
const enableNotifsBtn = document.getElementById("enableNotifsBtn");
const clearCacheBtn = document.getElementById("clearCacheBtn");

function showOnboarding(show) {
  onboardingEl.style.display = show ? "block" : "none";
  feedEl.style.display = show ? "none" : "block";
  if (show) setConnBanner(false);
}

function openSettings() {
  webhookInput.value = getWebhookBase();
  testResultEl.textContent = "";
  testResultEl.className = "test-result";

  const pollIndex = POLL_OPTIONS_MS.indexOf(getPollMs());
  pollSlider.value = pollIndex === -1 ? 0 : pollIndex;
  updatePollLabel();

  populateClientFilterSelect();
  updateNotifStatusText();

  settingsSheetEl.classList.add("open");
  settingsScrimEl.classList.add("open");
  settingsSheetEl.setAttribute("aria-hidden", "false");
}

function closeSettings() {
  settingsSheetEl.classList.remove("open");
  settingsScrimEl.classList.remove("open");
  settingsSheetEl.setAttribute("aria-hidden", "true");
}

gearBtn.addEventListener("click", openSettings);
configureNowBtn.addEventListener("click", openSettings);
settingsScrimEl.addEventListener("click", closeSettings);

testConnBtn.addEventListener("click", async () => {
  const url = webhookInput.value.trim().replace(/\/$/, "");
  if (!url) {
    testResultEl.textContent = "Paste a URL first";
    testResultEl.className = "test-result fail";
    return;
  }

  testConnBtn.disabled = true;
  testResultEl.textContent = "Testing…";
  testResultEl.className = "test-result testing";

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);

  try {
    const res = await fetch(`${url}/get-errors`, {
      headers: { "Accept": "application/json" },
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await res.json(); // confirm it actually returns JSON, not just any 200
    testResultEl.textContent = "✅ Connected";
    testResultEl.className = "test-result success";
  } catch (err) {
    console.error("Connection test failed:", err);
    testResultEl.textContent = "❌ Connection failed";
    testResultEl.className = "test-result fail";
  } finally {
    clearTimeout(timeoutId);
    testConnBtn.disabled = false;
  }
});

saveSettingsBtn.addEventListener("click", () => {
  const url = webhookInput.value.trim().replace(/\/$/, "");
  if (!url) {
    testResultEl.textContent = "Paste a URL first";
    testResultEl.className = "test-result fail";
    return;
  }
  setWebhookBase(url);
  setPollMs(POLL_OPTIONS_MS[Number(pollSlider.value)]);
  closeSettings();
  showOnboarding(false);
  subheadEl.textContent = "Loading error feed…";
  startPolling();
});

function updatePollLabel() {
  const ms = POLL_OPTIONS_MS[Number(pollSlider.value)];
  pollValueLabel.textContent = `${ms / 1000}s`;
}
pollSlider.addEventListener("input", updatePollLabel);

/* The client dropdown mirrors the chip row — either one changes the same
   `activeFilter` state, so they always agree with each other. */
function populateClientFilterSelect() {
  const clients = [...new Set(errors.map(e => e.client))].sort();
  const current = clientFilterSelect.value || activeFilter;
  clientFilterSelect.innerHTML = ["All", ...clients]
    .map(c => `<option value="${c}">${c === "All" ? "All clients" : c}</option>`)
    .join("");
  clientFilterSelect.value = clients.includes(current) || current === "All" ? current : "All";
}
clientFilterSelect.addEventListener("change", () => {
  activeFilter = clientFilterSelect.value;
  renderChips();
  renderFeed();
});

enableNotifsBtn.addEventListener("click", enablePushNotifications);

clearCacheBtn.addEventListener("click", async () => {
  const proceed = confirm(
    "This clears saved settings and cached data on this device, including your webhook URL. Continue?"
  );
  if (!proceed) return;

  try {
    localStorage.clear();
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
  } catch (err) {
    console.error("Failed to clear local cache:", err);
  } finally {
    location.reload();
  }
});

/* ==========================================================================
   INIT
   ========================================================================== */

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  fetchErrors();
  pollTimer = setInterval(fetchErrors, getPollMs());
}

function init() {
  renderChips();
  updateNotifStatusText();
  if (!isConfigured()) {
    subheadEl.textContent = "Setup required";
    showOnboarding(true);
    return;
  }
  showOnboarding(false);
  startPolling();
}

init();

/* ==========================================================================
   SERVICE WORKER REGISTRATION
   ========================================================================== */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(err => {
      console.warn("Service worker registration failed:", err);
    });
  });
}
