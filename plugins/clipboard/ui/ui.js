// Clipboard-history view UI. Talks to the plugin's main-side rpc methods only
// through window.pluginHost (no Node, no network — see the plugin:// CSP).

const input = document.getElementById("q");
const list = document.getElementById("list");

let rows = [];
let sel = 0;

// Follow the app theme: toggle the light/dark class on <html> so the CSS
// variables in index.html resolve to the matching palette.
function applyTheme(theme) {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(theme === "light" ? "light" : "dark");
}

if (window.pluginHost?.getTheme) {
  window.pluginHost.getTheme().then(applyTheme);
  window.pluginHost.onThemeChanged?.(applyTheme);
}

function render() {
  list.innerHTML = "";
  if (rows.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "没有匹配的记录";
    list.append(li);
    return;
  }
  rows.forEach((r, i) => {
    const li = document.createElement("li");
    li.className = "row" + (i === sel ? " sel" : "");
    const t = document.createElement("div");
    t.className = "title";
    t.textContent = r.preview;
    const s = document.createElement("div");
    s.className = "sub";
    s.textContent = r.subtitle;
    li.append(t, s);
    li.addEventListener("click", () => choose(r.id));
    list.append(li);
  });
}

async function refresh() {
  const res = await window.pluginHost.invoke("list", { query: input.value });
  rows = Array.isArray(res) ? res : [];
  if (sel >= rows.length) sel = Math.max(0, rows.length - 1);
  render();
}

async function choose(id) {
  await window.pluginHost.invoke("copy", { id });
  window.pluginHost.close();
}

function scrollToSelection() {
  const el = list.children[sel];
  if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
}

let debounce;
input.addEventListener("input", () => {
  clearTimeout(debounce);
  debounce = setTimeout(refresh, 80);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    window.pluginHost.back();
  } else if (e.key === "ArrowDown") {
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
    const r = rows[sel];
    if (r) choose(r.id);
  }
});

input.focus();
refresh();
