# Bayes Canvas Platform Strategy

Bayes Canvas starts as a local-first web app. The source artifact is a `ModelDocument` plus a separate `LayoutDocument`, so the same model can later be opened by a CLI, desktop shell, Git workflow, or MCP adapter without making React Flow state the contract.

## Adoption Order

1. Local-first Web/PWA: default authoring surface, offline-capable, no model upload required.
2. Portable `.bayescanvas`: Git-friendly folder contents with shareable archive export.
3. CLI: `lint`, `migrate`, `diff`, and `handoff` for CI and review workflows.
4. Tauri desktop shell: native filesystem and Git operations after the core API is stable.
5. Git integration: semantic diff and receipt tracking before collaboration.
6. Collaboration: only after transaction log, undo, import validation, and semantic conflicts are stable.
7. VS Code extension: language-service style review of the same ModelDocument.
8. MCP adapter: thin wrapper around core resources and tools.

## Responsibility Boundaries

- Web UI edits authoring data and layout, then compiles to diagnostics and handoff previews.
- CLI uses the same schema, migration, compiler, capability report, and handoff code.
- Desktop may add native file access, but must not introduce a second model format.
- MCP exposes model, diagnostics, math, decision log, patch preview, and handoff build operations; it does not auto-apply AI changes.

## Non-Adoption Conditions

- Do not add CRDT or realtime collaboration before undo/redo and semantic diff are stable.
- Do not make desktop the source of platform-specific model behavior.
- Do not expose arbitrary plugin execution before block contracts and validation coverage are explicit.
