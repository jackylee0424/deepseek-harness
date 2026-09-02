# Agent Note: 移除远程遥测

Status: implemented

[English](2026-09-02-remove-remote-telemetry.md) | 中文

## 问题

随附的 `dsh-base` 组合包挂载了 `dsh-session-telemetry-otel`：其默认的 `FEEDBACK_ONLY` 模式会在用户记录 `/feedback` 时把未脱敏的会话记录（消息文本、工具参数与结果、workspace 路径）上传到 `https://harness-telemetry.deepseeksvc.com/v1/logs`，其 `FULL` 模式则把每条已投影的会话事件流式发送到同一端点。与此独立，`dsh-llm-deepseek` 在每个提供方请求上附加按安装稳定的 `x-deepseek-harness-user-id` 标头与持久的 `x-deepseek-harness-session-id` 标头，`plugin-package-inventory-deepseek` 配置项则默认把存活插件包清单加入每个请求正文。每条通道都在模型请求并不需要的情况下向远端上报 harness 用量，而退出上报需要知道三个彼此独立的开关：`DSH_TELEMETRY_DISABLED`、`DSH_TELEMETRY_MODE` 以及清单配置项的 `enabled` 配置。仓库所有者要求在保留本地捕获能力的前提下，移除或禁用所有对外的遥测路径。

## 决策

除了用户自身工作所引发的提供方、web 搜索与 web 抓取请求，以及部署方显式配置的流量之外，没有任何内容离开进程。

- `@deepseek-ai/dsh-session-telemetry-otel` 连同其 `@opentelemetry/*` 依赖、`dsh-base` 配置项、`DSH_TELEMETRY_MODE` 与 `DSH_TELEMETRY_OTLP_URL` 配置以及启动器的 `DSH_TELEMETRY_DISABLED` 启动 patch 一并删除。随附后端是[本地会话遥测文件](../feature/2026-09-02-local-session-telemetry-files.zh.md)中的本地文件提供方，因此 `/feedback` 确认报告 `Session records are captured locally and never shared.`
- `@deepseek-ai/dsh-session-telemetry` 作为本地库保留：Service Definition 与捕获协调器自身不外发任何内容，并继续作为部署方自行挂载后端的扩展点。
- `@deepseek-ai/dsh-anonymous-user-id` 保留，且只有一个随附消费方，即 `/feedback` 确认；`$DSH_HOME/.anonymous-user-id` 只在记录反馈时创建。
- `dsh-llm-deepseek` 既不发送 `x-deepseek-harness-user-id`，也不发送 `x-deepseek-harness-session-id`。提供方无关的 `User-Agent` 归属与 `x-deepseek-harness-compact` 用途标记保持不变，`GenerateOptions.sessionId` 仍会到达请求扩展贡献方。
- `plugin-package-inventory-deepseek` 配置项在 `dsh-base` 与 `dsh-sdk-minimal` 中以 `disabled: true` 交付；由部署 overlay 重新启用。`session-log-deepseek` 保持其现有的默认关闭 `enabled` 配置。
- CI 工作流、测试、fixture 与发布脚本不再设置 `DSH_TELEMETRY_DISABLED`。

## 验证

`dsh-llm-deepseek` 的协议测试断言直接请求与经 Loader 组合的请求都携带 `User-Agent` 且不携带任何身份标头，包括提供了会话 id 的情况。`dsh-base` 组合包测试断言 OpenTelemetry 配置项不存在、本地文件配置项已挂载且清单配置项已禁用。`/feedback` 的 Web golden 固定本地捕获句子。模块图、配置目录、文档图、翻译配对与包不变式门禁验证没有任何存活组合、目录或文档引用已删除的包。

## 考虑过的替代方案

**保留已挂载的后端并以 `DISABLED` 为默认值。** 拒绝，因为生产端点仍会编译进每个 profile，一个环境变量就能重新开启上传，而 OpenTelemetry SDK 及其传输层会在没有任何默认收益的情况下留在每个随附 profile 的运行时闭包中。

**连同遥测 seam、反馈命令与匿名 id 一起删除。** 拒绝，因为它们都不外发任何内容：seam 在挂载后端之前只负责捕获，反馈事件只写入日志，id 只在确认文本中展示给用户。删除它们会改变反馈体验与会话事件词汇，却不会减少任何对外流量，而所有者希望本地遥测仍然可行。

**因 `x-deepseek-harness-session-id` 是按对话而非按安装而保留它。** 拒绝，因为它只为提供方侧关联而存在；补全请求并不需要它，而它仍会把每个请求绑定到一个由 harness 生成的持久身份。

**移除 DeepSeek 请求扩展注册表及两个贡献方。** 拒绝，因为注册表自身不发送任何内容，`session-log-deepseek` 本已是可选启用，而无密钥回放与两套 SDK 快照套件都固定了注册表的接受事务。禁用默认开启的清单配置项即可移除该对外字段，无需改变协议。

## 后果

没有任何随附 profile 会联系遥测 collector，DeepSeek 只会收到产品 `User-Agent` 与补全请求。除非部署方重新启用清单配置项或选择启用 `session-log-deepseek`，提供方侧支持将失去跨会话关联与插件清单。`/feedback` 命令仍在本地记录其事件，但不再能把它释放给 collector。需要远程导出的部署方用自己的 `SessionTelemetryBackend` 实现替换本地文件配置项；seam 的捕获、投影与脱敏约定对其保持不变。以下决策已不再生效并链接至此：[OTel 复活](../feature/2026-07-23-session-telemetry-otel-revival.zh.md)、[导出中的匿名用户 id](../feature/2026-07-31-telemetry-anonymous-user-id.zh.md)、[基础组合包挂载](../feature/2026-07-31-web-telemetry-default-mount.zh.md)、[反馈门控模式](../feature/2026-08-05-feedback-gated-session-telemetry.zh.md)、[默认关闭](../feature/2026-08-10-telemetry-default-off.zh.md)、[反馈门控默认值](../feature/2026-08-25-feedback-gated-telemetry-default.zh.md)、[无缓冲反馈遥测](2026-08-06-buffer-free-feedback-telemetry.zh.md)与 [DeepSeek 请求身份标头](../feature/2026-08-11-deepseek-request-user-id-header.zh.md)。
