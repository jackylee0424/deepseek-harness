---
description: "持久会话数据平面的包映射：持久化 seam 及其后端、检查点策略、投影、基于日志的标题与本地会话遥测文件。"
kind: "package-group"
---

# session/ — 持久会话数据平面

[English](README.md) | 中文

## 概述

session 组让 agent（智能体）的对话在实时 loop 之外持久可复用：持久化 seam 存储事件日志并在恢复时还原，检查点策略让请求、工具副作用与已完成步骤在下一步动作前持久化，投影向客户端载体提供日志派生的完整值，标题根据会话内容为其命名，遥测则把会话活动捕获到本机的按会话文件中；没有任何随附后端会向本机之外上报任何内容。先挂载随产品交付的 JSONL 持久化 provider，再按部署需要挂载检查点策略以及投影、标题或遥测包。本页是组的映射；每个包 README 负责各自的约定，`session-query/` 是同级独立组，其读取／工具接口独立消费持久化。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

本组分为四个家族：持久存储（持久化 seam、后端、检查点策略）、投影、标题与遥测。每个包 README 负责各自的约定与配置。

### 持久化

| 包 | 职责 | ctx key |
|---|---|---|
| [`session-persistence/`](session-persistence/README.zh.md) | 定义持久会话存储服务，以及每个后端组合的共享写入协调机制 | `ctx.sessionPersistence` |
| [`session-persistence-jsonl/`](session-persistence-jsonl/README.zh.md) | 随产品交付的后端：每会话一份仅追加 JSONL 日志，可选 Zstandard 压缩 | 注册到 `ctx.sessionPersistence` |
| [`session-checkpoint-policy/`](session-checkpoint-policy/README.zh.md) | 让模型请求、顶层工具副作用与已完成步骤在下一步动作前持久化 | 包装 `ctx.llm` 与 `ctx.tools` |
| [`session-log-deepseek/`](session-log-deepseek/README.zh.md) | 把增量规范日志作为可选的官方 DeepSeek 请求元数据上传 | 贡献 `dsh_session_log` |

### 投影

| 包 | 职责 | ctx key |
|---|---|---|
| [`session-projection/`](session-projection/README.zh.md) | 定义并驱动把已提交事件折叠为完整当前值的投影单元 | `ctx.sessionProjections` |
| [`session-projection-cache/`](session-projection-cache/README.zh.md) | 持久化投影检查点，使冷读跳过全量日志加载 | `ctx.sessionProjectionCache` |
| [`session-stats/`](session-stats/README.zh.md) | 通过 `sessionStats` 单元提供全日志会话计数与墙钟时间 | 注册到 `ctx.sessionProjections` |
| [`session-turn-outline/`](session-turn-outline/README.zh.md) | 通过 `turnOutline` 单元提供全日志轮次大纲（轮次号、`turn/start` seq、提示词预览） | 注册到 `ctx.sessionProjections` |

### 标题

| 包 | 职责 | ctx key |
|---|---|---|
| [`session-title/`](session-title/README.zh.md) | 基于日志的会话标题，带确定性回退与一个可选提供方 | `ctx.sessionTitle` |
| [`session-title-llm/`](session-title-llm/README.zh.md) | 供提供方包共享的模型标题生成策略 | 库，不使用 ctx key |
| [`session-title-first-prompt-llm/`](session-title-first-prompt-llm/README.zh.md) | 根据第一条合格的人类消息为会话生成标题 | 注册到 `ctx.sessionTitle` |
| [`session-title-all-prompts-llm/`](session-title-all-prompts-llm/README.zh.md) | 根据所有合格的人类消息为会话生成标题 | 注册到 `ctx.sessionTitle` |

### 遥测

| 包 | 职责 | ctx key |
|---|---|---|
| [`session-telemetry/`](session-telemetry/README.zh.md) | 捕获会话活动并把记录交给已挂载的后端 | `ctx.sessionTelemetry` |
| [`session-telemetry-file/`](session-telemetry-file/README.zh.md) | 把捕获的记录追加到本机的 `$DSH_HOME/telemetry/<session id>.jsonl` | 注册到 `ctx.sessionTelemetry` |

同一时间只允许一个标题提供方注册；未注册时，标题服务保留其确定性回退。下面的子系统页面是各家族后端无关的参考资料。

-----

<a id="related-documentation"></a>
## 相关文档

- [会话持久化子系统](../../docs/subsystems/persistence.zh.md)——后端无关的服务语义、flush 检查点与崩溃恢复。
- [会话投影子系统](../../docs/subsystems/session-projection.zh.md)——投影单元约定与驱动语义。
- [会话标题子系统](../../docs/subsystems/session-title.zh.md)——标题资格、回退与提供方流程。
- [会话遥测子系统](../../docs/subsystems/session-telemetry.zh.md)——捕获、脱敏与后端约定。
- [会话子系统](../../docs/subsystems/session.zh.md)——本组每个包持久化或派生的实时事件日志。

<a id="dev-note"></a>
## 开发备注

无。
