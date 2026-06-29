# Bayes Canvas Security Threat Model

Bayes Canvas treats imported models, external blocks, plugin payloads, MCP adapter payloads, receipts, and AI patch proposals as untrusted data. Import and handoff boundaries accept JSON contracts only.

## Trust Boundaries

- Import: `previewPortablePackageImport` rejects unsafe fields before normalization, migration, schema validation, compile, or projection.
- Handoff: `compileModel` and capability reports mark unknown or unsupported blocks as diagnostic-only for review or blocking for backend generation.
- MCP/plugin adapter: external block config is pure JSON data. It cannot declare code execution or OS, filesystem, network, clipboard, database, process, credential, URL, WASM, shell, Python, or JavaScript access.
- Backend generation: generated code is never produced from unknown external blocks silently. Unsupported target capabilities block handoff or appear as explicit warnings.

## Enforced Controls

- JSON size and depth are checked with `assertJsonComplexity`.
- ModelDocument, LayoutDocument, ImplementationReceipt, and AiPatchProposal are runtime-validated with path-bearing errors.
- External contracts are scanned by `validateExternalDataContract`.
- Unknown blocks are diagnostic-only in review target and blocking for backend targets.
- Macro lowering diagnostics keep `generatedPath`, `sourceMacroPath`, and `displayPath` so users edit source macro fields rather than generated entities.

## Prohibited Input

- Executable code fields: JavaScript, Python, shell, WASM, command, eval, loader, hook, or binary payloads.
- Remote URL dereference.
- Filesystem, network, clipboard, database, OS, process, environment, token, credential, plugin, or MCP access declarations.
- Unbounded JSON, excessive depth, excessive size, or backend-specific code injection.

Regression fixtures in `app/test/core.test.mjs` cover malicious imports, unknown blocks, unsupported backend capability, nested schema errors, and macro diagnostic remapping.
