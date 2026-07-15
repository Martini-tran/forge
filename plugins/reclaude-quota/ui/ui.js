// Reclaude quota widget, styled after reclaude.ai's own quota card.
//
// Flow (per the API's design):
//   1. GET /orgs                       → all orgs the key can see + current_org_id
//   2. GET /carpool/quota?org_id=<id>  → that org's 5-hour carpool usage
//      (orgs without a carpool plan return { enabled:false, state:"not_applicable" })
//
// We show ONE card: the current org if it has a carpool quota, else the first
// org that does. The winning org_id is cached so subsequent refreshes hit a
// single endpoint instead of scanning every org.
//
// Everything goes through window.pluginHost (no Node, no direct network — the
// plugin:// CSP blocks it; the host proxies the fetch through main's net stack).

const el = {
  card: document.getElementById("card"),
  body: document.getElementById("body"),
  err: document.getElementById("err"),
  ico: document.getElementById("ico"),
  orgTitle: document.getElementById("orgTitle"),
  badge: document.getElementById("badge"),
  planRow: document.getElementById("planRow"),
  plan: document.getElementById("plan"),
  used: document.getElementById("used"),
  quota: document.getElementById("quota"),
  fill: document.getElementById("fill"),
  reset: document.getElementById("reset"),
  expire: document.getElementById("expire"),
};

// lucide `users` icon (matches reclaude.ai's carpool card).
el.ico.innerHTML =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>' +
  '<circle cx="9" cy="7" r="4"/>' +
  '<path d="M22 21v-2a4 4 0 0 0-3-3.87"/>' +
  '<path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';

let apiKey = "";
let refreshSec = 60;
let timer = null;
let cachedOrgId = null; // org_id known to have a carpool quota

/* --------------------------------------------------------------- theme */

function applyTheme(theme) {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(theme === "light" ? "light" : "dark");
}
if (window.pluginHost?.getTheme) {
  window.pluginHost.getTheme().then(applyTheme);
  window.pluginHost.onThemeChanged?.(applyTheme);
}

/* -------------------------------------------------------------- format */

function num(v) {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function usd(n) {
  return "$" + n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
function pad2(n) {
  return String(n).padStart(2, "0");
}

/** "2026-08-11 周二" from a ms timestamp. */
function fmtDate(ms) {
  const d = new Date(ms);
  return (
    d.getFullYear() +
    "-" +
    pad2(d.getMonth() + 1) +
    "-" +
    pad2(d.getDate()) +
    " " +
    WEEKDAYS[d.getDay()]
  );
}

/** "2026-07-15 22:40" from a ms timestamp. */
function fmtDateTime(ms) {
  const d = new Date(ms);
  return (
    d.getFullYear() +
    "-" +
    pad2(d.getMonth() + 1) +
    "-" +
    pad2(d.getDate()) +
    " " +
    pad2(d.getHours()) +
    ":" +
    pad2(d.getMinutes())
  );
}

/** "还有 2 时 44 分钟 归零 · 2026-07-15 22:40" */
function resetLine(ms) {
  if (!Number.isFinite(ms)) return "";
  const at = fmtDateTime(ms);
  const diff = ms - Date.now();
  if (diff <= 0) return "已归零 · " + at;
  const totalMin = Math.round(diff / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const left = h > 0 ? `还有 ${h} 时 ${m} 分钟 归零` : `还有 ${m} 分钟 归零`;
  return left + " · " + at;
}

/** Trim the timestamp suffix off org names ("System Carpool 20260507-084900"). */
function orgDisplayName(org) {
  if (!org) return "拼车组织";
  const t = org.type;
  if (t === "team" && /carpool/i.test(org.name || "")) return "拼车组织";
  const name = (org.name || "").replace(/\s*\d{8}-\d{6}\s*$/, "").trim();
  return name || org.account_email || "拼车组织";
}

/* --------------------------------------------------------------- render */

function showError(msg) {
  el.body.classList.add("hidden");
  el.err.classList.remove("hidden");
  el.err.textContent = msg;
}

function showBody() {
  el.err.classList.add("hidden");
  el.body.classList.remove("hidden");
}

function render(org, q) {
  showBody();

  // title + status badge
  el.orgTitle.textContent = orgDisplayName(org);
  const active =
    q.enabled !== false &&
    (q.state ? q.state === "active" : true) &&
    (q.status ? q.status === "active" : true);
  el.badge.textContent = active
    ? "有效"
    : q.enabled === false
      ? "未启用"
      : q.state || q.status || "异常";
  el.badge.className = "badge" + (active ? "" : " bad");

  // plan row — the API exposes no plan code; show seat count if any, else 拼车.
  const seats = org && typeof org.seat_count === "number" ? org.seat_count : 0;
  el.plan.textContent = seats > 0 ? `拼车 · ${seats} 席` : "拼车";

  // amount + bar
  const quota = num(q.quota_usd);
  const used = num(q.used_usd);
  const pct = quota > 0 ? Math.min(100, (used / quota) * 100) : 0;
  el.used.textContent = usd(used);
  el.quota.textContent = usd(quota);
  el.fill.style.width = pct + "%";
  el.fill.className =
    "fill" + (pct >= 90 ? " danger" : pct >= 70 ? " warn" : "");

  // reset countdown
  el.reset.textContent = resetLine(num(q.resets_at_ms));

  // subscription expiry (from the org record)
  const exp = org ? org.subscription_expires_at : null;
  el.expire.textContent = exp == null ? "长期有效" : fmtDate(exp);
}

/* -------------------------------------------------------------- fetch */

const client = window.pluginHost?.createClient
  ? window.pluginHost.createClient({})
  : null;

function authHeaders() {
  return { headers: { Authorization: "Bearer " + apiKey } };
}

// The host's plugin HTTP client returns the full RequestResponse
// ({ config, data, status, ... }) — the response body sits under `.data`.
// Unwrap it, while tolerating a client that already returns the body directly.
function unwrap(res) {
  if (res && typeof res === "object" && "data" in res && "status" in res) {
    return res.data;
  }
  return res;
}

/** GET a carpool quota for one org; null on any failure. */
async function fetchQuota(orgId) {
  try {
    const url =
      orgId != null
        ? "/carpool/quota?org_id=" + encodeURIComponent(orgId)
        : "/carpool/quota";
    const q = unwrap(await client.get(url, authHeaders()));
    return q && typeof q === "object" ? q : null;
  } catch {
    return null;
  }
}

function hasQuota(q) {
  return q && q.enabled !== false && q.state !== "not_applicable";
}

async function refresh() {
  if (!apiKey) {
    showError("未配置 API Key,请在插件设置中填写。");
    return;
  }
  if (!client) {
    showError("插件环境不可用(缺少 pluginHost)。");
    return;
  }

  el.card.classList.add("loading");
  try {
    // 1) all orgs + which one is current
    const orgs = unwrap(await client.get("/orgs", authHeaders()));
    const items = Array.isArray(orgs?.items) ? orgs.items : [];
    if (items.length === 0) throw new Error("未获取到组织列表");

    const byId = (id) => items.find((o) => o.id === id) || null;

    // 2) fast path: reuse the last org known to have a quota
    if (cachedOrgId != null) {
      const q = await fetchQuota(cachedOrgId);
      if (hasQuota(q)) {
        render(byId(cachedOrgId), q);
        return;
      }
      cachedOrgId = null; // stale — fall through to rescan
    }

    // 3) try the current org first, then the rest, and take the first with a quota
    const ordered = [
      ...items.filter((o) => o.id === orgs.current_org_id),
      ...items.filter((o) => o.id !== orgs.current_org_id),
    ];

    // current org first (single request); most keys resolve here
    const current = ordered[0];
    if (current) {
      const q = await fetchQuota(current.id);
      if (hasQuota(q)) {
        cachedOrgId = current.id;
        render(current, q);
        return;
      }
    }

    // scan the remaining orgs in parallel; pick the first (in order) with a quota
    const rest = ordered.slice(1);
    const results = await Promise.all(rest.map((o) => fetchQuota(o.id)));
    for (let i = 0; i < rest.length; i++) {
      if (hasQuota(results[i])) {
        cachedOrgId = rest[i].id;
        render(rest[i], results[i]);
        return;
      }
    }

    // nothing has a carpool quota
    showError("名下没有可用的拼车额度。");
  } catch (e) {
    // The error crosses IPC as a plain Error, so the numeric status only
    // survives inside the message ("...status code 401"). Parse it back out.
    const text = (e && e.message ? e.message : String(e)) || "";
    const m = text.match(/status code (\d{3})/);
    const status = e && e.status ? e.status : m ? Number(m[1]) : 0;
    let msg;
    if (status === 401 || status === 403) {
      msg = "API Key 无效或已过期,请在插件设置中检查。";
    } else if (status) {
      msg = "获取额度失败(HTTP " + status + ")。";
    } else {
      msg = "获取额度失败: " + text;
    }
    showError(msg);
  } finally {
    el.card.classList.remove("loading");
  }
}

/* ------------------------------------------------------------- schedule */

function restartTimer() {
  if (timer) clearInterval(timer);
  const ms = Math.max(10, refreshSec) * 1000;
  timer = setInterval(refresh, ms);
}

function applyConfig(cfg) {
  const nextKey = typeof cfg.apiKey === "string" ? cfg.apiKey.trim() : "";
  const nextSec =
    typeof cfg.refreshSec === "number" && cfg.refreshSec > 0
      ? cfg.refreshSec
      : 60;
  const keyChanged = nextKey !== apiKey;
  const secChanged = nextSec !== refreshSec;
  apiKey = nextKey;
  refreshSec = nextSec;
  if (keyChanged) cachedOrgId = null; // different key → re-resolve the org
  if (secChanged) restartTimer();
  if (keyChanged) refresh();
}

/* ---------------------------------------------------------------- boot */

async function boot() {
  if (window.pluginHost?.getConfig) {
    try {
      applyConfig(await window.pluginHost.getConfig());
    } catch {
      /* fall through with defaults */
    }
    window.pluginHost.onConfigChanged?.(applyConfig);
  }
  restartTimer();
  refresh();
}

boot();
