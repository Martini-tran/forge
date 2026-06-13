import { JSX, useEffect, useRef, useState } from "react";
import { Pin, PinOff } from "lucide-react";
import type { PluginInfo } from "../../shared/PluginInfo";

/**
 * The renderer root for a detached plugin window (`#/plugin/<id>`). It hosts the
 * plugin's UI in the same locked-down <webview> the inline launcher view uses,
 * but fills its own normal, resizable OS window instead of the launcher panel.
 */

/** Read the plugin id from the `#/plugin/<id>` hash route. */
function pluginIdFromHash(): string {
  const m = window.location.hash.match(/^#\/plugin\/([^/?]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

export function PluginWindow(): JSX.Element {
  const id = pluginIdFromHash();
  const [plugin, setPlugin] = useState<PluginInfo | null>(null);
  const [missing, setMissing] = useState(false);
  const [pinned, setPinned] = useState(false);
  const webviewRef = useRef<HTMLElement>(null);

  useEffect(() => {
    window.launcher.listPlugins().then((list) => {
      const p = list.find((x) => x.id === id && x.type === "view");
      if (p) {
        setPlugin(p);
        document.title = p.name;
      } else {
        setMissing(true);
      }
    });
  }, [id]);

  // Reflect the window's actual pin state (set from manifest/last session).
  useEffect(() => {
    window.launcher
      .getPluginWindowState()
      .then((s) => setPinned(s.alwaysOnTop));
  }, []);

  const togglePinned = () => {
    const next = !pinned;
    setPinned(next);
    window.launcher.setPluginWindowAlwaysOnTop(next);
  };

  // Focus the webview once ready so its inputs are immediately usable.
  useEffect(() => {
    if (!plugin) return;
    const wv = webviewRef.current;
    if (!wv) return;
    const onReady = () => wv.focus();
    wv.addEventListener("dom-ready", onReady);
    return () => wv.removeEventListener("dom-ready", onReady);
  }, [plugin]);

  if (missing) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        插件不存在或已被禁用
      </div>
    );
  }

  if (!plugin) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        正在加载…
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        {plugin.icon && (
          <img src={plugin.icon} alt="" className="h-4 w-4 shrink-0" />
        )}
        <span className="text-sm font-medium">{plugin.name}</span>
        <button
          type="button"
          aria-label={pinned ? "取消置顶" : "置于所有应用之上"}
          title={pinned ? "已置顶(点击取消)" : "置于所有应用之上"}
          onClick={togglePinned}
          className={
            "ml-auto flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-accent-foreground " +
            (pinned
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground")
          }
        >
          {pinned ? (
            <Pin className="h-4 w-4" />
          ) : (
            <PinOff className="h-4 w-4" />
          )}
        </button>
      </header>
      <webview
        ref={webviewRef}
        src={`plugin://${plugin.id}/${plugin.ui}`}
        partition={`persist:plugin-${plugin.id}`}
        className="flex-1"
      />
    </div>
  );
}
