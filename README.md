# orccode

> 一款 Spotlight / Raycast 风格的桌面快速启动器，基于 Electron + React 构建，支持应用搜索、快捷打开与可扩展的插件系统。

orccode 常驻后台，通过全局快捷键随时唤起一个无边框、半透明的搜索窗口：输入即可搜索并启动已安装的应用、自定义条目（文件 / URL），或调用插件。插件既能直接向搜索结果注入内容（`inline`），也能打开自带的沙箱化界面（`view`）。

## ✨ 功能特性

- **即时搜索** — 扫描系统已安装应用与 Microsoft Store 应用，支持拼音 / 首字母匹配（如 `wljsq` → 网络计算器）。
- **快捷打开** — 自定义文件、可执行程序、网址条目；URL 条目自动抓取网站 favicon 作为图标。
- **最近使用** — 默认展示最近启动 / 使用过的条目，按使用频率排序。
- **全局快捷键** — 可在设置中自定义唤起热键，开机自启可选。
- **主题** — 浅色 / 深色 / 跟随系统，主题变化实时同步到插件界面。
- **插件系统**
  - `inline` 插件：直接贡献搜索结果并响应回车执行。
  - `view` 插件：通过 `plugin://` 协议加载自带 HTML 界面，运行在隔离的 `<webview>` 沙箱中，仅能访问受控的 `window.pluginHost` 桥。
  - **独立窗口**：view 插件可分离为独立窗口，支持窗口置顶、记忆尺寸/位置，并可设为「默认在独立窗口打开」。
  - **插件配置**：插件可在 `plugin.json` 中声明配置项（字符串 / 数字 / 布尔 / 下拉），自动渲染为表单；用户设置会持久化并实时回传给插件（主进程与界面双向可读）。
- **托盘常驻** — 系统托盘菜单提供唤起、设置、开机自启与退出。

## 🧱 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面框架 | Electron 42 |
| 渲染层 | React 19 + TypeScript |
| 样式 | Tailwind CSS 4 + shadcn 风格组件（oklch 主题 token） |
| 命令面板 | cmdk |
| 图标 | lucide-react |
| 拼音匹配 | pinyin-pro |
| 本地存储 | `node:sqlite`（KV 设置表 + 使用记录） |
| 构建 | electron-forge + Vite，Windows 安装包由 electron-builder（NSIS）产出 |

## 📁 项目结构

```
src/
├── main/              # 主进程
│   ├── apps/          # 应用扫描、Store 应用、拼音、图标
│   ├── ipc/           # ipcMain 处理器（渲染层 ↔ 主进程桥）
│   ├── plugins/       # 插件发现 / 运行时 / plugin:// 协议
│   ├── settings/      # 设置读写、主题解析与广播
│   ├── shortcuts/     # 全局快捷键
│   ├── windows/       # 启动器 / 设置 / 插件窗口
│   └── tray.ts        # 系统托盘
├── preload/
│   ├── index.ts       # 暴露给启动器渲染层的 window.launcher API
│   └── plugin.ts      # 暴露给 view 插件 webview 的 window.pluginHost 桥
├── renderer/          # React 渲染层（启动器 + 设置页面）
│   ├── components/     # UI 组件
│   ├── pages/         # 设置子页面（含插件管理）
│   └── lib/
├── core/              # 与进程无关的核心逻辑
│   ├── database/      # node:sqlite KV 存储
│   ├── plugin/        # 插件类型契约
│   └── search/        # 搜索 / 排序
└── shared/            # 主进程与渲染层共享的类型定义

plugins/               # 内置插件（运行时从 resources/plugins 加载）
└── clipboard/         # 剪贴板历史（view 插件示例，含配置）
assets/                # 应用 / 窗口图标
```

## 🚀 开发

环境要求：Node.js（建议 LTS）与 npm。

```bash
# 安装依赖
npm install

# 启动开发（electron-forge + Vite，含热重载）
npm start

# 代码检查
npm run lint
```

> 注意：view 插件的 webview 预加载脚本（`plugin-preload.js`）只在**完整重启**应用后才会重新加载，渲染层热重载不会刷新它。

## 📦 打包

```bash
# 当前平台打包（不生成安装包）
npm run package

# 生成各平台产物（zip / deb / rpm）
npm run make

# Windows 安装包（NSIS，先 forge package 再 electron-builder）
npm run build:win
```

构建配置见 `forge.config.ts` 与 `electron-builder.yml`。`assets/` 与 `plugins/` 通过 `extraResource` 一同打包，运行时从 `process.resourcesPath/plugins` 加载插件。

## 🔌 插件开发

每个插件是 `plugins/` 下的一个目录，至少包含一个 `plugin.json` 清单。

### 清单字段（`plugin.json`）

| 字段 | 说明 |
| --- | --- |
| `id` | 唯一标识 |
| `name` | 显示名称 |
| `version` | 语义化版本 |
| `type` | `inline`（默认，注入搜索结果）或 `view`（打开自带界面） |
| `entry` | 主进程入口模块（如 `index.js`）；inline 必填，view 仅在需要 RPC 时填写 |
| `ui` | view 插件的 HTML 入口（如 `ui/index.html`），经 `plugin://` 加载 |
| `icon` | 图标（如 `icon.svg`），解析为 data URI |
| `description` | 简短描述 |
| `keywords` | 触发该插件的搜索关键字 |
| `window` | view 插件独立窗口的默认 `width` / `height` / `alwaysOnTop` |
| `config` | 用户可配置项数组（见下） |

### 插件类型

**inline 插件** — 主进程模块导出 `search(query)`（返回结果数组）和可选的 `execute(action)`：

```js
module.exports = {
  search(query) {
    return [{ id: 'hello', title: '你好', subtitle: query, action: 'say-hello' }];
  },
  execute(action) {
    if (action === 'say-hello') { /* … */ }
  },
};
```

**view 插件** — 主进程模块导出 `rpc` 映射，界面通过 `window.pluginHost.invoke(method, args)` 调用：

```js
module.exports = {
  rpc: {
    list(args) { /* 返回数据给 UI */ },
    copy(args) { /* 处理 UI 请求 */ },
  },
};
```

界面（运行在沙箱 webview）可用的桥 `window.pluginHost`：

- `invoke(method, args)` — 调用主进程 `rpc` 中的方法
- `close()` / `back()` — 关闭或返回启动器根视图
- `getTheme()` / `onThemeChanged(cb)` — 读取并订阅当前 `light`/`dark` 主题
- `getConfig()` / `onConfigChanged(cb)` — 读取并订阅本插件的配置

### 插件配置

在清单中声明 `config` 数组，每一项会在「插件管理」页面渲染为对应控件：

```json
{
  "config": [
    {
      "key": "maxItems",
      "type": "number",
      "label": "历史记录上限",
      "description": "最多保留多少条记录(10–1000)。",
      "default": 100,
      "min": 10, "max": 1000, "step": 10
    }
  ]
}
```

支持的 `type`：`string` / `number` / `boolean` / `select`（`select` 需提供 `options`）。

读取配置：

- **主进程侧** — 导出 `init(ctx)`，通过 `ctx.getConfig()` 读取、`ctx.onConfigChange(cb)` 订阅：

  ```js
  module.exports = {
    init(ctx) {
      applyConfig(ctx.getConfig());
      ctx.onConfigChange(applyConfig);
    },
    rpc: { /* … */ },
  };
  ```

- **界面侧** — `window.pluginHost.getConfig()` / `onConfigChanged(cb)`。

完整示例见内置的 `plugins/clipboard` 剪贴板历史插件（view 类型，含主进程 `init`/`rpc`、沙箱 UI、主题适配与三项数字配置）。

## License / 授权协议

本项目采用 PolyForm Noncommercial License 1.0.0 授权，详见 [LICENSE.md](LICENSE.md)。

这意味着你可以在非商业目的下查看、学习、研究、测试、修改和分发本项目代码，但禁止任何未经授权的商业使用。

未经版权持有人书面授权，以下行为均不被允许：

- 将本项目或其衍生作品用于商业产品、付费服务、SaaS 服务或企业内部商业场景。
- 将本项目代码、插件、界面、构建产物或衍生作品集成到收费软件、商业项目或交付物中。
- 基于本项目提供付费部署、付费咨询、付费培训、二次销售、转售、代运营或类似商业服务。
- 移除、隐藏或篡改版权声明、许可声明、作者署名或项目来源信息。

如需商业授权、合作或定制开发，请先联系版权持有人取得单独书面许可。

本项目按现状提供，不承诺任何形式的担保。使用者需自行承担使用、修改、分发或集成本项目产生的风险。
