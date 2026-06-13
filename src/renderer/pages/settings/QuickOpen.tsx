import { useEffect, useMemo, useState } from "react";
import {
  Pencil,
  Trash2,
  Plus,
  FolderOpen,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import type { AppEntry, CustomApp } from "../../../shared/AppEntry";
import { Button, Input } from "../../components/ui/controls";
import { cn } from "../../lib/utils";

type Draft = {
  id: string | null; // null = adding; otherwise editing
  name: string;
  kind: "path" | "url";
  target: string;
  keywords: string;
  createdAt: number;
};

const EMPTY_DRAFT: Draft = {
  id: null,
  name: "",
  kind: "path",
  target: "",
  keywords: "",
  createdAt: 0,
};

function Badge({ label }: { label: string }): JSX.Element {
  return (
    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
      {label}
    </span>
  );
}

/** One scanned-app row with an inline alias-keywords editor + hide/restore. */
function AliasRow({
  app,
  onChanged,
}: {
  app: AppEntry;
  onChanged: () => void;
}): JSX.Element {
  const [kw, setKw] = useState(app.keywords ?? "");
  const save = () => window.launcher.setAlias(app.id, kw);
  const toggleHidden = async () => {
    await window.launcher.hideScanned(app.id, !app.hidden);
    onChanged();
  };
  return (
    <div
      className={cn(
        "flex items-center gap-3 py-1.5",
        app.hidden && "opacity-40",
      )}
    >
      {app.icon ? (
        <img src={app.icon} alt="" className="h-5 w-5 shrink-0" />
      ) : (
        <div className="h-5 w-5 shrink-0 rounded bg-muted" />
      )}
      <span className="w-40 truncate text-sm">{app.name}</span>
      <Badge label="扫描" />
      <Input
        value={kw}
        onChange={(e) => setKw(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        placeholder="添加搜索关键字(空格分隔)…"
        className="ml-auto max-w-xs"
        disabled={app.hidden}
      />
      <button
        type="button"
        aria-label={app.hidden ? "恢复到搜索" : "从搜索中删除"}
        onClick={toggleHidden}
        className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      >
        {app.hidden ? (
          <RotateCcw className="h-4 w-4" />
        ) : (
          <Trash2 className="h-4 w-4" />
        )}
      </button>
    </div>
  );
}

export function QuickOpen(): JSX.Element {
  const [customs, setCustoms] = useState<CustomApp[]>([]);
  const [scanned, setScanned] = useState<AppEntry[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [filter, setFilter] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");

  const loadCustoms = () => window.launcher.listCustom().then(setCustoms);
  const loadScanned = () => window.launcher.listScanned().then(setScanned);
  useEffect(() => {
    loadCustoms();
    loadScanned();
  }, []);

  const sync = async () => {
    setSyncing(true);
    setSyncMsg("");
    try {
      const { removedCustom } = await window.launcher.syncQuickOpen();
      await loadCustoms();
      await loadScanned();
      setSyncMsg(
        removedCustom > 0
          ? `已同步,移除 ${removedCustom} 个失效条目`
          : "已同步,应用列表已更新",
      );
    } finally {
      setSyncing(false);
    }
  };

  const filteredScanned = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q
      ? scanned.filter((a) => a.name.toLowerCase().includes(q))
      : scanned;
  }, [filter, scanned]);

  const editing = draft.id !== null;
  const canSave = draft.name.trim() !== "" && draft.target.trim() !== "";

  const save = async () => {
    if (!canSave) return;
    const payload = {
      name: draft.name.trim(),
      kind: draft.kind,
      target: draft.target.trim(),
      keywords: draft.keywords.trim(),
      icon: "",
    };
    if (draft.id) {
      await window.launcher.updateCustom({
        ...payload,
        id: draft.id,
        createdAt: draft.createdAt,
      });
    } else {
      await window.launcher.addCustom(payload);
    }
    setDraft(EMPTY_DRAFT);
    loadCustoms();
  };

  const edit = (c: CustomApp) =>
    setDraft({
      id: c.id,
      name: c.name,
      kind: c.kind,
      target: c.target,
      keywords: c.keywords,
      createdAt: c.createdAt,
    });

  const remove = async (id: string) => {
    await window.launcher.deleteCustom(id);
    if (draft.id === id) setDraft(EMPTY_DRAFT);
    loadCustoms();
  };

  const browse = async () => {
    const p = await window.launcher.pickPath();
    if (p) {
      setDraft((d) => ({
        ...d,
        target: p,
        name: d.name || p.replace(/\\/g, "/").split("/").pop() || "",
      }));
    }
  };

  return (
    <div className="max-w-2xl space-y-8">
      {/* ---- Add / edit form ---- */}
      <section className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">
              {editing ? "编辑自定义条目" : "添加自定义条目"}
            </h2>
            <p className="text-xs text-muted-foreground">
              手动添加扫描不到的应用、文件、文件夹或网址,并可设置搜索关键字。
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Button variant="outline" onClick={sync} disabled={syncing}>
              <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
              同步
            </Button>
            {syncMsg && (
              <span className="text-[11px] text-muted-foreground">
                {syncMsg}
              </span>
            )}
          </div>
        </div>

        <div className="space-y-2 rounded-lg border border-border p-3">
          <div className="flex gap-2">
            <Input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="名称"
              className="flex-1"
            />
            <div className="flex overflow-hidden rounded-md border border-border">
              {(["path", "url"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setDraft({ ...draft, kind: k })}
                  className={cn(
                    "px-3 text-sm transition-colors",
                    draft.kind === k
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  {k === "path" ? "路径" : "网址"}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <Input
              value={draft.target}
              onChange={(e) => setDraft({ ...draft, target: e.target.value })}
              placeholder={
                draft.kind === "url" ? "https://…" : "C:\\…\\app.exe"
              }
              className="flex-1"
            />
            {draft.kind === "path" && (
              <Button variant="outline" onClick={browse}>
                <FolderOpen className="h-4 w-4" />
                浏览
              </Button>
            )}
          </div>

          <Input
            value={draft.keywords}
            onChange={(e) => setDraft({ ...draft, keywords: e.target.value })}
            placeholder="搜索关键字(空格分隔,可选)"
          />

          <div className="flex gap-2 pt-1">
            <Button onClick={save} disabled={!canSave}>
              {editing ? (
                "保存"
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  添加
                </>
              )}
            </Button>
            {editing && (
              <Button variant="ghost" onClick={() => setDraft(EMPTY_DRAFT)}>
                取消
              </Button>
            )}
          </div>
        </div>

        {/* ---- Custom list ---- */}
        {customs.length > 0 && (
          <div className="divide-y divide-border rounded-lg border border-border">
            {customs.map((c) => (
              <div key={c.id} className="flex items-center gap-3 px-3 py-2">
                <span className="w-40 truncate text-sm font-medium">
                  {c.name}
                </span>
                <Badge label={c.kind === "url" ? "网址" : "路径"} />
                <span className="flex-1 truncate text-xs text-muted-foreground">
                  {c.target}
                </span>
                <button
                  type="button"
                  aria-label="编辑"
                  onClick={() => edit(c)}
                  className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="删除"
                  onClick={() => remove(c.id)}
                  className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-red-500"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---- Scanned apps + alias editor ---- */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">已扫描应用</h2>
          <p className="text-xs text-muted-foreground">
            系统扫描到的应用(与自定义条目区分),可为其添加额外的搜索关键字。
          </p>
        </div>
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="筛选应用…"
          className="max-w-xs"
        />
        <div className="scrollbar-thin max-h-96 divide-y divide-border overflow-y-auto rounded-lg border border-border px-3">
          {filteredScanned.map((a) => (
            <AliasRow key={a.id} app={a} onChanged={loadScanned} />
          ))}
          {filteredScanned.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              没有匹配的应用
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
