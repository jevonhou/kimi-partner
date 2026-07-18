<div align="center">
  <img src="assets/logo/kimi-partner-logo-256.png" width="144" alt="Kimi Partner Logo">
  <h1>Kimi Partner</h1>
  <p><strong>让 Kimi 发挥前端审美，让 Codex 掌控整个交付。</strong></p>
  <p>一个把 Kimi 的前端实现能力接入 Codex 工作流的插件：让 Kimi 完成限定范围的界面开发，再由 Codex 负责任务拆解、范围控制、代码审查和最终验收。</p>
  <p><a href="README.md">English</a> · <a href="SECURITY.md">安全说明</a></p>
</div>

## 设计师主导的工作流

**设计师 → Codex → Kimi → Codex → 设计师**

设计师定义目标、视觉规范和验收标准；Codex 限定修改范围并启动任务；Kimi 完成前端实现；Codex 检查 Git diff、运行测试并完成浏览器验收；最终视觉判断仍由设计师作出。

![Kimi Partner 真实工作流：设计目标、限定范围的 Kimi 实现与 Codex 独立验收](assets/demo/kimi-partner-30s.gif)

这段 30 秒演示来自一次真实的公开示例任务：Kimi 只修改了 2 个获准文件，Git `HEAD` 未改变，范围外变更为 0；随后 Codex 运行 42 项测试，并在 1440×900 和 390×844 两个视口完成浏览器验收。完整记录见[公开验收证据](docs/demo/DEMO_EVIDENCE.md)。

> Kimi Partner 提供应用层护栏，不是操作系统沙箱。请始终检查实际变更，并独立验收结果。

## 为什么做这个插件？

很多开发者喜欢 Kimi 在前端界面上的视觉判断和成品感，尤其是布局、间距、层级、配色、组件细节与整体风格。但在真实项目里，大家同样需要清晰的任务拆解、严格的修改范围、可追踪的代码变更和可靠的最终验收。

Kimi Partner 就是为这个需求做的：你可以在 Codex 里明确选择把一项前端任务交给 Kimi，让它发挥界面实现与视觉审美方面的优势；Codex 则继续负责理解项目、限定可修改文件、检查 Git diff、运行测试和完成浏览器验收。这样不需要切换主工作流，也能在同一个真实项目中使用两个模型各自擅长的能力。

Kimi 在这里是实现搭档，不是自动路由器，也不是最终审核者。

## 核心能力

- **明确选择后才委派**：只有用户主动要求使用 Kimi，或批准当次建议后才会启动。
- **异步与持久化**：任务在独立 worker 中运行，可低频长等待，并能跨 Codex 任务读取结果。
- **原会话返修**：Codex 可以把带证据的验收问题退回捕获到的同一 Kimi 会话。
- **模型连续性**：任务开始时锁定模型别名；K3 会话保留思考历史。
- **执行边界**：限制允许路径、依赖安装、外部绝对路径和危险 Git 命令，禁止 Node 内联与标准输入执行，并限制单轮时长。
- **Git 对账**：如果 Kimi 修改了范围外文件或改变 Git HEAD，任务会直接失败。
- **Codex 独立验收**：Kimi 的总结只是线索，Codex 仍需检查 diff、测试和浏览器结果。

## 五个工具

| 工具 | 用途 |
| --- | --- |
| `start_kimi_task` | 启动经过明确批准、限定范围的 Kimi 编码任务。 |
| `get_kimi_task` | 查询进度，或短暂等待状态变化。 |
| `wait_kimi_task` | 最长等待 5 分钟，忽略中间阶段更新，直到任务结束或等待超时。 |
| `continue_kimi_task` | 带着 Codex 验收反馈续接同一 Kimi 会话。 |
| `cancel_kimi_task` | 用户明确要求时，停止已校验身份的活动 worker。 |

### 低额度等待协议

`get_kimi_task` 适合立即查询，或保留兼容性的 30 秒以内短等待。正常执行中的任务应使用 `wait_kimi_task`：它会忽略中间阶段更新，只在任务结束或等待超时时返回。默认等待 45 秒，为 60 秒 MCP 请求超时预留余量；支持更长工具调用的客户端可以主动设置到最多 300 秒。

任务仍在运行时，两个查询工具只返回任务 ID、状态、阶段、更新时间、终态标记和 20 秒的兜底轮询建议。任务进入终态后，才返回完整任务、尝试记录、总结或错误，以及 Git 变更收据。这样能减少重复状态结构带来的额度消耗，同时保留最终验收所需的全部证据。

## 环境要求

- macOS（当前版本已验证 macOS 进程组行为）
- Node.js 22+
- 已安装并登录 [Kimi Code CLI](https://www.kimi.com/code)
- 支持 `codex plugin` 命令的 Codex
- 目标项目必须位于 Git 工作区内

## 安装

### 推荐：直接让 Codex 安装

把下面这段话发给 Codex：

> 请安装 https://github.com/jevonhou/kimi-partner 这个插件。克隆到 `~/plugins/kimi-partner`，运行完整验证，注册到我的个人 Codex marketplace，安装后确认 Skill 和五个 MCP 工具都能加载。

### 手动安装

```bash
git clone https://github.com/jevonhou/kimi-partner.git ~/plugins/kimi-partner
cd ~/plugins/kimi-partner
npm ci
npm run verify
```

把下面的条目合并进 `~/.agents/plugins/marketplace.json` 的 `plugins` 数组，不要覆盖已有插件：

```json
{
  "name": "kimi-partner",
  "source": { "source": "local", "path": "./plugins/kimi-partner" },
  "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
  "category": "Productivity"
}
```

然后使用该文件顶部声明的 marketplace 名称安装（通常是 `personal`）：

```bash
codex plugin add kimi-partner@personal
```

安装后请新开一个 Codex 任务，让新的 Skill 和 MCP 工具完成加载。

## 立即试用

你可以对 Codex 说：

> 让 Kimi 实现这个项目的按钮交互状态，只允许修改 `src/components/Button.tsx` 和 `src/styles/button.css`。完成后你自己检查 diff 并验收。

Codex 会准备任务、启动 Kimi Partner、等待结果、检查 Git 回执，再运行自己的测试和浏览器验收。

## 安全模型

Kimi Partner 会：

1. 相对真实 Git 根目录规范化路径，并检查符号链接逃逸。
2. 在任务开始时捕获并锁定模型别名，续聊不静默切换模型。
3. K3 任务强制设置 `KIMI_MODEL_THINKING_KEEP=all`。
4. 检查流式工具调用中的越界写入、项目外绝对路径、未授权依赖安装和危险 Git 命令。
5. 每轮默认有 30 分钟硬时限，可配置为 1–120 分钟。
6. 每轮结束后重新核对 Git；越界改动或 HEAD 变化会让任务失败。

工具调用检查属于**应用层护栏，并不是操作系统沙箱**。Codex 仍然必须检查最终回执并独立验收。完整说明见 [SECURITY.md](SECURITY.md)。

## 开发

```bash
npm ci
npm run verify
```

运行时会被打包为 `dist/mcp-server.mjs`，安装后的插件不依赖自身目录中的 `node_modules`。

## 项目状态与免责声明

`0.1.x` 仍是早期版本，适合本地试用并配合严格代码审查。当前只正式验证了 macOS，暂不承诺 Windows 和 Linux 的进程组行为。

Kimi Partner 是独立社区项目，与 OpenAI、Moonshot AI 或 Kimi 均无隶属、合作或官方背书关系。相关产品名称和商标归各自所有者。

## 许可证

[MIT](LICENSE) © 2026 Jevon Hou
