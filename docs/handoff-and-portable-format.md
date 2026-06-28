# Handoff, Patch, and Portable Format

## Handoff Bundle

The app now exports a contract-backed bundle from the same `ModelDocument` used by compiler diagnostics. The bundle contains:

- manifest with schema, compiler version, target profile, timestamp, SHA-256 fingerprint algorithm, and specification fingerprint
- model document
- semantic symbols and dependency edges
- diagnostics
- unresolved review questions
- backend capability report
- implementation contract requiring entity ID preservation and returned implementation mapping

Prompt text remains useful for copy/paste, but it is no longer the only handoff artifact.

`manifest.specificationFingerprint` is the SHA-256 hex digest of the stable, sorted `ModelDocument` JSON input. Implementation receipts should echo that value in `inputSpecificationFingerprint`; if it differs from the current bundle, the receipt must be treated as coming from another specification until reviewed.

## AI Patch Proposal

AI changes must be represented by `specs/ai-patch-proposal.schema.json`. The required flow is:

1. validate proposal schema
2. apply JSON Patch in a sandbox copy
3. compile both before and after
4. show diagnostic changes and semantic diff
5. commit only after user approval

The proposal schema intentionally targets stable JSON Pointer paths and a base revision so whole-document regeneration does not erase entity IDs or layout.

## Portable `.bayescanvas`

The portable format is a folder or archive with these entries:

```text
model.bayescanvas/
  manifest.json
  model.json
  layout.json
  canvasEdges.json
  decisions.jsonl
  attachments/
```

`model.json` is the strict `ModelDocument`. `layout.json` is the `LayoutDocument`; changing coordinates must not create semantic diff. `canvasEdges.json` is a first-class visual projection file so external converters cannot accidentally drop the canvas graph. It contains an array of `{ id, from, to, role }` records where `from` and `to` are stable entity IDs from `model.json`. The same array should also be mirrored in `model.extensions["bayes-canvas"].annotationEdges` for older importers. `decisions.jsonl` stores assumptions, warnings, review questions, and implementation notes as append-friendly records.

Package import is a preview flow. The app validates `model.json`, `layout.json` when present, and `canvasEdges.json` when present, checks that `layout.modelDocumentId` matches `model.documentId`, runs compiler diagnostics, and only replaces the current canvas after the user applies the preview. Invalid packages must leave the current canvas unchanged. The preview shows node count, link count, diagnostics, and whether links came from `canvasEdges.json`, the legacy model extension, or semantic reconstruction.

For AI-generated imports, the app also accepts a single JSON object with nested values instead of stringified virtual files:

```json
{
  "packageVersion": "bayes-canvas-ai-import@1",
  "model": { "schemaVersion": "1.0.0" },
  "layout": { "schemaVersion": "1.0.0" },
  "canvasEdges": [{ "id": "a-to-b", "from": "a", "to": "b", "role": "expression" }],
  "decisions": []
}
```

`layout` is optional for AI imports. When it is missing, Bayes Canvas generates display positions from `entityOrder`. `canvasEdges` is also optional; when it is missing, the app first uses `model.extensions["bayes-canvas"].annotationEdges`, then reconstructs visual links from semantic dependencies. The importer also accepts `files` as either a map or an array of `{ path, content }` entries, and `model.json` / `layout.json` values may be real nested JSON values rather than escaped JSON strings.

External AI conversion should preserve source provenance in ModelDocument notes or `decisions`. A converter must preserve semantic dependencies in the model expressions, observed bindings through `observedDataId`, and index mappings through plates/axes. Ordinary observed likelihoods should be represented as `random_variable` entities with `role: "observation"` and a distribution so they import as editable likelihood blocks. `factor` is reserved for custom potentials or log-density terms that cannot be represented as a standard observed distribution; when a standard `*_lpdf(...)` factor is imported, Bayes Canvas will try to infer an editable likelihood node. Visual links and layout positions are useful when known, but uncertain layout or links should be omitted instead of fabricated; the preview will show generated layout and reconstructed-link warnings.

## CLI Contract

The CLI should be a thin wrapper over the same core functions used by the app:

```bash
bayes-canvas lint model.bayescanvas
bayes-canvas migrate model.bayescanvas
bayes-canvas diff old.bayescanvas new.bayescanvas
bayes-canvas handoff --target pymc model.bayescanvas
```

CI should run schema validation, migration, compile diagnostics, and handoff bundle generation on sample corpora.

## Versioned Macros

Prior recipes and regression components should persist as versioned macro instances:

```ts
interface MacroInstance {
  id: string;
  macroTypeId: string;
  macroVersion: string;
  bindings: Record<string, string>;
  config: Record<string, unknown>;
}
```

Lowering expands macros to generated entities and records a source map from generated IDs back to macro fields. Diagnostics must be displayed against the macro field the user can edit, not only the generated internal entity.
