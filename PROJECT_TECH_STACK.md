# Waferbox 技术栈 Deep Dive

## 1. 项目定位

`Waferbox` 是一个面向晶圆数据处理场景的跨平台桌面工具箱，当前已落地的能力包括：

- AOI Map Gap 对比（双文件差异分析）
- AOI Wafer Overlay 叠图（多文件融合）
- CSV Wafer Fusion（多 Summary CSV 合并导出 Excel）
- Wafer Topography Studio（IBE X/Y/Z CSV 的 2D 热力图 + 3D 视图）

应用采用 **Wails v2 + Go + React + TypeScript**，通过 Wails 桥接实现前后端一体化桌面交付。

---

## 2. 技术栈总览

### 2.1 平台与语言

- 桌面框架：`Wails v2`
- 后端语言：`Go 1.24`
- 前端语言：`TypeScript 5.9` + `React 19`
- 包管理：`pnpm`

### 2.2 前端核心依赖

- 构建工具：`Vite 7`
- 路由：`@tanstack/react-router`（文件路由 + 生成 `routeTree`）
- UI 基础：`Tailwind CSS v4` + `shadcn/ui`（基于 Radix 组件）
- 主题：`next-themes`
- 数据可视化：`chart.js` + `react-chartjs-2`
- Markdown：`react-markdown` + `remark-gfm` + `rehype-highlight`
- 图标与 SVG：`@iconify/tailwind4`、`vite-plugin-svg-icons`、`vite-plugin-svgr`
- HTTP：`axios`

### 2.3 后端核心依赖

- Wails：`github.com/wailsapp/wails/v2 v2.11.0`
- Excel 导出：`github.com/xuri/excelize/v2 v2.9.1`
- 图像处理：Go 标准库 `image/png`、`image/draw`

---

## 3. 架构分层

项目后端分层清晰，接近轻量 DDD 分层：

- `app.go`：应用入口服务层（Wails 暴露的方法定义）
- `internal/application/export`：应用服务层，负责导出用例编排
- `internal/domain/wafer`：领域逻辑层，负责 wafer map 渲染算法
- `internal/infrastructure/storage`：基础设施层，负责写入 Downloads

前端按“路由 + feature”组织：

- `src/routes`：路由声明（工具页面入口）
- `src/features/tools/*`：各工具功能实现
- `src/components/ui`：通用 UI 组件
- `src/components/layout`：桌面布局、标题栏、侧边栏、登录弹窗

---

## 4. 前后端通信机制

### 4.1 Wails 桥接（主链路）

Go 暴露到前端的方法（自动生成到 `frontend/wailsjs/go/main/App.*`）：

- `SaveBase64Image(dataURL, fileName)`
- `SaveWaferMapPNG(request)`
- `SaveMergedTestItemExcel(request)`
- `SetAppearance(theme)`

前端直接调用 `@wailsjs/go/main/App` 中的类型化函数，属于本项目桌面环境下的核心通信路径。

### 4.2 HTTP 调用（辅助链路）

前端还存在远端认证调用：

- 登录接口：`POST http://10.68.100.62/mycim2/open-api/auth/login`
- 另有 `baseURL=/api` 的 axios 实例，并在请求拦截器自动注入 `Bearer token`

这说明项目是“本地桌面能力 + 企业内网认证接口”混合模式。

---

## 5. 关键实现特征

### 5.1 AOI / Wafer 数据处理

- 前端会解析 AOI 文本格式，抽取 `LOT/WAFER/ROWCT/COLCT/RowData`
- 内置叠图与差异算法：`buildOverlayWaferMap`、`buildDiffWaferMap`
- 导出 PNG 时优先走 Go 渲染（`SaveWaferMapPNG`），失败回退到 Canvas + Base64 存盘

### 5.2 渲染与导出

- Go 端 `RenderWaferMap` 使用像素级绘制（线段、椭圆、坐标轴、中心点）
- 导出 Excel 由 `excelize` 生成，包含：
  - 动态写入列头和数据
  - 数值字符串自动转浮点
  - 冻结首行
  - 设置列宽与表头样式

### 5.3 主题与平台差异

- macOS：透明窗口 + NSAppearance 同步主题，并持久化到用户配置目录
- Windows：frameless 窗口 + WebView2 运行时检测与提示，支持 fixed runtime 路径探测
- 前端通过 `next-themes` + CSS Variables + Tailwind 语义 token 管理主题

---

## 6. 工程化与构建

### 6.1 开发与构建命令

- 全栈开发：`wails dev`
- 前端开发：`cd frontend && pnpm dev`
- 生产构建：`wails build`
- Windows 打包脚本：`scripts/build-waferbox-win.sh`

### 6.2 前端工程约束

- TypeScript `strict` 打开
- ESLint 使用 `@eslint/js + typescript-eslint + react-hooks`
- 路由由 TanStack Router 插件参与构建并自动生成 `routeTree`

---

## 7. 当前目录焦点（核心代码）

- `main.go` / `app.go`：Wails 启动与绑定
- `main_windows.go` / `main_darwin.go`：平台窗口行为
- `internal/domain/wafer/renderer.go`：wafer 绘图算法核心
- `internal/application/export/export_service.go`：图片/Excel 导出编排
- `frontend/src/features/tools/*`：各业务工具实现
- `frontend/src/components/layout/main-layout.tsx`：应用壳层、登录、主题同步
- `frontend/src/index.css`：设计 token 与主题变量

---

## 8. 结论

该项目是一个典型的 **Wails 桌面混合架构**：

- 后端 Go 负责本地计算与文件输出（尤其是渲染/导出）
- 前端 React + TS 负责复杂交互、可视化与工具编排
- Wails 桥接保证本地能力调用，HTTP 接口承接企业认证

整体技术选型偏“工程实用 + 快速交付”，并且已经具备跨平台桌面产品化所需的关键基础能力。
