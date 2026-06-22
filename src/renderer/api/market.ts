/**
 * 插件市场 API 客户端：对接 nebula 后端的插件商城公开接口。
 * 基于 requestClient（自动注入 token、解包后端 R 的 data 字段）。
 *
 * 路径前缀：forge 服务的 context-path 为 `/forge`，网关按 `/forge/**` 路由且不
 * StripPrefix，故请求路径需写成 `/forge/front/...`（baseURL 指向网关地址）。
 *
 * 字段命名：forge 启用 Jackson SNAKE_CASE，响应体为下划线命名，因此下面的响应
 * 类型字段一律用下划线；查询参数走 @ModelAttribute 绑定，使用驼峰。
 *
 * 本轮仅覆盖匿名可用的「浏览 / 详情 / 版本 / 分类 / 下载」；收藏、评价、我的插件
 * 等需登录的接口后端已就绪，待前端接入登录后再补。
 */
import { requestClient } from './request';

const BASE = '/forge/front';

/** 统一分页返回（对应后端 PageResult）。 */
export interface PageResult<T> {
  records: T[];
  total: number;
  current: number;
  size: number;
  pages: number;
}

/** 插件概要（对应后端 ForgePluginFrontVO，响应为下划线命名）。 */
export interface MarketPlugin {
  id: number;
  plugin_key: string;
  name: string;
  summary?: string | null;
  type?: string | null;
  icon_file_id?: number | null;
  icon_url?: string | null;
  cover_file_id?: number | null;
  cover_url?: string | null;
  author_name?: string | null;
  pricing_type?: number | null;
  price?: number | null;
  original_price?: number | null;
  currency?: string | null;
  price_text?: string | null;
  latest_version?: string | null;
  download_count?: number | null;
  rating_score?: number | null;
  rating_count?: number | null;
  is_featured?: number | null;
  category_names?: string[] | null;
}

/** 插件详情（对应后端 ForgePluginDetailFrontVO，继承概要字段）。 */
export interface MarketPluginDetail extends MarketPlugin {
  description?: string | null;
  keywords?: string | null;
  homepage_url?: string | null;
  repo_url?: string | null;
  license?: string | null;
  purchase_url?: string | null;
  latest_version_id?: number | null;
  install_count?: number | null;
  favorite_count?: number | null;
  create_time?: string | null;
  update_time?: string | null;
  category_ids?: number[] | null;
}

/** 插件版本（对应后端 ForgePluginVersionFrontVO）。 */
export interface MarketPluginVersion {
  id: number;
  plugin_id: number;
  version: string;
  channel?: string | null;
  manifest_json?: string | null;
  package_file_id?: number | null;
  package_url?: string | null;
  package_sha256?: string | null;
  package_size?: number | null;
  signature?: string | null;
  min_app_version?: string | null;
  max_app_version?: string | null;
  changelog?: string | null;
  download_count?: number | null;
  published_time?: string | null;
}

/** 插件分类（对应后端 ForgePluginCategoryFrontVO）。 */
export interface MarketCategory {
  id: number;
  code?: string | null;
  name: string;
  description?: string | null;
  icon_file_id?: number | null;
  icon_url?: string | null;
  sort_order?: number | null;
}

/** 下载结果（对应后端 ForgePluginDownloadResultVO）。 */
export interface MarketDownloadResult {
  plugin_id: number;
  version_id: number;
  version: string;
  package_file_id?: number | null;
  package_url?: string | null;
  package_sha256?: string | null;
  package_size?: number | null;
  signature?: string | null;
}

/** 市场列表查询参数（驼峰，对应后端 @ModelAttribute 绑定）。 */
export interface MarketPluginQuery {
  pageNum?: number;
  pageSize?: number;
  keyword?: string;
  categoryId?: number;
  type?: string;
  pricingType?: number;
  /** featured(默认) / new / hot / rating */
  sort?: string;
}

/** 分页查询上架插件。 */
export function marketListPlugins(
  query: MarketPluginQuery = {},
): Promise<PageResult<MarketPlugin>> {
  return requestClient.get(`${BASE}/plugins`, { params: query });
}

/** 插件详情。 */
export function marketGetDetail(id: number): Promise<MarketPluginDetail> {
  return requestClient.get(`${BASE}/plugins/${id}`);
}

/** 插件的已发布、审核通过版本列表。 */
export function marketListVersions(
  id: number,
): Promise<MarketPluginVersion[]> {
  return requestClient.get(`${BASE}/plugins/${id}/versions`);
}

/** 启用中的分类列表。 */
export function marketListCategories(): Promise<MarketCategory[]> {
  return requestClient.get('/forge/front/plugin-categories');
}

/**
 * 下载插件（解析出安装包地址与校验信息）。
 * 未传 versionId 时下载最新版本。
 */
export function marketDownload(
  id: number,
  versionId?: number,
): Promise<MarketDownloadResult> {
  const url =
    versionId == null
      ? `${BASE}/plugins/${id}/download`
      : `${BASE}/plugins/${id}/versions/${versionId}/download`;
  return requestClient.post(url, {});
}
