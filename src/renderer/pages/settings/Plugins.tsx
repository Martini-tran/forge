import { useEffect, useMemo, useState } from 'react';
import {
  ExternalLink,
  PackagePlus,
  Puzzle,
  Search,
  SquarePlus,
  Trash2,
} from 'lucide-react';
import type { PluginInfo } from '../../../shared/PluginInfo';
import type { PluginConfigField } from '../../../shared/PluginManifest';
import type { PluginConfigValues } from '../../../shared/PluginConfig';
import { Button, Input, Switch } from '../../components/ui/controls';
import { cn } from '../../lib/utils';

/** Small pill used for the plugin type tag. */
function Badge({ label }: { label: string }): JSX.Element {
  return (
    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
      {label}
    </span>
  );
}

/** Plugin icon (data URI) with a generic puzzle fallback. */
function PluginIcon({
  icon,
  className,
}: {
  icon?: string;
  className?: string;
}): JSX.Element {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-md bg-muted',
        className,
      )}
    >
      {icon ? (
        <img src={icon} alt="" className="h-2/3 w-2/3" />
      ) : (
        <Puzzle className="h-1/2 w-1/2 text-muted-foreground" />
      )}
    </div>
  );
}

/** Coerce the form's display values into a typed config object for persistence. */
function toTypedConfig(
  schema: PluginConfigField[],
  values: Record<string, string | boolean>,
): PluginConfigValues {
  const out: PluginConfigValues = {};
  for (const f of schema) {
    const v = values[f.key];
    if (f.type === 'number') {
      const n = parseFloat(String(v));
      if (Number.isFinite(n)) out[f.key] = n;
    } else if (f.type === 'boolean') {
      out[f.key] = Boolean(v);
    } else {
      out[f.key] = v == null ? '' : String(v);
    }
  }
  return out;
}

/** Schema-driven config editor for a plugin (string/number/boolean/select). */
function PluginConfigForm({
  plugin,
  onSave,
}: {
  plugin: PluginInfo;
  onSave: (id: string, values: PluginConfigValues) => void;
}): JSX.Element | null {
  const schema = plugin.config ?? [];
  // Display state: text/number held as strings; booleans as booleans.
  const initial = (): Record<string, string | boolean> => {
    const out: Record<string, string | boolean> = {};
    for (const f of schema) {
      const v = plugin.configValues[f.key];
      out[f.key] = f.type === 'boolean' ? Boolean(v) : v == null ? '' : String(v);
    }
    return out;
  };
  const [values, setValues] = useState<Record<string, string | boolean>>(initial);
  // Reset when switching plugins or when the persisted (coerced/clamped) values
  // change. Text/number fields only commit on blur, so this never fires
  // mid-keystroke and clobbers what the user is typing.
  useEffect(() => setValues(initial()), [plugin.id, plugin.configValues]);

  if (schema.length === 0) return null;

  const commit = (next: Record<string, string | boolean>) => {
    onSave(plugin.id, toTypedConfig(schema, next));
  };
  const setField = (key: string, value: string | boolean) =>
    setValues((cur) => ({ ...cur, [key]: value }));

  return (
    <div className="space-y-3 border-t border-border pt-3">
      <label className="text-xs font-medium">插件配置</label>
      {schema.map((f) => (
        <div key={f.key} className="space-y-1">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs">{f.label}</span>
            {f.type === 'boolean' ? (
              <Switch
                checked={Boolean(values[f.key])}
                className={cn(!plugin.enabled && 'pointer-events-none opacity-50')}
                onCheckedChange={(v) => {
                  if (!plugin.enabled) return;
                  const next = { ...values, [f.key]: v };
                  setValues(next);
                  commit(next);
                }}
              />
            ) : f.type === 'select' ? (
              <select
                value={String(values[f.key] ?? '')}
                disabled={!plugin.enabled}
                onChange={(e) => {
                  const next = { ...values, [f.key]: e.target.value };
                  setValues(next);
                  commit(next);
                }}
                className="h-8 w-44 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring disabled:opacity-50"
              >
                {(f.options ?? []).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                type={f.type === 'number' ? 'number' : 'text'}
                value={String(values[f.key] ?? '')}
                min={f.min}
                max={f.max}
                step={f.step}
                placeholder={f.placeholder}
                disabled={!plugin.enabled}
                onChange={(e) => setField(f.key, e.target.value)}
                onBlur={() => commit(values)}
                onKeyDown={(e) =>
                  e.key === 'Enter' && e.currentTarget.blur()
                }
                className="h-8 w-44"
              />
            )}
          </div>
          {f.description && (
            <p className="text-[11px] text-muted-foreground">{f.description}</p>
          )}
        </div>
      ))}
    </div>
  );
}

/** Right-hand detail panel: full info + enable toggle + keyword editor. */
function PluginDetail({
  plugin,
  onToggle,
  onSaveKeywords,
  onSaveConfig,
  onSetOpenInWindow,
  onUninstall,
}: {
  plugin: PluginInfo;
  onToggle: (id: string, enabled: boolean) => void;
  onSaveKeywords: (id: string, keywords: string) => void;
  onSaveConfig: (id: string, values: PluginConfigValues) => void;
  onSetOpenInWindow: (id: string, on: boolean) => void;
  onUninstall: (plugin: PluginInfo) => void;
}): JSX.Element {
  const [kw, setKw] = useState(plugin.userKeywords);
  // Reset the field when switching to a different plugin.
  useEffect(() => setKw(plugin.userKeywords), [plugin.id, plugin.userKeywords]);

  return (
    <div className="flex max-h-[28.5rem] min-w-0 flex-1 flex-col rounded-lg border border-border">
      {/* Fixed intro: icon, name, description, id — never scrolls. */}
      <div className="shrink-0 space-y-3 border-b border-border p-4">
        <div className="flex items-start gap-3">
          <PluginIcon icon={plugin.icon} className="h-10 w-10" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold">
                {plugin.name}
              </span>
              <span className="text-xs text-muted-foreground">
                v{plugin.version}
              </span>
              <Badge label={plugin.source === 'npm' ? 'npm' : '本地'} />
              <Badge label={plugin.type === 'view' ? '视图' : '内联'} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {plugin.description || '暂无描述'}
            </p>
          </div>
          <Switch
            checked={plugin.enabled}
            onCheckedChange={(v) => onToggle(plugin.id, v)}
          />
        </div>

        <div className="flex gap-2 text-xs">
          <span className="w-12 shrink-0 text-muted-foreground">标识</span>
          <code className="truncate rounded bg-muted px-1.5 py-0.5">
            {plugin.id}
          </code>
        </div>
      </div>

      {/* Scrollable config region: keywords, window options, config form. */}
      <div className="scrollbar-thin min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">
        {plugin.type === 'view' ? (
          <div className="space-y-1.5">
            <label className="text-xs font-medium">搜索关键字</label>
            <Input
              value={kw}
              onChange={(e) => setKw(e.target.value)}
              onBlur={() => onSaveKeywords(plugin.id, kw)}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              placeholder="空格分隔,例如:截图 翻译…"
              disabled={!plugin.enabled}
            />
            <p className="text-[11px] text-muted-foreground">
              在启动器中输入这些关键字即可搜索并打开此插件。
            </p>
            <Button
              variant="outline"
              className="mt-1 h-8 gap-1.5"
              disabled={!plugin.enabled}
              onClick={() => window.launcher.detachPlugin(plugin.id)}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              在独立窗口打开
            </Button>

            <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
              <div className="min-w-0">
                <span className="text-xs font-medium">默认在独立窗口打开</span>
                <p className="text-[11px] text-muted-foreground">
                  从启动器打开时直接弹出独立窗口,而不是内嵌在启动器中。
                </p>
              </div>
              <Switch
                checked={plugin.openInWindow}
                className={cn(
                  !plugin.enabled && 'pointer-events-none opacity-50',
                )}
                onCheckedChange={(v) =>
                  plugin.enabled && onSetOpenInWindow(plugin.id, v)
                }
              />
            </div>
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            内联插件的搜索结果由插件自身提供,暂不支持自定义关键字。
          </p>
        )}

        <PluginConfigForm plugin={plugin} onSave={onSaveConfig} />

        {plugin.removable && (
          <div className="border-t border-border pt-3">
            <Button
              variant="destructive"
              className="h-8 gap-1.5"
              onClick={() => onUninstall(plugin)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              卸载插件
            </Button>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              从磁盘移除该插件并清除其设置。此操作不可撤销。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export function Plugins(): JSX.Element {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');
  const [npmSpec, setNpmSpec] = useState('');

  useEffect(() => {
    window.launcher.listPlugins().then((list) => {
      setPlugins(list);
      setSelectedId((cur) => cur ?? list[0]?.id ?? null);
    });
  }, []);

  // Install from a user-picked .orcpkg; select the newly installed plugin.
  const install = () => {
    setError('');
    window.launcher
      .installPlugin()
      .then((info) => {
        if (!info) return; // cancelled
        return window.launcher.listPlugins().then((list) => {
          setPlugins(list);
          setSelectedId(info.id);
        });
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : '安装失败'),
      );
  };

  const installFromNpm = () => {
    const spec = npmSpec.trim();
    if (!spec) {
      setError('请输入 npm 包名');
      return;
    }
    setError('');
    window.launcher
      .installNpmPlugin(spec)
      .then((info) => {
        return window.launcher.listPlugins().then((list) => {
          setPlugins(list);
          setSelectedId(info.id);
          setNpmSpec('');
        });
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : 'npm 安装失败'),
      );
  };

  const uninstall = (plugin: PluginInfo) => {
    if (
      !window.confirm(`确定卸载「${plugin.name}」吗？此操作不可撤销。`)
    ) {
      return;
    }
    setError('');
    window.launcher
      .uninstallPlugin(plugin.id)
      .then(() => window.launcher.listPlugins())
      .then((list) => {
        setPlugins(list);
        setSelectedId((cur) =>
          cur === plugin.id ? (list[0]?.id ?? null) : cur,
        );
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : '卸载失败'),
      );
  };

  // Filter by name, description, and both manifest + user keywords.
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return plugins;
    return plugins.filter((p) =>
      [p.name, p.description ?? '', (p.keywords ?? []).join(' '), p.userKeywords]
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [filter, plugins]);

  const selected = plugins.find((p) => p.id === selectedId) ?? null;

  const toggle = (id: string, enabled: boolean) => {
    window.launcher.setPluginEnabled(id, enabled);
    setPlugins((list) =>
      list.map((p) => (p.id === id ? { ...p, enabled } : p)),
    );
  };

  const saveKeywords = (id: string, keywords: string) => {
    window.launcher.setPluginKeywords(id, keywords);
    setPlugins((list) =>
      list.map((p) => (p.id === id ? { ...p, userKeywords: keywords } : p)),
    );
  };

  const setOpenInWindow = (id: string, on: boolean) => {
    window.launcher.setPluginOpenInWindow(id, on);
    setPlugins((list) =>
      list.map((p) => (p.id === id ? { ...p, openInWindow: on } : p)),
    );
  };

  const saveConfig = (id: string, values: PluginConfigValues) => {
    // Persist and adopt the resolved (coerced/clamped) values main returns.
    window.launcher.setPluginConfig(id, values).then((resolved) => {
      setPlugins((list) =>
        list.map((p) => (p.id === id ? { ...p, configValues: resolved } : p)),
      );
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">插件管理</h2>
          <p className="text-xs text-muted-foreground">
            已安装的插件。点击左侧插件查看信息、启用/禁用并设置搜索关键字，或安装/卸载插件包（
            <code className="rounded bg-muted px-1">.orcpkg</code>）。
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="outline"
            className="h-8 gap-1.5"
            onClick={install}
          >
            <PackagePlus className="h-3.5 w-3.5" />
            安装包…
          </Button>
          <Button
            variant="outline"
            className="h-8 gap-1.5"
            onClick={installFromNpm}
          >
            <SquarePlus className="h-3.5 w-3.5" />
            安装 npm
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Input
          value={npmSpec}
          onChange={(e) => setNpmSpec(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && installFromNpm()}
          placeholder="npm 包名，例如 rubick-system-feature 或 @scope/plugin"
          className="h-8 max-w-md"
        />
      </div>

      {error && (
        <p className="rounded-md border border-red-600/40 bg-red-600/10 px-3 py-2 text-xs text-red-600">
          {error}
        </p>
      )}

      {plugins.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-12 text-muted-foreground">
          <Puzzle className="h-6 w-6" />
          <p className="text-sm">未发现插件</p>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          {/* Left: searchable plugin list, each entry a selectable button. */}
          <div className="flex w-52 shrink-0 flex-col gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="搜索插件…"
                className="h-8 pl-8"
              />
            </div>
            <div className="scrollbar-thin max-h-[26rem] space-y-1 overflow-y-auto overscroll-contain rounded-lg border border-border p-1.5">
              {filtered.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors',
                    p.id === selectedId
                      ? 'bg-accent text-accent-foreground'
                      : 'hover:bg-accent/50',
                  )}
                >
                  <PluginIcon icon={p.icon} className="h-7 w-7" />
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate text-sm',
                      !p.enabled && 'text-muted-foreground line-through',
                    )}
                  >
                    {p.name}
                  </span>
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  没有匹配的插件
                </p>
              )}
            </div>
          </div>

          {/* Right: details for the selected plugin. */}
          {selected && (
            <PluginDetail
              plugin={selected}
              onToggle={toggle}
              onSaveKeywords={saveKeywords}
              onSaveConfig={saveConfig}
              onSetOpenInWindow={setOpenInWindow}
              onUninstall={uninstall}
            />
          )}
        </div>
      )}
    </div>
  );
}
