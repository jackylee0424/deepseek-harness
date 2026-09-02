---
description: "面向宿主表面的默认浏览器交接库，用于在操作者的机器上打开页面（例如 Web app 的启动 URL 与提供方登录页面），且不向启动器泄露 Harness 凭据。"
kind: "package-library"
---

# @deepseek-ai/dsh-host-browser-open

[English](README.md) | 中文

## 概述

`dsh-host-browser-open` 在操作系统的默认浏览器中打开一个 URL，并告诉调用方本进程是否通过 SSH 启动——那种情况下操作者的浏览器在另一台机器上。Web app 用它打开带令牌的启动 URL，`/login` 命令用它打开提供方的登录页面。启动器运行在一个环境已剔除 Harness 凭据的辅助进程中，因此浏览器集成绝不会看到 API 密钥；打开失败会以指明辅助进程原因的错误到达调用方，由调用方决定如何回退到打印 URL。

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

### 何时使用

当宿主侧插件有操作者必须看到的页面——被服务的 UI、授权页面、报告——时使用它。用 `launchedThroughSsh(ctx)` 守住调用，让远程启动打印 URL 而不是在服务器上打开浏览器；浏览器侧的包永远不需要它。

### 入口

```text
import { launchedThroughSsh, openBrowser } from '@deepseek-ai/dsh-host-browser-open'

if (!launchedThroughSsh(ctx)) {
  await openBrowser(url) // resolves once the platform opener has the URL; rejects with the helper's reason
}
```

`openBrowser` 在辅助进程把 URL 交给平台打开器之后结算，在 Windows 上这意味着等待操作系统启动器接受它。它以辅助进程的第一行 stderr 拒绝，若辅助进程没有输出则以退出码拒绝，且绝不同步抛出。`launchedThroughSsh` 只从启动环境的进程层读取 `SSH_CONNECTION` 与 `SSH_TTY`，因此项目 `.env` 中的陈旧值不算数。确切约定见 [`src/index.ts`](src/index.ts)。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

辅助进程是一段单行 Node 程序，导入维护中的 `open` 包并转发 `process.argv[1]`；它在 subprocess 包的 `scrubbedParentEnv()` 之下运行，因此凭据形态的变量与 `DSH_*` 变量绝不会到达浏览器集成。父进程收集辅助进程的 stderr，在零退出时转发，并把非零退出或 spawn 错误转换为拒绝原因。

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | `launchedThroughSsh`、辅助程序、`openBrowser` |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Web app 组合包](../../bundle/web-app/README.zh.md)——打开带令牌 GUI URL 的启动交接。
- [登录命令](../../credentials/command-login/README.zh.md)——打开提供方页面的登录 surface。
- [子进程 seam](../../subprocess/subprocess/README.zh.md)——拥有辅助进程运行所用的凭据剔除环境。
- [启动环境](../../util/launch-environment/README.zh.md)——SSH 守卫读取的分层快照。

-----

<a id="model-experience"></a>
## 模型体验

无，因为本库只在宿主上打开页面，不注册任何面向模型的内容。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制说明调用方得到的交接语义。它们是当前包约束。

- **成功意味着已交接，而非已显示**——promise 在平台打开器接受 URL 时结算；浏览器随后渲染页面失败不会被报告。
- **SSH 是唯一的远程信号**——没有 SSH 变量的容器或远程桌面启动仍会在宿主上打开浏览器。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** No companion is published. 本库每次调用只执行一个宿主动作，不拥有任何事件流或可变关系。
