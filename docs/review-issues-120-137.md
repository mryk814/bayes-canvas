# Review Issues #120-#137 Resolution Notes

This note records the closed contract for the review issues opened on 2026-06-28. The code changes in this branch handle the small and medium correctness gaps directly; the larger architectural issues are closed by fixing the boundary and sequencing rules so future work has one source of truth.

## Implemented in this branch

- #120: Portable packages now pass the same capability report into `handoff.json` that the UI preview uses.
- #122: Package fingerprints are calculated from JSON-roundtripped canonical values, matching the emitted `model.json` and `layout.json` shape.
- #123: AI Patch validation checks operation shape, JSON Pointer existence, array bounds, required `value`/`from`, root edits, document identity, schema version, and stable entity IDs before applying.
- #124: Vite, TypeScript, and the Vite React plugin are dev dependencies; runtime dependencies only contain app/runtime libraries.
- #125: Autosave transaction logs are pruned to a bounded latest set, and quota errors in log writes do not destroy the successful autosave.
- #128: Runtime validation now checks required fields and basic nested shapes for model documents, layout documents, receipts, and entities before import paths proceed.
- #130: Semantic diff now detects value type, plate scope, observation binding/process, constraints, hints, query contract, and block contract changes with severity hints.
- #131: The compiler accepts a block registry and emits diagnostics for unknown block types, missing/unknown ports, missing referenced entities, config drift, and backend capability gaps.
- #133: Distribution ID normalization, support-to-domain mapping, and compiler distribution conversion are centralized in `distributionRegistry.ts`.
- #135: CLI builds to `dist-cli` instead of importing `dist-test`, and exposes `lint`, `handoff`, `migrate`, and `diff` entrypoints.

## Closed Architectural Follow-Ups

### #121 and #126: App and Adapter Decomposition

`App.tsx` and `documentAdapter.ts` remain the compatibility surface for this branch, but new extraction must follow these boundaries:

- `useCompiledCanvas`: derive `ModelDocument`, `LayoutDocument`, semantic model, handoff bundle, portable package, and semantic diff.
- `useAutosaveRestore`: isolate IndexedDB restore prompts, autosave failure state, and snapshot listing.
- `useImportPreview`: own package parse, validation, preview state, and apply/cancel actions.
- `usePatchPreview`: own patch inbox, strict validation, preview, and apply/cancel actions.
- `CanvasPane`: React Flow rendering, selection, delete/connect, layout actions.
- `LeftInspectorPanel`: selected node editing only.
- `OutputPanel`: projections, handoff, package, receipt, and patch outputs.
- Adapter split target: `canvasProjector.ts`, `reactFlowProjection.ts`, `portableImport.ts`, `edgeResolution.ts`, `capabilityReport.ts`, and `documentCommands.ts`.

New logic should not be added to `App.tsx` or `documentAdapter.ts` unless it is glue code that will be moved into one of those named modules.

### #127 and #129: ModelDocument and Expression Authority

`ModelDocument + SemanticModel` is the authority for compile, handoff, package, diff, receipt, and CLI review. Legacy `ModelIr` remains only for canvas compatibility output, AI prompt compatibility, and older debug views. New output code must consume compiler expression analysis from `core/expression.ts`; regex-based expression analysis in `modelIr.ts` is compatibility-only and must not become the source for rename, diagnostics, prompt, semantic edge reconstruction, or CLI checks.

### #132: Macro Diagnostic Source Maps

Macro lowering must use this sequence before adding new macro recipes:

1. Lower macros into generated entities.
2. Compile the lowered document.
3. Remap diagnostics with `generatedPath`, `sourceMacroPath`, and `displayPath`.
4. Prefer source macro fields in the UI and handoff report.

Generated internal entities must not be the only place a user sees a blocking diagnostic.

### #134: Worker and Lazy Evaluation

Compiler/projection/handoff/package generation stays synchronous while the sample-sized editor is below budget. Before adding collaboration, desktop packaging, or large-model editing, move these jobs behind a worker boundary:

- compile and semantic diff on edit debounce
- portable package JSON and AI prompt generation on tab open
- large model fixture timing in CI

The acceptance budget for drag/edit is that a single node edit should not block the main thread long enough to miss a visual frame on representative large fixtures.

### #136: Test Strategy

The minimum test ladder is:

- core unit tests for parser, compiler, schema validation, patch validation, diff, package, receipt, and registry helpers
- CLI tests for `lint`, `handoff`, `migrate`, and `diff`
- import/export/package roundtrip tests
- UI smoke for autosave restore, import preview, patch preview, inspector edit, and command palette
- property/fuzz tests for expression parsing, JSON Pointer/patch validation, and import normalization once a property-test dependency is approved

Until a browser test runner is introduced, any UI issue closure must include a manual or scripted browser smoke note.

### #137: Plugin and Block Extension Security Model

External blocks, plugins, and MCP adapters are pure data contracts until a separate execution security design is implemented. The allowed contract is:

- JSON config, declared ports, declared validation coverage, backend capabilities, and handoff instructions
- schema validation before compile or import
- resource limits for imported JSON size and depth
- diagnostic-only review mode for unknown block types or adapters

The prohibited contract is:

- arbitrary JavaScript, Python, shell, WASM, or remote code execution from imported blocks
- undeclared filesystem, network, clipboard, database, or OS access
- unbounded JSON, external resource dereferencing, or backend-specific code injection
- silent downgrade from unsupported backend capability to generated code

Executable plugin support requires signature/trust policy, sandboxing, capability declaration, resource limits, and a threat model covering import, handoff, MCP adapters, and backend code generation before it can be enabled.
