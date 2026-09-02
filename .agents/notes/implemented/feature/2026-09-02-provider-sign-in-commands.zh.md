# Agent Note: 提供方登录命令

Status: implemented

[English](2026-09-02-provider-sign-in-commands.md) | 中文

## 问题

授权 seam 与 pi-ai 适配器的登录 flow 早已存在，但没有任何随附组合挂载 `dsh-authorization`，也没有任何 surface 调用过 `begin()`：Models 页面只收集密钥，CLI 与命令平面都不提供登录。因此只能由人取得的凭据——`openai-codex` 路由背后的 ChatGPT OAuth 授权，也就是 Codex 订阅驱动主模型的方式——在产品中无法触达，尽管 seam、flow 与凭据记录格式都已就位。仓库所有者希望把自己的 Codex 订阅用作默认模型。

## 决策

`dsh-base` 在凭据存储之后挂载 `@deepseek-ai/dsh-authorization`，使每个适配器 flow 都在每个基于 base 的 profile 中注册，并挂载 `@deepseek-ai/dsh-command-login`，由它拥有作为 seam 对话 surface 的 `/login` 与 `/logout`。

- `/login` 列出每个已注册 flow 及其已存储记录的状态；`/login <provider> [method]` 通过 `ctx.authorization.begin()` 启动一次尝试，其交互按凭据键追加通知并暂存问题；`/login <provider> <answer>` 解决暂存的问题，`select` 选项按 id 或标签匹配；`/logout <provider>` 通过 seam 取消并删除记录。
- 命令返回后尝试仍在进行。每次调用等待 `progressTimeoutMs`（默认五秒）以获取 flow 的下一条通知或问题，然后以提供方状态、最新通知（存在时带 `Open:` 与 `Code:` 行）以及待回答问题和回答它的命令作答。flow 通过问题自身信号撤回的问题以 `WITHDRAWN` 拒绝，这不是拒答；结算时仍未回答的问题被丢弃。指名页面的通知会通过 `dsh-host-browser-open`——从 Web app 启动交接中提取的辅助库，带同样的 SSH 守卫——交给本宿主的默认浏览器，除非 `openBrowser` 已关闭；确认文本会在 URL 旁报告 `Browser: opened automatically` 或失败原因。
- 两个命令都设置 `recordInput: false`，因此粘贴的代码或密钥绝不会进入会话日志；`command/done` 文本只携带 flow 的指示。
- 提供方指南记录了订阅路径：在 Models 页面以空密钥声明 `openai-codex` 路由，运行 `/login openai-codex`，选择 `browser` 或 `device_code`，然后在选择器中挑选一个 GPT 模型。

## 验证

包测试通过真实的命令注册表、本地凭据存储与授权服务，针对一个形似 pi-ai Codex 登录的脚本化 flow 驱动两个命令：列出、按 id 与标签选择方式、页面通知、被回答与被撤回的代码问题、进度超时、拒答与失败的结算、由另一个 surface 拥有的尝试、对进行中与已存储状态的登出，以及没有授权服务的组合。`dsh-base` 组合包测试断言这两个配置项；Web 命令菜单 golden 固定这两个条目。

## 考虑过的替代方案

**Models 页面上的登录按钮。** 暂时拒绝，因为它需要新的 Remote 约定、客户端目录重新生成以及浏览器侧渲染问题的对话框；命令平面已经渲染文本行并能触达同一个 seam，因此先由它交付能力，页面可以之后加入。

**CLI 子命令。** 拒绝，因为 seam 的交互本应触达发起请求的 surface，对运行中的 Web 会话而言就是对话本身；CLI 登录会针对同一个凭据存储启动第二棵树，去回答 Web 用户看不到的问题。

**导入 Codex CLI 的 `auth.json` 令牌。** 拒绝，因为这会把 harness 与另一款产品的磁盘格式和刷新语义耦合；pi-ai 随附的 OAuth flow 使用同一个客户端，并产出适配器自己会刷新的记录。

**打印页面并把打开它留给人。** 拒绝，因为实际使用表明 OAuth URL 在可滚动的会话记录行中长达数百个字符；Web app 本已在宿主上打开自己的启动 URL，因此同样的交接与 SSH 守卫也服务于登录页面。

**自动回答 flow 的登录方式问题。** 拒绝，因为正确的方式取决于浏览器在哪里：harness 宿主上的浏览器回调是常见的本地情形，设备代码是远程情形，只有人才知道是哪一种。

## 后果

每个基于 base 的 profile 都会注册 pi-ai 登录 flow，并在存在命令适配器的地方暴露 `/login` 与 `/logout`；headless、ACP 与 JSON-RPC 表面仍没有登录路径。已登录的 `openai-codex` 路由让选择器提供订阅所含的 GPT 模型，保存的选择使其中之一成为默认值。机密答案经由输入框传递，对日志隐藏但不对输入框自身的历史隐藏。登录页面在 harness 宿主上打开，因此远程浏览器客户端会看到它在服务器上打开；SSH 启动只报告 URL。命令菜单 golden 与 base 配置项清单随两个新配置项而变化。
