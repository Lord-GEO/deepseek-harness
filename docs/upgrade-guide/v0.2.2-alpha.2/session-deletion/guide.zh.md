---
kind: upgrade-guide
description: 自定义 Session 持久化后端必须实现永久日志删除。
---

# 会话删除

[English](guide.md) | 中文

## 变更

`SessionPersistence` 新增必需的 `deleteMany(ids)` 方法及单会话便捷方法 `delete(id)`。自定义子类必须实现此方法。JSONL 后端已提供实现；其配置和现有 Session 文件无需迁移。

GUI 提供带确认的永久删除操作。`session.delete` 删除静止的普通 Session 及其子智能体后代。独立分叉的会话、共享附件和项目文件会保留。必须先停止正在运行的工作。

## 迁移

1. 为每个自定义后端实现 `SessionPersistence.deleteMany(ids)`。在移除任何日志前认领每个目标的写入排他；竞争时以 `SessionAlreadyOwnedError` 拒绝。按传入的 Session 顺序删除所有已存储代际，并把缺失身份视为成功的空操作。后续 I/O 失败时，通过 `SessionDeletionError` 报告已知移除。
2. 成功删除日志后发出 `session-persistence/deleted`。Session 运行时释放、Workspace 成员清理和派生索引清理由调用方的生命周期所有者负责。
3. 验证 `stat(id)` 返回 `undefined`、`list()` 不含该身份，且其他写入方会阻止删除。验证删除后前代不会重新出现。

生成的 API 见[持久化参考](../../../subsystems/persistence.zh.md)。
