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
  decisions.jsonl
  attachments/
```

`model.json` is the strict `ModelDocument`. `layout.json` is the `LayoutDocument`; changing coordinates must not create semantic diff. `decisions.jsonl` stores assumptions, warnings, review questions, and implementation notes as append-friendly records.

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
