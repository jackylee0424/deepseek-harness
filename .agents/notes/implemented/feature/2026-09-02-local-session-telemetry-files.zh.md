# Agent Note: 本地会话遥测文件

Status: implemented

[English](2026-09-02-local-session-telemetry-files.md) | 中文

## 问题

[移除远程遥测](../simplification/2026-09-02-remove-remote-telemetry.zh.md)删除了唯一的 `SessionTelemetryBackend` 实现，使 `dsh-session-telemetry` 沦为没有任何随附组合会用到的捕获 seam：记录投影出来却无人接收，`/feedback` 报告共享未配置，而仓库所有者仍希望会话遥测在本机可用，以便自行检查并喂给自己的工具。权威会话日志已经持久化了每个事件，但它按项目组织、可能被压缩，且既不携带严重级别也不携带运维标记，因此不能直接替代一份扁平的遥测流。

## 决策

`@deepseek-ai/dsh-session-telemetry-file` 是会话遥测 seam 的随附 Service Provider，`dsh-base` 以 `session-telemetry-file` 配置项挂载它。

- 后端以 `live` 捕获模式组装 `SessionTelemetryCoordinator`，把每条记录——每个已投影的会话事件，加上 `agent-error` 与 `shutdown` 运维标记——以一行 JSON 追加到 `<root>/<session id>.jsonl`，其中 `root` 默认为解析后的 harness home 下的 `telemetry`，也是本插件唯一的配置。会话 id 映射为文件系统安全的文件名主干；没有 `session.id` 属性的记录落入 `unscoped.jsonl`。
- 每个会话一条追加流，按需打开并在该会话的 `shutdown` 标记处关闭；插件销毁会结束每条打开的流，并且只在各条流都关闭后才结算，因此标记会在进程退出前落盘。无法成为目录的 root 在插件加载时失败；运行期的流失败会被记录、丢弃该条记录，该会话的下一条记录会打开一条新的流。
- seam 的 `SessionTelemetrySharingStatus` 新增 `local`，由后端披露，并由 `/feedback` 渲染为 `Session records are captured locally and never shared.`
- `dsh-sdk-minimal` 仍不含遥测，与其文档化的排除列表一致。

## 验证

包的单元测试层通过会话存储驱动真实协调器，并固定按会话文件、shutdown 标记顺序、严重级别映射、默认 root 解析、主干清理、unscoped 文件、非目录 root 的加载期失败以及流错误后的恢复；一个真实 Loader 组合从 `cordis.yml` 挂载该配置项。`dsh-base` 组合包测试断言该配置项，反馈命令的单元测试固定 `local` 句子，`/feedback` 的 Web golden 通过随附组合包固定同一句子。

## 考虑过的替代方案

**只依赖已持久化的会话日志。** 拒绝，因为所有者要求的是遥测捕获而不只是持久化：JSONL 会话存储按项目组织、可能经过 Zstandard 压缩，且缺少 seam 的严重级别与运维标记，而 seam 否则仍会是死代码。

**按进程而非按会话写一个文件。** 拒绝，因为按会话的文件把增长限定在会话内、随会话一起删除，且读取一次对话无需过滤；进程级文件实现更简单但使用更困难。

**复用 `disabled` 或 `full` 作为披露状态。** 拒绝，因为 `full` 读起来像是在共享，`disabled` 读起来像是什么都不捕获；确认文本必须说明记录已捕获且留在本地，这需要一个独立的词汇项。

**缓冲记录并按定时器写入。** 拒绝，因为 Node 的追加流已经在热路径之外批量写入，定时器只会在没有可测收益的情况下增加一个丢失窗口。

## 后果

每个基于 base 的 profile 默认把会话遥测写入 `$DSH_HOME/telemetry/`；文件不轮转地增长，并原样携带消息文本、工具参数与结果以及会话 `cwd`，因此需要脱敏的部署方挂载 `session-telemetry/record` 规则，不想要任何文件的部署方把该配置项 patch 为 `disabled: true`。没有任何内容会被发送，`/feedback` 确认也如此说明。想要采集器的部署方用自己的后端替换该配置项；seam 约定保持不变。
