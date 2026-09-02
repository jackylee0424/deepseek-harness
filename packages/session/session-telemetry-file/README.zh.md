---
description: "随附的本地文件会话遥测后端，面向需要选择按会话 JSONL 遥测在本机的落盘位置、挂载脱敏或读取这些文件的部署方。"
kind: "package-reference"
---

# @deepseek-ai/dsh-session-telemetry-file

[English](README.md) | 中文

## 概述

`dsh-session-telemetry-file` 把会话遥测保留在本机：它是[会话遥测 seam](../session-telemetry/README.zh.md) 的随附后端，把每条捕获的记录——seam 投影出的每个会话日志事件，加上 `agent-error` 与 `shutdown` 运维标记——以一行 JSON 追加到 `<root>/<session id>.jsonl`。没有任何内容会被发送到别处，因此 `/feedback` 确认报告 `Session records are captured locally and never shared.` 当你需要一份扁平、未压缩、按会话划分的记录流来自行检查或喂给自己运行的工具时选择它；会话持久化下的权威会话日志仍是事实来源。记录携带的是 seam 脱敏 waterfall 返回的完整事件数据，因此必须把机密排除在这些文件之外的部署方需要在那里挂载自己的规则。

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

在已挂载 `dsh-session` 的组合中挂载本插件；随附的 `dsh-base` 组合包已为每个基于 base 的 profile 这样做。

### 何时选择它

当会话活动应当以纯 JSONL 形式在本地磁盘上可读——用于调试、审计或你自己运行的采集器——且不需要任何网络传输时选择它。若某个组合除会话存储之外不得写入任何内容，则不要挂载它；此时 seam 没有后端，`/feedback` 确认会报告 `Session sharing is not configured.`

### 最小配置

```yaml
- id: session-telemetry-file
  name: '@deepseek-ai/dsh-session-telemetry-file'
  config:
    root: /var/lib/dsh/telemetry   # optional; defaults to $DSH_HOME/telemetry
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `root` | 解析后的 harness home（`$DSH_HOME`，否则 `~/.dsh`）下的 `telemetry` | 接收每个会话一个 `<session id>.jsonl` 文件的目录；在插件加载时创建 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-session-telemetry-file)是所有可接受字段的详尽来源。

### 磁盘布局

每个会话 id 对应一个文件名主干，其中 `A-Z`、`a-z`、`0-9`、`.`、`_` 与 `-` 之外的每个字符都替换为 `_`；未携带 `session.id` 属性的记录落入 `unscoped.jsonl`。每一行都是一条 seam 记录：`channel`、`time`、`severity`、`attributes`（`session.id`、`event.type`、`event.seq` 以及 seam 附加的会话头部事实）和作为 `body` 的完整事件数据。每个 step 只记录第一条 `assistant/chunk`，因此 `event.seq` 出现间隙是正常现象。会话的 `shutdown` 标记会结束其文件；同一会话 id 之后的记录会通过新的流追加到同一文件。

### 持久性与失败

每个会话的行都经过一条追加流，因此被 `emit()` 接受的记录会在 Node 刷新该流后到达文件；插件销毁会结束每条流并等待各自关闭，shutdown 标记正是由此在进程退出前落盘。无法成为目录的 `root` 会在插件加载时失败。运行期的流失败（目录被删除、磁盘已满）会记录一条警告，该条记录丢失，该会话的下一条记录会打开一条新的流。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释后端的组合方式；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

后端是 seam 协调器之下的薄 sink：捕获、投影、脱敏与 handoff 游标都在 `dsh-session-telemetry` 中，本包只拥有文件布局与流生命周期。它以 `live` 模式组装协调器，因此记录随会话事件的追加而跟进，生命周期标记在会话销毁与插件拆除时捕获。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：root 解析、按会话追加流、shutdown 标记关闭、销毁时排空 |

### 流生命周期

每个文件名主干对应一条 `fs.WriteStream`，在首条记录时打开，并保持打开直到会话的 `shutdown` 标记或插件销毁。失败的流保持已销毁状态并在下一条记录时被替换，因此一次坏写入绝不会阻塞之后的会话。`flush()` 有意不实现：流本身直写，销毁是唯一的排空点。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当后端约定不够用时阅读以下页面。它们从其实现的 seam 逐步进入子系统参考与决策证据。

- [会话遥测 seam](../session-telemetry/README.zh.md)——捕获约定、记录词汇与脱敏 waterfall。
- [会话遥测子系统](../../../docs/subsystems/session-telemetry.zh.md)——能力拆分与类型声明。
- [会话持久化（JSONL）](../session-persistence-jsonl/README.zh.md)——这些文件所投影的权威会话日志。
- [生成的配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-session-telemetry-file)——每个可接受的配置字段及其源声明。
- [本地会话遥测文件决策](../../../.agents/notes/implemented/feature/2026-09-02-local-session-telemetry-files.zh.md)——理由与被否决的替代方案。

-----

<a id="model-experience"></a>
## 模型体验

无，因为后端只把 seam 记录追加到本地文件，不注册任何面向模型的内容。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制说明本地文件保证与不保证的内容。它们是当前包约束。

- **Best-effort 投递**——流失败的记录会连同一条警告一起丢失，而 seam 的游标仍将其标记为已交接；没有重试或暂存。
- **无限增长**——文件从不轮转、压缩或清理；`root` 下的保留策略由部署方负责。
- **不内置脱敏**——未挂载 `session-telemetry/record` 监听器时，文件会原样携带消息文本、工具参数与结果以及会话 `cwd`。
- **主干冲突**——仅在安全字符集之外的字符上有差异的两个会话 id 会共用一个文件。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** No companion is published. 本包的全部输出只是对本地文件的追加，位于所有权威事件流之外，因此不存在可供独立伴生入口观察的事件／数据关系。
