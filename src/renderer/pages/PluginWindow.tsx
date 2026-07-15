import { JSX, useEffect, useRef, useState } from "react";
import { Pin, PinOff, RotateCw, X } from "lucide-react";
import type { PluginInfo } from "../../shared/PluginInfo";

/**
 * The renderer root for a detached plugin window (`#/plugin/<id>`). It hosts the
 * plugin's UI in the same locked-down <webview> the inline launcher view uses,
 * but fills its own normal, resizable OS window instead of the launcher panel.
 *
 * A plugin can declare `window.frameless` (+ optional `transparent`) in its
 * manifest to become a lyrics-style floating widget: the OS titlebar and this
 * component's header chrome are both dropped, and a slim drag bar — visible only
 * on hover — provides move/refresh/pin/close, since a `<webview>` guest doesn't
 * respond to `-webkit-app-region` on behalf of its host window.
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
  const [frameless, setFrameless] = useState(false);
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

  // Reflect the window's actual pin + frameless state (from manifest/last session).
  useEffect(() => {
    window.launcher.getPluginWindowState().then((s) => {
      setPinned(s.alwaysOnTop);
      setFrameless(s.frameless);
    });
  }, []);

  const togglePinned = () => {
    const next = !pinned;
    setPinned(next);
    window.launcher.setPluginWindowAlwaysOnTop(next);
  };

  // Reload the webview — for a widget's refresh button, this re-runs its UI so
  // it pulls fresh data immediately (no plugin-specific bridge needed).
  const reload = () => {
    const wv = webviewRef.current as unknown as { reload?: () => void } | null;
    wv?.reload?.();
  };

  const close = () => window.launcher.closePluginWindow();

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

  // Frameless "floating widget": transparent root, no header, a hover-revealed
  // drag bar overlaid on top of the webview with its own window controls.
  if (frameless) {
    return (
      <div className="group relative flex h-screen w-screen flex-col overflow-hidden">
        {/* Slim drag bar: transparent until hover, then a faint backdrop + controls.
            The bar itself is the drag region; the buttons opt back out (no-drag). */}
        <div className="drag-region absolute inset-x-0 top-0 z-10 flex h-6 items-center justify-end gap-0.5 px-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          <button
            type="button"
            aria-label="刷新"
            title="刷新"
            onClick={reload}
            className="no-drag flex h-5 w-5 items-center justify-center rounded text-muted-foreground/80 transition-colors hover:bg-black/20 hover:text-foreground"
          >
            <RotateCw className="h-3 w-3" />
          </button>
          <button
            type="button"
            aria-label={pinned ? "取消置顶" : "置于所有应用之上"}
            title={pinned ? "已置顶(点击取消)" : "置于所有应用之上"}
            onClick={togglePinned}
            className={
              "no-drag flex h-5 w-5 items-center justify-center rounded transition-colors hover:bg-black/20 hover:text-foreground " +
              (pinned ? "text-foreground" : "text-muted-foreground/80")
            }
          >
            {pinned ? <Pin className="h-3 w-3" /> : <PinOff className="h-3 w-3" />}
          </button>
          <button
            type="button"
            aria-label="关闭"
            title="关闭"
            onClick={close}
            className="no-drag flex h-5 w-5 items-center justify-center rounded text-muted-foreground/80 transition-colors hover:bg-red-500/80 hover:text-white"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
        <webview
          ref={webviewRef}
          src={`plugin://${plugin.id}/${plugin.ui}`}
          partition={`persist:plugin-${plugin.id}`}
          className="flex-1"
          style={{ background: "transparent" }}
        />
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
