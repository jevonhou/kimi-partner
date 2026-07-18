# Kimi Partner 开源发布设计

## 目标

把现有的 Kimi Partner 本地 Codex 插件整理为一个可信、易安装、便于传播的公开 GitHub 项目。发布结果既要说明它解决了什么问题，也要清楚表达安全边界、非官方属性和 Codex 最终验收责任。

## 品牌定位

Kimi Partner 的核心叙事是：Codex 负责拆解、编排和最终验收，Kimi Code 作为用户明确选择的实现搭档完成受约束任务，插件负责安全交接、续聊和 Git 对账。

项目继续使用 `Kimi Partner` 名称。所有公开页面必须注明：这是独立社区项目，与 Moonshot AI、Kimi 或 OpenAI 均无隶属、合作或官方背书关系。

## Logo

最终 Logo 沿用已选中的双模块方向，并收敛为三个元素：

- 左侧深色代码括号代表 Codex 的编排与审查。
- 右侧蓝紫代码括号代表 Kimi 的执行与长程探索。
- 中央小方块代表被限定范围的任务包。

Logo 必须使用简洁纯色几何形，去掉内侧三角、文字、字母、箭头、盾牌、勾选和渐变。它需要在 24–32 px 的 GitHub 头像和 Codex 插件列表中仍然清晰，并避免复制 OpenAI 或 Kimi 官方标志。

交付资产包括：

- `assets/logo/kimi-partner-logo.png`：仓库和插件主 Logo。
- `assets/logo/kimi-partner-logo-256.png`：小尺寸头像版本。
- `assets/social/kimi-partner-social-preview.png`：GitHub 社交分享图。

## 开源仓库包装

公开仓库名称为 `kimi-partner`，归属当前 GitHub 用户 `jevonhou`，默认分支为 `main`，可见性为 public。

仓库使用 MIT License，并补齐：

- 英文主 README，开头提供一句明确价值主张、Logo、功能亮点、工作流和快速安装。
- 简体中文说明入口，方便中文用户理解和安装。
- `SECURITY.md`，说明本地执行、应用层护栏和报告安全问题的方式。
- `CONTRIBUTING.md`，说明开发、测试和提交要求。
- `.gitignore`，排除依赖、系统文件、日志和本地状态。
- 非官方免责声明、隐私说明和已知边界。

README 不使用夸大表述。重点宣传以下真实能力：

1. 用户明确选择后才委派，不自动替换 Codex。
2. 异步任务、持久状态和同一 Kimi 会话续聊。
3. 模型锁定、K3 思考历史保留和每轮硬超时。
4. 允许路径、依赖安装、外部路径和危险 Git 命令护栏。
5. Git 基线与变更回执；越界改动或 HEAD 变化直接失败。
6. Codex 独立完成 diff、测试和浏览器验收。

## 安装与兼容性

首个公开版本保持 `0.1.0` 产品版本，清除仅用于本机缓存刷新的 `+codex.*` 后缀。要求 Node.js 22+、已登录的 Kimi Code CLI 和支持插件命令的 Codex。

README 提供从 GitHub 克隆、安装依赖、构建、注册到个人 Codex marketplace、安装并新开任务验证的完整步骤。发布包不包含凭据、Kimi 会话、任务日志、本地 marketplace 或用户目录路径。

## GitHub 发布与宣传

发布前执行敏感信息扫描、全量测试、构建、插件规范校验和安装产物核对。确认通过后：

1. 创建公开 GitHub 仓库 `jevonhou/kimi-partner`。
2. 提交完整源代码、文档和品牌资产并推送 `main`。
3. 设置仓库描述、主页 README、Logo 社交预览和 Topics。
4. 创建 `v0.1.0` Release，发布简洁的英文说明，并附中文亮点摘要。

建议 Topics：`codex`、`kimi`、`kimi-code`、`mcp`、`ai-agents`、`developer-tools`、`open-source`。

## 验收标准

- Logo 在 32 px 下仍能辨认左右模块和中央任务方块。
- README 的安装步骤能从干净临时目录完成构建和插件加载。
- `npm run verify`、插件校验和敏感信息扫描通过。
- 公开仓库不包含用户路径、任务状态、会话日志、令牌或私有资料。
- GitHub 仓库为 public，默认分支、描述、Topics 和 `v0.1.0` Release 均正确。
- 最终向用户提供可访问的仓库和 Release 链接。
