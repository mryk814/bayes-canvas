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

Package import is a preview flow. The app validates `model.json`, `layout.json`, and `canvasEdges.json`, checks that `layout.modelDocumentId` matches `model.documentId`, runs compiler diagnostics, and only replaces the current canvas after the user applies the preview. Invalid packages must leave the current canvas unchanged. The preview shows node count, link count, diagnostics, and whether links came from `canvasEdges.json`, the legacy model extension, or semantic reconstruction.

External AI conversion should output the same portable package shape and preserve source provenance in ModelDocument notes or `decisions.jsonl`. A converter must preserve semantic dependencies in the model expressions, visual links in `canvasEdges.json`, layout positions in `layout.json`, observed bindings through `observedDataId`, and index mappings through plates/axes. If visual links cannot be recovered from the source model, the converter should derive them from semantic dependencies and add a warning note instead of returning an edge-free package.

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
