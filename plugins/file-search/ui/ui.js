// File-search view UI. Talks to the plugin's main-side rpc methods only through
// window.pluginHost (no Node, no process spawning, no network — see plugin:// CSP).
// es.exe is driven entirely in the main process; this UI just renders results and
// routes the three open actions (open / reveal / copy path).

const input = document.getElementById("q");
const list = document.getElementById("list");
const toastEl = document.getElementById("toast");

let rows = [];
let sel = 0;
let lastQuery = "";
let reqSeq = 0; // guards against out-of-order async search responses

// ---- theme: follow the app's light/dark, pushed over the bridge ----
function applyTheme(theme) {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(theme === "light" ? "light" : "dark");
}
if (window.pluginHost?.getTheme) {
  window.pluginHost.getTheme().then(applyTheme);
  window.pluginHost.onThemeChanged?.(applyTheme);
}

// ---- helpers ----
function fmtTime(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
    d.getHours(),
  )}:${p(d.getMinutes())}`;
}

let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1200);
}

// Friendly guidance for the main-side error codes (see index.js classifyEsError).
const ERR = {
  "no-es": {
    title: "未找到 es.exe",
    body: "请把 Everything 的命令行客户端 <b>es.exe</b> 放到本插件的 <b>bin/</b> 目录，或在「插件管理 → 文件搜索」配置里填写 es.exe 路径。",
  },
  "not-running": {
    title: "Everything 未运行",
    body: "把 <b>Everything.exe</b> 放到本插件 <b>bin/</b> 目录（插件会自动后台启动它），或手动运行 Everything 后重试。",
  },
  timeout: { title: "查询超时", body: "Everything 响应过慢，请稍后重试。" },
  error: { title: "搜索出错", body: "调用 es.exe 失败，请检查配置。" },
};

function showEmpty(html, isErr) {
  list.innerHTML = "";
  rows = [];
  const li = document.createElement("li");
  li.className = "empty" + (isErr ? " err" : "");
  li.innerHTML = html;
  list.append(li);
}

function showError(code) {
  const e = ERR[code] || ERR.error;
  showEmpty(`<b>${e.title}</b><br />${e.body}`, true);
}

// ---- render ----
function render() {
  list.innerHTML = "";
  if (rows.length === 0) {
    showEmpty("没有匹配的文件");
    return;
  }
  rows.forEach((r, i) => {
    const li = document.createElement("li");
    li.className = "row" + (i === sel ? " sel" : "");

    const icon = document.createElement("div");
    icon.className = "icon";
    icon.textContent = r.isDir ? "📁" : "📄";

    const main = document.createElement("div");
    main.className = "main";
    const t = document.createElement("div");
    t.className = "title";
    t.textContent = r.name;
    const s = document.createElement("div");
    s.className = "sub";
    s.textContent = r.dir;
    main.append(t, s);

    const meta = document.createElement("div");
    meta.className = "meta";
    const bits = [];
    if (r.size) bits.push(r.size);
    if (r.mtime) bits.push(fmtTime(r.mtime));
    meta.textContent = bits.join("  ·  ");

    const acts = document.createElement("div");
    acts.className = "acts";
    const folderBtn = document.createElement("button");
    folderBtn.className = "act";
    folderBtn.textContent = "文件夹";
    folderBtn.title = "在资源管理器中定位 (Ctrl+Enter)";
    folderBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      reveal(r);
    });
    const copyBtn = document.createElement("button");
    copyBtn.className = "act";
    copyBtn.textContent = "复制";
    copyBtn.title = "复制完整路径 (Ctrl+C)";
    copyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      copyPath(r);
    });
    acts.append(folderBtn, copyBtn);

    li.append(icon, main, meta, acts);
    li.addEventListener("click", () => {
      sel = i;
      render();
    });
    li.addEventListener("dblclick", () => open(r));
    list.append(li);
  });
}

function scrollToSelection() {
  const el = list.children[sel];
  if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
}

// ---- actions ----
function open(r) {
  if (!r) return;
  window.pluginHost.invoke("open", { path: r.path });
  window.pluginHost.close();
}
function reveal(r) {
  if (!r) return;
  window.pluginHost.invoke("reveal", { path: r.path });
  window.pluginHost.close();
}
async function copyPath(r) {
  if (!r) return;
  await window.pluginHost.invoke("copyPath", { path: r.path });
  toast("已复制路径");
}

// ---- search ----
async function refresh() {
  const query = input.value.trim();
  lastQuery = query;
  if (!query) {
    await showIdle();
    return;
  }
  const seq = ++reqSeq;
  const res = await window.pluginHost.invoke("search", { query });
  if (seq !== reqSeq) return; // a newer query already superseded this one
  if (res && res.error) {
    showError(res.error);
    return;
  }
  rows = res && Array.isArray(res.items) ? res.items : [];
  sel = 0;
  render();
}

// Idle (empty query): proactively probe es/Everything so setup issues are
// visible before the user even types. When Everything is auto-starting, show a
// transient hint and re-probe until it's up.
let idleTimer;
async function showIdle() {
  clearTimeout(idleTimer);
  try {
    const st = await window.pluginHost.invoke("status");
    if (lastQuery) return; // user started typing while we probed
    if (st && st.ok) {
      showEmpty("输入关键字开始搜索本地文件");
    } else if (st && st.error === "starting") {
      showEmpty("正在启动 Everything，请稍候…");
      idleTimer = setTimeout(() => {
        if (!lastQuery) showIdle();
      }, 1500);
    } else {
      showError(st && st.error ? st.error : "error");
    }
  } catch {
    if (!lastQuery) showEmpty("输入关键字开始搜索本地文件");
  }
}

let debounce;
input.addEventListener("input", () => {
  clearTimeout(debounce);
  debounce = setTimeout(refresh, 120);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    window.pluginHost.back();
    return;
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    sel = Math.min(sel + 1, rows.length - 1);
    render();
    scrollToSelection();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    sel = Math.max(sel - 1, 0);
    render();
    scrollToSelection();
  } else if (e.key === "Enter") {
    e.preventDefault();
    const r = rows[sel];
    if (!r) return;
    if (e.ctrlKey) reveal(r);
    else open(r);
  } else if (e.key === "c" && e.ctrlKey) {
    // Only hijack Ctrl+C for path-copy when the user isn't copying selected text.
    const hasSelection = (window.getSelection?.().toString() || "").length > 0;
    if (!hasSelection && rows[sel]) {
      e.preventDefault();
      copyPath(rows[sel]);
    }
  }
});

input.focus();
showIdle();
