# orccode 插件开发文档

orccode 是一个 Electron 快速启动器。插件机制允许第三方为启动器扩展两类能力：

- **`inline`（内联）插件**：直接向启动器的搜索结果列表贡献条目，用户在主输入框输入时实时出现。
- **`view`（视图）插件**：作为一个入口出现在列表里，选中后打开插件自带的 UI（运行在隔离、受限的 `<webview>` 里）。

本文档基于仓库当前实现编写，并以内置的 `plugins/clipboard`（剪贴板历史，view 类型）作为完整示例。

---

## 1. 快速开始

1. 在仓库的 `plugins/` 目录下新建一个以插件 id 命名的文件夹，例如 `plugins/hello/`。
2. 在该文件夹内创建 `plugin.json`（清单）。
3. 根据插件类型，提供入口模块（`index.js`）和/或 UI（`ui/index.html`）。
4. 启动应用（`pnpm start` 或 `npm start`），在 **设置 → 插件管理** 中即可看到、启用、配置你的插件。
5. 启用/禁用会立即生效，无需重启（运行时会自动 `reloadPlugins`）。

### 插件目录位置

宿主会从下列目录扫描 `plugins/<id>/plugin.json`：

| 运行方式 | 插件根目录 |
| --- | --- |
| 开发（未打包） | `<appPath>/plugins`（即仓库根的 `plugins/`） |
| 已打包 | `<process.resourcesPath>/plugins` |

> 见 `src/main/plugins/discover.ts` 的 `pluginsRoot()`。打包时需把 `plugins/` 一并放入 `resources`。

### 最小目录结构

```
plugins/
└─ hello/
   ├─ plugin.json      # 必需：清单
   ├─ index.js         # inline 必需 / view 可选（仅在需要主进程逻辑时）
   ├─ ui/              # view 必需：UI 资源
   │  ├─ index.html
   │  └─ ui.js
   └─ icon.svg         # 可选：图标
```

---

## 2. 清单 `plugin.json`

清单的 TypeScript 定义见 `src/shared/PluginManifest.ts`。字段如下：

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `id` | `string` | ✅ | 全局唯一标识。同时作为 `view` 插件的 `plugin://<id>` 协议主机名。**没有 `id` 或 `name` 的插件会被忽略。** |
| `name` | `string` | ✅ | 展示名称（列表中显示，也用于生成拼音搜索）。 |
| `version` | `string` | ✅ | semver 版本号。 |
| `type` | `"inline" \| "view"` | ❌ | 插件形态，默认 `inline`。 |
| `entry` | `string` | inline 必需 | 主进程入口模块，相对插件目录，如 `index.js`。`view` 仅在需要特权 RPC 逻辑时才需要。 |
| `ui` | `string` | view 必需 | UI 的 HTML 入口，相对插件目录，如 `ui/index.html`。通过 `plugin://` 协议提供服务。**`view` 插件缺少 `ui` 会被跳过并报错。** |
| `icon` | `string` | ❌ | 图标文件，相对插件目录（如 `icon.svg`）。宿主会读成 data URI 给渲染层。支持 `.svg/.png/.jpg/.jpeg/.webp/.gif/.ico`。 |
| `description` | `string` | ❌ | 简短描述。 |
| `keywords` | `string[]` | ❌ | 触发该插件的搜索关键词。 |
| `window` | `object` | ❌ | 仅 `view`：分离为独立窗口时的默认值，见下。 |
| `config` | `PluginConfigField[]` | ❌ | 用户可配置项，见 [第 5 节](#5-插件配置)。 |

### `window`（仅 view，独立窗口默认值）

`view` 插件可被「分离为独立窗口」。`window` 提供该窗口的初始默认值：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `width` | `number` | 初始宽度（最小 320，默认 720）。 |
| `height` | `number` | 初始高度（最小 240，默认 560）。 |
| `alwaysOnTop` | `boolean` | 是否启动时置顶于所有应用之上。 |

> 用户在运行时的改动（移动、缩放、置顶开关）会被记住，并在下次打开时优先于清单默认值。见 `src/main/windows/pluginWindow.ts`。

### 清单示例（取自 clipboard 插件）

```json
{
  "id": "clipboard",
  "name": "剪贴板历史",
  "version": "1.0.0",
  "type": "view",
  "entry": "index.js",
  "ui": "ui/index.html",
  "icon": "icon.svg",
  "description": "记录并搜索最近复制的文本,回车重新复制。",
  "keywords": ["clip", "clipboard", "剪贴板", "剪切板"],
  "config": [
    { "key": "maxItems", "type": "number", "label": "历史记录上限", "default": 100, "min": 10, "max": 1000, "step": 10 }
  ]
}
```

---

## 3. inline（内联）插件

内联插件向搜索列表实时贡献结果。入口模块（`entry`）通过 CommonJS 导出 `search`（必需）和 `execute`（可选）。

> 运行时用 `createRequire` 在磁盘上 `require` 入口文件，**插件代码不会被打包**，可直接 `require('electron')`、`require('node:fs')` 等 Node/Electron 模块（运行在主进程，拥有完整权限）。

### 导出接口

接口定义见 `src/core/plugin/types.ts`：

```js
module.exports = {
  // 必需：根据用户查询返回结果数组（可同步或返回 Promise）
  search(query) {
    return [
      { title: "结果标题", subtitle: "副标题", action: "open:42" },
    ];
  },

  // 可选：当某个结果被激活（回车）时调用,参数是该结果的 action
  execute(action) {
    // 执行动作；执行后启动器会自动隐藏
  },

  // 可选：见第 5 节,首次加载时拿到配置上下文
  init(ctx) { /* ... */ },
};
```

### `SearchResult` 结构

每条结果的字段见 `src/shared/SearchResult.ts`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `title` | `string` | 主文本（必需）。 |
| `subtitle` | `string` | 副文本（可选）。 |
| `icon` | `string` | 图标，路径或 data URI（可选）。 |
| `action` | `string` | 结果被激活时回传给 `execute(action)` 的标识（可选）。 |
| `pluginId` | `string` | **无需手动设置**，宿主会自动以你的插件 id 标记，并据此把激活路由回你的 `execute`。 |

### 行为约定

- `search` 抛错或返回非数组都会被安全忽略（不会崩溃启动器，错误打到控制台）。
- 用户激活结果 → 宿主调用对应插件的 `execute(action)` → 随后自动隐藏启动器（等价于打开应用的行为）。
- 保持 `search` 轻量：它会随用户每次输入被调用。耗时操作请做缓存或防抖。

---

## 4. view（视图）插件

`view` 插件提供自己的 UI，运行在一个**锁定的 `<webview>`** 中，通过 `plugin://<id>/...` 协议从插件目录加载资源。UI **不能**访问 Node、`require`、`ipcRenderer` 或启动器的 API，只能通过 `window.pluginHost` 这座桥与主进程通信。

### 4.1 主进程侧：`rpc` 映射

`view` 插件的 `entry` 模块导出一个 `rpc` 对象，其中的方法是 UI 唯一能调用的「白名单」特权逻辑：

```js
module.exports = {
  init(ctx) { /* 可选：读取配置、启动后台任务 */ },

  rpc: {
    // UI 通过 window.pluginHost.invoke("list", { query }) 调用
    list(args) {
      return /* ...返回可序列化的数据 */;
    },
    copy(args) {
      // 执行特权操作
      return true;
    },
  },
};
```

安全约束（见 `src/main/plugins/runtime.ts` 的 `invokePlugin`）：

- 只有 `rpc` 对象**自有的、函数类型的**属性可被调用；原型链、继承属性、非函数一律拒绝。
- 调用方的 `pluginId` 由宿主**从 webview 已提交的 `plugin://` 来源推导**，绝不信任渲染层传入的 id —— 插件无法冒充其他插件。
- RPC 的参数与返回值需可被结构化克隆（JSON 可序列化）。

> 纯 UI 的 `view` 插件可以**不提供 `entry`**（清单里省略 `entry`），此时没有主进程逻辑，UI 只能使用 `pluginHost` 的通用能力（主题、配置、关闭等）。

### 4.2 UI 侧：`window.pluginHost` 桥

UI 可用的全部 API 见 `src/preload/plugin.ts`：

| 方法 | 说明 |
| --- | --- |
| `invoke(method, args?) → Promise<any>` | 调用本插件主进程 `rpc` 中的某个白名单方法。 |
| `close()` | 完成操作，隐藏启动器（独立窗口下则关闭该窗口）。 |
| `back()` | 返回启动器根视图（独立窗口下则关闭该窗口）。 |
| `getTheme() → Promise<"light" \| "dark">` | 获取当前应用主题，用于初始化样式。 |
| `onThemeChanged(cb) → () => void` | 订阅主题变化；返回取消订阅函数。 |
| `getConfig() → Promise<Record<string, string\|number\|boolean>>` | 获取本插件当前生效的配置。 |
| `onConfigChanged(cb) → () => void` | 订阅配置变化；返回取消订阅函数。 |

UI 调用示例（取自 `plugins/clipboard/ui/ui.js`）：

```js
// 拉取数据
const rows = await window.pluginHost.invoke("list", { query: input.value });

// 执行动作后收起启动器
await window.pluginHost.invoke("copy", { id });
window.pluginHost.close();

// 跟随应用主题
window.pluginHost.getTheme().then(applyTheme);
window.pluginHost.onThemeChanged?.(applyTheme);

// Esc 返回
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") window.pluginHost.back();
});
```

### 4.3 沙箱与 CSP

`plugin://` 协议（见 `src/main/plugins/protocol.ts`）为每个插件分配独立、稳定的来源 `plugin://<id>`，并强制以下内容安全策略（CSP），UI 编写时需遵守：

```
default-src 'none';
script-src 'self';                  /* 只能加载本插件目录内的脚本 */
style-src 'self' 'unsafe-inline';   /* 允许内联 <style> */
img-src 'self' data:;               /* 图片：自身 + data URI */
font-src 'self';
connect-src 'self';                 /* 不能直接访问外部网络 */
base-uri 'none';
form-action 'none';
```

这意味着：

- **不能**引用 CDN 脚本/样式、外链字体、远程图片，也**不能**直接发起跨域网络请求。所有资源需放在插件目录内，所有外部数据通过主进程 `rpc` 中转。
- 协议处理器把读取严格限制在本插件目录内，并拒绝路径穿越（`..`）与软链逃逸；只服务**已启用**的插件。

### 4.4 独立窗口

`view` 插件可被「分离为独立窗口」（或在插件管理里设置为默认以独立窗口打开）。独立窗口复用同一套 `plugin://` 沙箱与 `<webview>` 宿主（见 `src/renderer/pages/PluginWindow.tsx`），初始尺寸取自清单 `window`，并记忆用户的位置/尺寸/置顶状态。

---

## 5. 插件配置

插件可在清单中声明 `config`，宿主会在**插件管理 UI** 里把每个字段渲染成控件，持久化用户的取值，并回传给插件。

### 字段定义（`PluginConfigField`）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `key` | `string` | 读写该值的稳定键。 |
| `type` | `"string" \| "number" \| "boolean" \| "select"` | 控件类型 + 存储值类型。 |
| `label` | `string` | 控件旁的标签。 |
| `description` | `string` | 控件下方的说明（可选）。 |
| `default` | `string \| number \| boolean` | 用户未设置前的默认值。 |
| `options` | `{ label, value }[]` | `select` 的选项（存储的是 `value`）。 |
| `placeholder` | `string` | `string` / `number` 输入框占位符。 |
| `min` / `max` / `step` | `number` | `number` 字段的范围与步长。 |

### 值的解析

宿主用 `resolvePluginConfig`（`src/shared/PluginConfig.ts`）把**用户存储值叠加在清单默认值之上**，并按声明类型做强制转换。因此插件读到的永远是「类型正确、符合 schema」的对象：

- `number`：非法值回落到 `default`，并按 `min`/`max` 夹取。
- `boolean`：`true` / `1` / `"true"` / `"1"` 视为真。
- 只保留 schema 中声明过的键。

### 在插件中读取配置

**主进程侧** —— 通过 `init(ctx)` 拿到 `PluginContext`（见 `src/core/plugin/types.ts`）：

```js
module.exports = {
  init(ctx) {
    const cfg = ctx.getConfig();          // 当前生效配置
    applyConfig(cfg);

    // 订阅变化（用户在插件管理里改动会实时推送）
    const unsub = ctx.onConfigChange((next) => applyConfig(next));
  },
};
```

> `init(ctx)` 在插件**首次加载时只调用一次**。Node 会缓存已 `require` 的模块，reload 不会重新执行 init，宿主也用 `initialized` 集合保证只调一次。

**UI 侧** —— 通过桥：

```js
const cfg = await window.pluginHost.getConfig();
window.pluginHost.onConfigChanged((next) => { /* 实时更新 UI */ });
```

配置示例见 `plugins/clipboard/index.js` 的 `applyConfig` / `init`：读取上限、轮询间隔等，并在变化时即时重启轮询。

---

## 6. 加载与生命周期

加载逻辑见 `src/main/plugins/runtime.ts` 与 `discover.ts`：

1. **发现**：扫描 `plugins/<id>/plugin.json`，校验 `id`/`name`（`view` 还需 `ui`），解析图标为 data URI，附加启用状态/用户关键词/配置等管理信息。
2. **加载**：仅加载**已启用**的插件。对有 `entry` 的插件用运行时 `require` 加载入口模块：
   - `inline`：要求导出 `search`（否则报错跳过），可选 `execute`。
   - `view`：取其 `rpc` 映射（若有）。
3. **init**：若导出 `init`，以配置上下文调用一次。
4. **隔离**：每个钩子（`search`/`execute`/`rpc`/`init`/配置回调）都在 `try/catch` 中执行，单个插件出错不会拖垮启动器。
5. **热更新**：启用/禁用某插件后宿主会 `reloadPlugins()`，改动即时生效，无需重启。

---

## 7. 安全须知（必读）

- **inline 插件 = 主进程完整权限**。`entry` 在主进程中以 Node 全权限运行（可读写文件系统、调用 Electron API）。只安装可信来源的插件；编写时对外部输入保持谨慎。
- **view 插件 UI = 沙箱**。UI 无 Node、无网络、无 `require`，只能经 `pluginHost` 桥与主进程对话；任何特权操作都必须显式放进 `rpc` 白名单。
- **不要信任来自 UI 的 `pluginId`**：宿主始终从 webview 来源推导，插件无法越权访问他人数据。
- **RPC 参数/返回值需可 JSON 序列化**。

---

## 8. 检查清单

发布插件前请确认：

- [ ] `plugin.json` 含 `id`、`name`、`version`；`view` 含 `ui`，`inline` 含 `entry`。
- [ ] `id` 全局唯一、稳定（它也是 `plugin://` 来源和配置存储键）。
- [ ] inline 插件导出 `search`，结果包含有意义的 `title`，需要激活时设置 `action` 并实现 `execute`。
- [ ] view 插件的所有资源都在插件目录内，未引用任何外部 CDN/网络资源（符合 CSP）。
- [ ] view 插件的特权逻辑只通过 `rpc` 暴露，并对 `args` 做校验。
- [ ] 若有配置：`config` 字段声明完整，`init`/`getConfig` 正确读取，并处理 `onConfigChange`。
- [ ] UI 跟随应用主题（`getTheme` + `onThemeChanged`）。
- [ ] 各钩子自身做好错误处理，避免长耗时阻塞。

---

## 9. 参考源码

| 关注点 | 文件 |
| --- | --- |
| 清单结构 / 配置字段 | `src/shared/PluginManifest.ts` |
| 配置解析 | `src/shared/PluginConfig.ts` |
| 结果结构 | `src/shared/SearchResult.ts` |
| 插件运行时契约（`Plugin` / `PluginContext`） | `src/core/plugin/types.ts` |
| 发现与启用状态 | `src/main/plugins/discover.ts` |
| 加载 / RPC / 配置推送 | `src/main/plugins/runtime.ts` |
| `plugin://` 协议与 CSP | `src/main/plugins/protocol.ts` |
| UI 桥（`window.pluginHost`） | `src/preload/plugin.ts` |
| 独立窗口宿主 | `src/main/windows/pluginWindow.ts` |
| IPC 接线 | `src/main/ipc/index.ts` |
| 完整示例（view + 配置 + rpc） | `plugins/clipboard/` |
