# CLAUDE.md - Wails + React (pnpm) 开发规范

## 项目概览
这是一个追求高 UI 还原度的跨平台桌面应用。
- **核心栈**: Wails v2 + Go + React + TS
- **包管理**: pnpm (必须使用 pnpm)
- **路由**: TanStack Router (强类型路由)
- **UI 体系**: shadcn/ui + Tailwind CSS (严格变量驱动)
- **项目仓库地址**:
  - SSH: `git@github.com:Xuzein/wafertoolbox.git`
  - HTTPS: `https://github.com/Xuzein/wafertoolbox.git`

## 编码准则

### 1. 样式与 UI 还原 (最高优先级)
- **语义化变量**: 严禁硬编码颜色值。必须使用 Tailwind 语义化类名：
  - 文字: `text-primary`, `text-secondary`, `text-muted`, `text-accent`
  - 背景: `bg-background`, `bg-card`, `bg-popover`
  - 边框: `border-input`, `border-primary`
- **主题适配**: 确保 `frontend/src/index.css` 或 `globals.css` 中定义了对应的 CSS Variables (`--primary`, `--primary-foreground` 等)。
- **还原度**: 严格遵守设计稿的间距 (Spacing)、层级 (Z-index) 和圆角 (Radius)。使用 `gap-x-*` 和 `gap-y-*` 维护布局间距。

### 2. 前端架构
- **类型安全**: 调用后端必须使用 `frontend/wailsjs/go` 下的自动生成函数。
- **路由**: TanStack Router 路由定义需保持强类型，跳转优先使用 `useNavigate` 或 `<Link>`。
- **组件**: 优先复用 `frontend/src/components/ui` 中的 shadcn 组件，通过修改 `variant` 或 `className` 实现定制。

### 3. 后端 (Go)
- **逻辑位置**: `app.go` 为主逻辑类，复杂业务在 `internal/` 包中实现。
- **错误处理**: 后端返回 `error`，前端 Promise 会进入 `catch` 块。
- **API查询**: 相关API可以使用context7 mcp查询wails2的api

## 常用命令

### 开发与构建
- **全栈开发**: `wails dev`
- **前端调试**: `cd frontend && pnpm dev`
- **生成应用**: `wails build`

### 包管理 (pnpm)
- **安装依赖**: `cd frontend && pnpm install`
- **添加 UI 组件**: `cd frontend && pnpm dlx shadcn-ui@latest add [component]`
- **添加库**: `cd frontend && pnpm add [package]`

## 工作流建议
1. **变量检查**: 生成 UI 代码前，先确认 `tailwind.config.js` 的 `colors` 配置。
2. **同步类型**: 每次修改 Go 结构体后，确保 `wails dev` 正在运行以更新前端 TS 类型。
3. **高保真实现**: 如果设计稿有特殊阴影或滤镜，请在 `tailwind.config.js` 的 `extend` 中定义，不要直接写 inline style。
4. **主动提交代码**: 每一次代码变动完成后都要主动执行 Git 提交（`git add` + `git commit`）。
