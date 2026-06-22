import { JSX, useCallback, useEffect, useState } from 'react';
import {
  Download,
  Loader2,
  Puzzle,
  Search,
  Star,
} from 'lucide-react';
import {
  marketDownload,
  marketGetDetail,
  marketListCategories,
  marketListPlugins,
  marketListVersions,
  type MarketCategory,
  type MarketPlugin,
  type MarketPluginDetail,
  type MarketPluginVersion,
} from '../../api/market';
import { Button, Input } from '../../components/ui/controls';
import { cn } from '../../lib/utils';

const PAGE_SIZE = 20;

const SORTS = [
  { id: 'featured', label: '推荐' },
  { id: 'new', label: '最新' },
  { id: 'hot', label: '最热' },
  { id: 'rating', label: '评分' },
] as const;

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/** Plugin icon (URL) with a generic puzzle fallback. */
function PluginIcon({
  url,
  className,
}: {
  url?: string;
  className?: string;
}): JSX.Element {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted',
        className,
      )}
    >
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <Puzzle className="h-1/2 w-1/2 text-muted-foreground" />
      )}
    </div>
  );
}

/** Price label derived from pricing_type / price_text. */
function priceLabel(p: MarketPlugin): string {
  if (p.price_text) return p.price_text;
  if (p.pricing_type == null || p.pricing_type === 1) return '免费';
  return p.price != null ? `${p.currency ?? '¥'}${p.price}` : '付费';
}

/** Rating + download summary line. */
function MetaLine({ p }: { p: MarketPlugin }): JSX.Element {
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      {p.rating_score != null && p.rating_score > 0 && (
        <span className="inline-flex items-center gap-0.5">
          <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
          {p.rating_score.toFixed(1)}
          {p.rating_count ? `（${p.rating_count}）` : ''}
        </span>
      )}
      {p.download_count != null && (
        <span className="inline-flex items-center gap-0.5">
          <Download className="h-3 w-3" />
          {p.download_count}
        </span>
      )}
      <span>{priceLabel(p)}</span>
    </div>
  );
}

/** Right-hand detail panel: description + versions + install. */
function MarketDetail({
  plugin,
  versions,
  installing,
  onInstall,
}: {
  plugin: MarketPluginDetail;
  versions: MarketPluginVersion[];
  installing: boolean;
  onInstall: (versionId?: number) => void;
}): JSX.Element {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-start gap-3 border-b border-border pb-3">
        <PluginIcon url={plugin.icon_url ?? undefined} className="h-12 w-12" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-base font-semibold">{plugin.name}</h3>
            {plugin.latest_version && (
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                v{plugin.latest_version}
              </span>
            )}
          </div>
          {plugin.author_name && (
            <p className="truncate text-xs text-muted-foreground">
              {plugin.author_name}
            </p>
          )}
          <div className="mt-1">
            <MetaLine p={plugin} />
          </div>
        </div>
        <Button
          onClick={() => onInstall(plugin.latest_version_id ?? undefined)}
          disabled={installing}
        >
          {installing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          安装
        </Button>
      </div>

      <div className="scrollbar-thin mt-3 max-h-[24rem] space-y-4 overflow-y-auto pr-1">
        {plugin.summary && (
          <p className="text-sm text-muted-foreground">{plugin.summary}</p>
        )}
        {plugin.description && (
          <div className="whitespace-pre-wrap text-sm leading-relaxed">
            {plugin.description}
          </div>
        )}

        <div>
          <h4 className="mb-1.5 text-sm font-medium">版本</h4>
          {versions.length === 0 ? (
            <p className="text-xs text-muted-foreground">暂无可用版本</p>
          ) : (
            <ul className="space-y-1.5">
              {versions.map((v) => (
                <li
                  key={v.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5"
                >
                  <div className="min-w-0">
                    <span className="text-sm font-medium">v{v.version}</span>
                    {v.changelog && (
                      <span className="ml-2 truncate text-xs text-muted-foreground">
                        {v.changelog}
                      </span>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    disabled={installing}
                    onClick={() => onInstall(v.id)}
                  >
                    安装此版本
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/** Plugin marketplace: browse / search / filter + install from remote. */
export function Market(): JSX.Element {
  const [categories, setCategories] = useState<MarketCategory[]>([]);
  const [keyword, setKeyword] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [sort, setSort] = useState<string>('featured');

  const [plugins, setPlugins] = useState<MarketPlugin[]>([]);
  const [total, setTotal] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<MarketPluginDetail | null>(null);
  const [versions, setVersions] = useState<MarketPluginVersion[]>([]);
  const [installing, setInstalling] = useState(false);
  const [notice, setNotice] = useState('');

  // Load categories once.
  useEffect(() => {
    marketListCategories()
      .then(setCategories)
      .catch(() => setCategories([]));
  }, []);

  // (Re)load the first page whenever a filter changes.
  const loadFirstPage = useCallback(() => {
    setLoading(true);
    setError('');
    marketListPlugins({
      pageNum: 1,
      pageSize: PAGE_SIZE,
      keyword: keyword.trim() || undefined,
      categoryId: categoryId ?? undefined,
      sort,
    })
      .then((res) => {
        setPlugins(res.records ?? []);
        setTotal(res.total ?? 0);
        setPageNum(1);
      })
      .catch((e) => setError(errMsg(e, '加载插件市场失败')))
      .finally(() => setLoading(false));
  }, [keyword, categoryId, sort]);

  useEffect(() => {
    loadFirstPage();
  }, [categoryId, sort]); // keyword 改动由回车/按钮触发，避免每次输入都请求

  const loadMore = () => {
    const next = pageNum + 1;
    setLoading(true);
    marketListPlugins({
      pageNum: next,
      pageSize: PAGE_SIZE,
      keyword: keyword.trim() || undefined,
      categoryId: categoryId ?? undefined,
      sort,
    })
      .then((res) => {
        setPlugins((cur) => [...cur, ...(res.records ?? [])]);
        setPageNum(next);
      })
      .catch((e) => setError(errMsg(e, '加载更多失败')))
      .finally(() => setLoading(false));
  };

  // Load detail + versions when a plugin is selected.
  useEffect(() => {
    if (selectedId == null) {
      setDetail(null);
      setVersions([]);
      return;
    }
    setNotice('');
    Promise.all([marketGetDetail(selectedId), marketListVersions(selectedId)])
      .then(([d, vs]) => {
        setDetail(d);
        setVersions(vs ?? []);
      })
      .catch((e) => setError(errMsg(e, '加载插件详情失败')));
  }, [selectedId]);

  const install = (versionId?: number) => {
    if (selectedId == null) return;
    setInstalling(true);
    setError('');
    setNotice('');
    marketDownload(selectedId, versionId)
      .then((res) => {
        if (!res.package_url) {
          throw new Error('该版本暂无可下载的安装包');
        }
        return window.launcher.installPluginFromUrl(
          res.package_url,
          res.package_sha256 ?? undefined,
        );
      })
      .then((info) => {
        setNotice(`已安装：${info.name}（可在「插件管理」中查看）`);
      })
      .catch((e) => setError(errMsg(e, '安装失败')))
      .finally(() => setInstalling(false));
  };

  const canLoadMore = plugins.length < total;

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">插件市场</h2>
        <p className="text-sm text-muted-foreground">
          浏览并安装来自远程市场的插件。
        </p>
      </div>

      {/* 搜索 + 排序 */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && loadFirstPage()}
            placeholder="搜索插件名称 / 标识 / 简介…"
            className="pl-8"
          />
        </div>
        <div className="flex items-center gap-1">
          {SORTS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSort(s.id)}
              className={cn(
                'rounded-md px-2.5 py-1.5 text-xs transition-colors',
                sort === s.id
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* 分类 chips */}
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setCategoryId(null)}
            className={cn(
              'rounded-full px-2.5 py-1 text-xs transition-colors',
              categoryId == null
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-accent',
            )}
          >
            全部
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategoryId(c.id)}
              className={cn(
                'rounded-full px-2.5 py-1 text-xs transition-colors',
                categoryId === c.id
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent',
              )}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {error && (
        <p className="rounded-md border border-red-600/40 bg-red-600/10 px-3 py-2 text-sm text-red-500">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-md border border-emerald-600/40 bg-emerald-600/10 px-3 py-2 text-sm text-emerald-500">
          {notice}
        </p>
      )}

      <div className="flex items-start gap-3">
        {/* 左：插件列表 */}
        <div className="flex w-64 shrink-0 flex-col gap-2">
          <div className="scrollbar-thin max-h-[28rem] space-y-1 overflow-y-auto pr-1">
            {plugins.length === 0 && !loading ? (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                没有找到插件
              </p>
            ) : (
              plugins.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors',
                    p.id === selectedId
                      ? 'bg-accent'
                      : 'hover:bg-accent/50',
                  )}
                >
                  <PluginIcon url={p.icon_url ?? undefined} className="h-9 w-9" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{p.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {p.summary ?? p.plugin_key}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
          {canLoadMore && (
            <Button
              variant="outline"
              className="w-full"
              disabled={loading}
              onClick={loadMore}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              加载更多（{plugins.length}/{total}）
            </Button>
          )}
        </div>

        {/* 右：详情 */}
        <div className="min-h-[20rem] flex-1 rounded-lg border border-border p-4">
          {detail ? (
            <MarketDetail
              plugin={detail}
              versions={versions}
              installing={installing}
              onInstall={install}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {loading ? '加载中…' : '从左侧选择一个插件查看详情'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
