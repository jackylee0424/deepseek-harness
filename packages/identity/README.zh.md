---
description: "identity 包组：反馈确认所报告的匿名按 harness home id。"
kind: "package-group"
---

# identity/ — 共享身份

[English](README.md) | 中文

## 概述

identity 组为每个 harness home 提供一个匿名 id，`/feedback` 确认会报告它，因此引用反馈的用户无需暴露身份即可指明自己的安装。没有任何功能会把该 id 发送到别处；部署方自行挂载的遥测后端可以把它附加到自己的记录上。无需配置任何东西：id 会在首次记录反馈时自动出现，并在文件被删除前保持稳定。本组只有一个包；本页是组的映射，包 README 负责细节。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

<a id="packages"></a>
## 包

| 包 | 职责 |
|---|---|
| [`anonymous-user-id`](anonymous-user-id/README.zh.md) | 让每个 harness home 拥有一个匿名 id，反馈确认会报告它，使安装无需识别用户即可被指明 |

<a id="related-documentation"></a>
## 相关文档

- [会话遥测子系统](../../docs/subsystems/session-telemetry.zh.md)——部署方自行挂载的后端可用该 id 扩展的捕获 seam。
- [移除远程遥测](../../.agents/notes/implemented/simplification/2026-09-02-remove-remote-telemetry.zh.md)——为何没有任何随附功能会外发该 id。
- [dsh-command-feedback](../feedback/command-feedback/README.zh.md)——在确认文本中点名该匿名安装的反馈命令。

<a id="dev-note"></a>
## 开发备注

无。
