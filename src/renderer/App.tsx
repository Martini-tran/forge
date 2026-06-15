import {JSX, useCallback, useEffect, useMemo, useRef, useState} from "react";
import { ArrowLeft, ExternalLink, Settings } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./components/ui/command";
import { SearchEngine } from "../core/search/SearchEngine";
import type { AppEntry } from "../shared/AppEntry";
import type { SearchResult } from "../shared/SearchResult";
import type { PluginInfo } from "../shared/PluginInfo";

/**
 * Launcher UI. Empty query → a responsive grid of recently used apps; typing
 * → a fuzzy-filtered vertical list. Enter (or click) launches the app.
 */
export function App(): JSX.Element {
  const [apps, setApps] = useState<AppEntry[]>([]);
  const [recents, setRecents] = useState<AppEntry[]>([]);
  const [query, setQuery] = useState("");
  const [pluginResults, setPluginResults] = useState<SearchResult[]>([]);
  const [viewPlugins, setViewPlugins] = useState<PluginInfo[]>([]);
  const [activePlugin, setActivePlugin] = useState<PluginInfo | null>(null);
  const [pinyinEnabled, setPinyinEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const webviewRef = useRef<HTMLElement>(null);
  const engine = useMemo(() => new SearchEngine(), []);

  // Focus the plugin webview once it's ready so its search field is usable.
  useEffect(() => {
    if (!activePlugin) return;
    const wv = webviewRef.current;
    if (!wv) return;
    const onReady = () => wv.focus();
    wv.addEventListener("dom-ready", onReady);
    return () => wv.removeEventListener("dom-ready", onReady);
  }, [activePlugin]);

  // Enter a view plugin. When it's set to open in its own window by default,
  // pop the detached window and dismiss the launcher instead of going inline.
  const enterPlugin = useCallback((p: PluginInfo) => {
    if (p.openInWindow) {
      window.launcher.detachPlugin(p.id); // records usage + opens the window
      window.launcher.hide();
      return;
    }
    window.launcher.usePlugin(p.id); // bump recency so it shows in "最近使用"
    setActivePlugin(p);
    window.launcher.setMode("plugin");
  }, []);
  const exitPlugin = useCallback(() => {
    setActivePlugin(null);
    window.launcher.setMode("root");
  }, []);
  // Pop the current plugin out into its own window, then return to the root.
  const detachPlugin = useCallback(
    (p: PluginInfo) => {
      window.launcher.detachPlugin(p.id);
      exitPlugin();
    },
    [exitPlugin],
  );

  // Keep the window height matched to the rendered content (Spotlight-style),
  // so there's no transparent dead-zone below the panel and it grows/shrinks
  // as results change.
  useEffect(() => {
    if (activePlugin) return; // plugin mode uses a fixed window size
    const el = panelRef.current;
    if (!el) return;
    const report = () => window.launcher.resize(el.offsetHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [activePlugin]);

  const loadRecents = useCallback(() => {
    window.launcher.listRecents().then(setRecents);
  }, []);

  // Load the enabled view plugins (shown as entries in the root list).
  const loadViewPlugins = useCallback(() => {
    window.launcher.listPlugins().then((list) => {
      setViewPlugins(list.filter((p) => p.enabled && p.type === "view"));
    });
  }, []);
  useEffect(() => loadViewPlugins(), [loadViewPlugins]);

  // A plugin UI requested back/close → return to the root view.
  useEffect(() => {
    return window.launcher.onPluginExit(() => {
      setActivePlugin(null);
      window.launcher.setMode("root");
    });
  }, []);

  // Track the pinyin-search toggle (live, via the settings broadcast).
  useEffect(() => {
    window.launcher.getSettings().then((s) => setPinyinEnabled(s.pinyinSearch));
    return window.launcher.onSettingsChanged((s) =>
      setPinyinEnabled(s.pinyinSearch),
    );
  }, []);

  // Load the app list once, and keep it fresh from background rescans.
  useEffect(() => {
    window.launcher.listApps().then((list) => {
      setApps(list);
      setLoading(false);
    });
    loadRecents();
    return window.launcher.onAppsUpdated(setApps);
  }, [loadRecents]);

  // Reset to the root view each time the window appears.
  useEffect(() => {
    return window.launcher.onShown(() => {
      setQuery("");
      setActivePlugin(null);
      loadRecents();
      loadViewPlugins();
      inputRef.current?.focus();
    });
  }, [loadRecents, loadViewPlugins]);

  // Escape: leave a plugin back to root if inside one, else hide the launcher.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (activePlugin) exitPlugin();
      else window.launcher.hide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activePlugin, exitPlugin]);

  // Query plugins (main-process side) on a short debounce. A request id guards
  // against out-of-order IPC replies clobbering results for a newer query.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setPluginResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      window.launcher.searchPlugins(q).then((res) => {
        if (!cancelled) setPluginResults(res);
      });
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  const searching = query.trim().length > 0;

  const results = useMemo(
    () => engine.search(query, apps, { usePinyin: pinyinEnabled }).slice(0, 50),
    [engine, query, apps, pinyinEnabled],
  );

  // View plugins matched by the same fuzzy engine as apps (name + keywords).
  const matchedPlugins = useMemo(() => {
    if (!query.trim()) return [];
    const items = viewPlugins.map((p) => ({
      plugin: p,
      name: p.name,
      // Manifest keywords + the user's custom keywords from settings.
      keywords: [...(p.keywords ?? []), p.userKeywords].filter(Boolean).join(" "),
      pinyin: p.pinyin ?? "",
    }));
    return engine
      .search(query, items, { usePinyin: pinyinEnabled })
      .map((i) => i.plugin);
  }, [engine, viewPlugins, query, pinyinEnabled]);

  // Default view: recently used apps, falling back to all apps on first run.
  const defaultItems = recents.length > 0 ? recents : apps.slice(0, 18);
  const defaultHeading = recents.length > 0 ? "最近使用" : "全部应用";

  const launch = (id: string) => window.launcher.launchApp(id);

  // Both the default and search views use the same icon+name grid.
  //  • Searching: matched plugins lead by relevance, then matched apps.
  //  • Default view: items are whatever was actually used recently (apps,
  //    custom entries, and opened plugins), already ranked by recency — so
  //    nothing is pinned to the front just for existing. View plugins are only
  //    surfaced up-front on a fresh profile (no recents yet) for discoverability.
  const gridItems = searching
    ? [
        ...matchedPlugins.map((p) => ({
          key: `view:${p.id}`,
          name: p.name,
          icon: p.icon,
          onSelect: () => enterPlugin(p),
        })),
        ...results.map((a) => ({
          key: a.id,
          name: a.name,
          icon: a.icon,
          onSelect: () => launch(a.id),
        })),
      ]
    : [
        ...(recents.length === 0
          ? viewPlugins.map((p) => ({
              key: `view:${p.id}`,
              name: p.name,
              icon: p.icon,
              onSelect: () => enterPlugin(p),
            }))
          : []),
        ...defaultItems.map((a) => ({
          key: a.id,
          name: a.name,
          icon: a.icon,
          onSelect:
            a.source === "plugin"
              ? () => {
                  const p = viewPlugins.find((vp) => vp.id === a.id);
                  if (p) enterPlugin(p);
                }
              : () => launch(a.id),
        })),
      ];

  // Inside a view plugin: render its sandboxed UI in a webview host.
  if (activePlugin) {
    return (
      <div
        ref={panelRef}
        className="flex h-[520px] w-full flex-col overflow-hidden rounded-xl border border-border bg-popover"
      >
        <header className="drag-region flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
          <button
            type="button"
            aria-label="返回"
            onClick={exitPlugin}
            className="no-drag flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          {activePlugin.icon && (
            <img src={activePlugin.icon} alt="" className="h-4 w-4 shrink-0" />
          )}
          <span className="text-sm font-medium">{activePlugin.name}</span>
          <button
            type="button"
            aria-label="分离为独立窗口"
            title="分离为独立窗口"
            onClick={() => detachPlugin(activePlugin)}
            className="no-drag ml-auto flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <ExternalLink className="h-4 w-4" />
          </button>
        </header>
        <webview
          key={activePlugin.id}
          ref={webviewRef}
          src={`plugin://${activePlugin.id}/${activePlugin.ui}`}
          partition={`persist:plugin-${activePlugin.id}`}
          className="flex-1"
        />
      </div>
    );
  }

  return (
    <Command
      ref={panelRef}
      shouldFilter={false}
      className="w-full rounded-xl border border-border bg-popover"
    >
      <CommandInput
        ref={inputRef}
        value={query}
        onValueChange={setQuery}
        placeholder="搜索应用…"
        autoFocus
        onKeyDown={(e) => {
          // Left/Right navigate the result grid (prev/next) instead of moving
          // the text cursor; Up/Down already move selection via cmdk.
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            const navKey = e.key === "ArrowRight" ? "ArrowDown" : "ArrowUp";
            e.currentTarget.dispatchEvent(
              new KeyboardEvent("keydown", { key: navKey, bubbles: true }),
            );
          }
        }}
        trailing={
          <button
            type="button"
            aria-label="设置"
            onClick={() => window.launcher.openSettings()}
            className="no-drag ml-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <Settings className="h-4 w-4" />
          </button>
        }
      />
      <CommandList className="max-h-[360px]">
        <CommandEmpty>
          {loading ? "正在扫描应用…" : "没有匹配的应用"}
        </CommandEmpty>

        {/* Unified responsive grid: plugins + apps, same look in both views. */}
        {gridItems.length > 0 && (
          <CommandGroup
            heading={searching ? undefined : defaultHeading}
            className="[&_[cmdk-group-items]]:grid [&_[cmdk-group-items]]:grid-cols-[repeat(auto-fill,minmax(4.75rem,1fr))] [&_[cmdk-group-items]]:gap-1"
          >
            {gridItems.map((item) => (
              <CommandItem
                key={item.key}
                value={item.key}
                onSelect={item.onSelect}
                className="flex-col gap-2 rounded-lg px-1 py-3"
              >
                {item.icon ? (
                  <img src={item.icon} alt="" className="h-9 w-9 shrink-0" />
                ) : (
                  <div className="h-9 w-9 shrink-0 rounded bg-muted" />
                )}
                <span className="w-full truncate text-center text-xs text-muted-foreground">
                  {item.name}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Inline plugin-contributed results (coexist; rendered as a list). */}
        {searching && pluginResults.length > 0 && (
          <CommandGroup heading="插件结果">
            {pluginResults.map((r) => (
              <CommandItem
                key={`${r.pluginId}:${r.action ?? r.title}`}
                value={`plugin:${r.pluginId}:${r.action ?? r.title}`}
                onSelect={() =>
                  window.launcher.executePlugin(
                    r.pluginId ?? "",
                    r.action ?? "",
                  )
                }
              >
                {r.icon ? (
                  <img src={r.icon} alt="" className="h-5 w-5 shrink-0" />
                ) : (
                  <div className="h-5 w-5 shrink-0 rounded bg-muted" />
                )}
                <span className="truncate">{r.title}</span>
                {r.subtitle && (
                  <span className="ml-auto shrink-0 truncate pl-2 text-xs text-muted-foreground">
                    {r.subtitle}
                  </span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  );
}
