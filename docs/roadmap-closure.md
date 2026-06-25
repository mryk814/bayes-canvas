# Roadmap closure notes

## Canonical architecture

`ModelDocument` is the canonical authoring artifact. `LayoutDocument` owns canvas placement and hidden/generated projection state. Legacy `ModelIr` remains a compatibility export for debug, AI prompt text, and older integrations, but user-facing Review, Handoff, Portable Package, fingerprinting, and receipt comparison are driven from `ModelDocument + SemanticModel`.

The practical route is:

1. Canvas UI edits produce node/edge state.
2. `compileCanvas()` projects that state into `ModelDocument` and `LayoutDocument`.
3. Compiler diagnostics, capability reports, handoff bundles, portable packages, and receipts read the compiled documents.
4. Generated observation bindings stay in the model document and handoff bundle, but are hidden from the editable canvas projection.

This keeps the current prototype compatible while making the canonical/derived/compatibility responsibilities explicit.

## ModelDocument migration plan

The next migration boundary is command-shaped editing:

1. Keep `ModelDocument` and `LayoutDocument` as the saved source after autosave/package import.
2. Convert node editor changes into document commands or JSON Patch operations.
3. Treat drag/drop and viewport changes as layout-only updates.
4. Keep legacy canvas JSON as import/export compatibility.
5. Remove duplicate output paths once Math, Review, Handoff, Package, Patch, and Receipt all use the compiled documents.

Every step must keep import, autosave, portable export/import, CLI lint, and handoff sample validation green.

## UX closure

The right pane is organized around Review and Handoff rather than raw debug output:

- Handoff Readiness is the primary status.
- Outline and grouped Review diagnostics provide navigation back to editable fields.
- Math, Review, Handoff, and Advanced split user review from raw internals.
- Design Assistants collect templates, interview entry, schema import, prior help, QoI creation, block boundaries, checklist, decision notes, dependency slices, and patch inbox.
- Advanced keeps raw IR, package, prompt, semantic diff, receipt, and patch internals reachable without making them the default workflow.

## Runtime validation and corpus

Runtime validation now has strict envelope checks for ModelDocument and Implementation Receipt unknown properties. This is intentionally small and dependency-free; it gives the import boundary a durable hook that can later be swapped for full JSON Schema validation.

The corpus starts from the template library and records an expected diagnostics budget per representative model. This creates a regression surface for expanding compiler syntax, diagnostics, and handoff checks without relying on only the initial hierarchical regression sample.

## Storage and restore

Portable package generation now has roundtrip coverage for `model.json` and `layout.json`, and the application keeps undo state around template/schema/assistant actions that replace or add model structure. Autosave remains the reload persistence path; portable package remains the explicit transfer path.
