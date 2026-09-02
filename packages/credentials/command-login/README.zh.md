---
description: "/login 与 /logout 斜杠命令，面向在对话中登录提供方账户、回答 flow 提出的问题或移除已存储凭据的用户。"
kind: "package-reference"
---

# @deepseek-ai/dsh-command-login

[English](README.md) | 中文

## 概述

`dsh-command-login` 让你在对话输入框中而不是设置表单里登录提供方账户：`/login` 列出所有提供登录的提供方以及是否已存储凭据，`/login <provider>` 启动该提供方的授权 flow 并回显其第一条指示，`/login <provider> <answer>` 回答 flow 正在等待的问题——登录方式、粘贴的代码。`/logout <provider>` 撤回正在进行的尝试并删除已存储的记录。当凭据只能由人取得时选择它，例如 `openai-codex` 路由背后的 ChatGPT OAuth 授权；普通 API 密钥则在 Models 页面输入。两个命令都不会把输入记录进会话日志，因此粘贴的代码或密钥绝不会进入会话记录。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

把本插件与 `dsh-commands`、`dsh-credentials` 和 `dsh-authorization` 一起挂载；随附的 `dsh-base` 组合包已经这样做，因此每个带命令适配器（Web app）的基于 base 的 profile 都有这两个命令。

### 何时选择它

当提供方的凭据来自与人的对话——OAuth 登录、设备代码——且 harness 必须从运行中的会话取得它时选择它。没有授权服务的组合不要挂载它；此时命令会回答登录不可用。

### 最小配置

```yaml
- id: command-login
  name: '@deepseek-ai/dsh-command-login'
  config:
    progressTimeoutMs: 5000   # optional; how long one invocation waits for the flow's next step
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `progressTimeoutMs` | `5000` | 一次 `/login` 调用在用已有内容作答之前等待 flow 下一条通知或问题的时长 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-command-login)是所有可接受字段的详尽来源。

### 运行一次登录

输入 `/login` 查看提供登录的提供方，每项形如 `<provider> — <label>: signed in | not signed in | signing in…`。然后：

| 命令 | 效果 |
|---|---|
| `/login <provider>` | 以首选方式启动 flow 并返回其第一条指示；尝试进行中时改为报告最新通知与待回答的问题 |
| `/login <provider> <method>` | 以指定方式启动 flow，按 id 或标签匹配 |
| `/login <provider> <answer>` | 回答待回答的问题：选择题用选项 id 或标签，文本或机密问题用输入的值 |
| `/logout <provider>` | 撤回正在进行的尝试并删除已存储的凭据 |

每条确认都会指名提供方及其状态，然后是 flow 的最新通知——flow 提供时带有 `Open: <url>` 与 `Code: <code>` 行——以及待回答的问题和回答它的确切命令。命令返回后尝试仍在进行；在浏览器中打开的页面无需再输入命令即可完成它，下一次 `/login <provider>` 会报告 `signed in.`、`sign-in cancelled.` 或 `sign-in failed: <reason>`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释命令如何驱动 seam；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

本插件是授权 seam 的一个 surface：它提供 `ctx.authorization.begin()` 的交互一半，并把 seam 的通知／问题词汇转换为会话记录行。由于命令只返回一次，flow 的问题会按凭据键暂存为待回答状态，由该提供方的下一次调用作答；在配置的等待时间内到达的通知或问题会包含在当前确认中，之后到达的则由下一次确认报告。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：尝试记账、seam 交互、答案匹配、会话记录文本、两个命令处理器 |

### 尝试生命周期

`startAttempt` 用一个交互调用 `begin()`：其 `notify` 把通知追加到该尝试的通知列表，其 `prompt` 暂存一个待回答的问题。flow 通过问题自身的信号撤回问题时，该问题以 `WITHDRAWN` 代码拒绝，这不是拒答；结算会清除任何仍未回答的问题。`/logout` 通过 seam 取消，因此 flow 自身的中止处理会撤回其问题，随后删除记录。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当命令约定不够用时阅读以下页面。它们从这些命令驱动的 seam 逐步进入其运行的 flow 与用户指南。

- [授权 seam](../authorization/README.zh.md)——flow、通知、问题以及每个键同时只允许一次尝试的规则。
- [凭据存储](../credentials/README.zh.md)——flow 提交、`/logout` 删除的记录。
- [pi-ai 适配器登录](../../llm/llm-pi-ai/README.zh.md)——这些命令运行的提供方 flow，包括 ChatGPT OAuth 授权。
- [配置模型](../../../docs/user/guide/providers.zh.md)——面向用户的订阅登录演练。
- [生成的配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-command-login)——每个可接受的配置字段及其源声明。

-----

<a id="model-experience"></a>
## 模型体验

无，因为这些命令只运行授权 flow 并编辑凭据记录，不注册任何面向模型的内容。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制说明通过输入框登录能做与不能做的事。它们是当前包约束。

- **仅限命令适配器**——headless、ACP 与 JSON-RPC 表面没有命令平面，因此那里的登录需要另一个 surface。
- **同时只能看到一个问题**——快速连续提出多个问题的 flow 只显示最新的一个；更早的问题通过同一命令按顺序回答。
- **不会自动打开浏览器**——flow 指名的页面以文本返回，由人自行打开；浏览器回调方式需要该浏览器能访问 harness 宿主的回调端口。
- **机密答案不会回显，但仍在输入框中输入**——`secret` 问题通过同一命令行回答；输入不会进入会话日志，但不会从输入框自身的历史中排除。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** No companion is published. 本包的全部输出只是命令结果以及对授权与凭据 seam 的调用，所有持久关系均由这两个 seam 拥有。
