---
kind: upgrade-guide
description: Custom Session persistence backends must implement permanent log deletion.
---

# Session deletion

English | [中文](guide.zh.md)

## Change

`SessionPersistence` adds the required `deleteMany(ids)` method and the single-Session `delete(id)` convenience method. Custom subclasses must implement it. The JSONL backend includes an implementation; its configuration and existing Session files require no migration.

The GUI offers permanent deletion with confirmation. `session.delete` removes an inactive ordinary Session and its subagent descendants. Independent forks, shared attachments, and project files remain. Running work must be stopped first.

## Migration

1. Implement `SessionPersistence.deleteMany(ids)` in each custom backend. Claim every target's writer exclusion before removing any log; refuse contention with `SessionAlreadyOwnedError`. Remove every stored generation in the supplied Session order and treat missing identities as successful no-ops. Report known removals through `SessionDeletionError` if later I/O fails.
2. Emit `session-persistence/deleted` after successful log removal. Keep Session runtime disposal, Workspace membership cleanup, and derived-index cleanup in the calling lifecycle owner.
3. Verify that `stat(id)` returns `undefined`, `list()` excludes the identity, and another writer prevents deletion. Verify that predecessor generations cannot reappear after deletion.

See the [persistence reference](../../../subsystems/persistence.md) for the generated API.
