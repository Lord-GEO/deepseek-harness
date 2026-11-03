# Agent Note: Permanent Session deletion

Status: implemented

English | [中文](2026-11-04-permanent-session-deletion.zh.md)

## Problem

Archiving hides a conversation while retaining its log. Users need a separate operation that removes unwanted histories and reports which related data remains. Deleting only the selected generation can expose a predecessor; deleting a child while another process owns its parent can damage an active conversation.

## Decision

The Session API deletes an ordinary Session and the transitive descendants whose headers explicitly carry `origin: subagent`. Ordinary forks remain independent even when historical headers retain a parent id. Every target passes access and activity checks before API-owned Agent handles are disposed. Foreign runtime owners refuse deletion. The persistence backend claims every target's writer exclusion before removing any log, then deletes descendants before parents and predecessor generations before their selected generation. POSIX synchronizes each removal before proceeding; Windows uses the operating system's unlink completion because Node cannot synchronize directories there. Session directories and POSIX lock files remain to preserve the lock identity.

The controller cleans Workspace membership, archive and pin sets, projection checkpoints, prepared history, and search documents after log removal. Checkpoint removal waits for already-started writes, preventing a final detach checkpoint from recreating the cache. A permanent-deletion event differs from live Session disposal so clients remove cold and subagent history metadata as well. In-flight list mutations replay deletion over older baselines.

Unknown stored identities are successful no-ops. A partial failure reports deleted identities; `cleanupSessionIds` carries them into a retry, but accepts only identities whose histories are absent. Each identity is independently authorized. Shared attachments and project files remain because other conversations can reference them.

This decision supersedes the session-deletion section of the [storage proposal](../../proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.md). That proposal remains active for its separate storage-migration decisions. The [independent-fork decision](../architecture/2026-10-23-independent-session-forks.md) remains authoritative for ordinary forks.

## Alternatives considered

**Delete only the current file.** Rejected because retained predecessors can become visible again.

**Automatically cancel running work.** Rejected because permanent deletion and stopping work have different consequences. The caller stops activity first; the confirmation remains available after refusal.

**Delete attachments with the Session.** Rejected because immutable attachments are shared and no reference-aware garbage collector establishes exclusive ownership.

## Consequences

Deletion is irreversible and requires confirmation with Cancel initially focused. A tree-wide deletion is not a transaction: an I/O failure or crash can leave some descendants removed. API failures report known removals and retryable cleanup; a process crash loses the response and can leave orphaned derived records for operator maintenance. No remaining log is searched through a deleted identity, and independent histories remain readable. Explicit deletion is separate from format migration and does not change Session event schemas or frozen codec generations.

Focused persistence tests cover both encodings, predecessor removal, ownership across backend instances, and batch exclusion before mutation. API tests cover descendant order, independent forks, activity and access refusal, and partial cleanup retries. The recorded-history browser scenario pins confirmation, cancellation, selected-history removal, and reload behavior.
