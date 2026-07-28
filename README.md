# Bayes Canvas

Visual Bayesian statistical modeling workbench.

The goal is to make complex Bayesian models easier to design, inspect, export, and implement in PPLs such as PyMC, NumPyro, Stan, and Turing.jl.

## Core idea

Bayes Canvas keeps the compiled `ModelDocument` and `LayoutDocument` as the portable source of truth, with the visual graph as the editing projection:

```text
Visual graph → ModelDocument + LayoutDocument → View projections → Review / Package / Handoff → Implementation receipt
```

Canvas, Story, Equations, Structure, and Contract are synchronized projections of the same canonical document. They do not store independent semantic state.

The current semantic coverage and the distinction between distributions, observation processes, structural blocks, and constraints are documented in [`docs/model-coverage.md`](./docs/model-coverage.md).

## MVP scope

- Node-based visual model editor
- Variables, priors, deterministic expressions, likelihoods, and plates
- Shape/index awareness
- Three-stage workflow for building, reviewing, and handing off a model
- Multi-view projections for canvas editing, generative story, equations, structure, and contract review
- Model IR export as JSON/YAML
- AI implementation prompt export
- AIの返答をそのまま貼り付けられるportable package / raw ModelDocument import
- role・shape・欠測を含むデータ契約からのDataノード生成
- 名前付きモデル案の保存とsemantic diff比較
- 診断からの差分確認付きquick fixとUndo
- prior predictive設計チェックと外部AI向け検証prompt
- 実装receiptのfingerprint照合
- IndexedDB autosave restore prompt for local-first recovery
- PyMC/NumPyro code generation target later

## Workflow

The header keeps the current task explicit:

1. **組む** — add and edit model elements on the canvas.
2. **確認** — inspect diagnostics, assumptions, and the compiled outline without losing canvas context.
3. **渡す** — export the canonical document or prepare an implementation prompt. NumPyro is the default prompt target.

Use **新規・テンプレート** to start from an empty canvas, choose a teaching template, or reopen a saved snapshot. **スナップショット** stores named checkpoints in the browser. Autosave remains separate and is offered as a recovery action after reloading.

外部AIとの往復、モデル案比較、診断修正、prior predictive、実装receiptは
[`docs/model-workbench.md`](./docs/model-workbench.md) にまとめています。

## Prototype stack

- Vite + React + TypeScript
- React Flow for the visual graph editor
- Zod for validating model IR
- YAML export via `yaml`

## Development

### Windows: easiest launch

Double-click [`start-bayes-canvas.cmd`](./start-bayes-canvas.cmd). On the first launch it installs the locked dependencies, starts Bayes Canvas, and opens the browser automatically. Keep the terminal window open while using the app. Press `Ctrl+C` in that window to stop it.

The same launcher is available from PowerShell:

```powershell
.\start-bayes-canvas.cmd
```

### Command-line launch

Install dependencies once:

```powershell
npm.cmd --prefix app ci
```

Then start the app. The browser opens automatically, normally at `http://127.0.0.1:5173/`:

```powershell
npm.cmd start
```

Press `Ctrl+C` to stop it.

For development without automatically opening a browser:

```bash
npm run dev
```

The root scripts delegate to `app/`, so `npm run dev`, `npm run build`, and `npm run preview` can be run from the repository root.

## Validation

Run these checks from the repository root before handing off changes:

```bash
npm run typecheck
npm run test
npm run cli:lint:sample
npm run cli:handoff:sample
npm run build
```

`cli:lint:sample` compiles the hierarchical regression sample and fails on blocking diagnostics. `cli:handoff:sample` builds the PyMC handoff bundle from the same sample, which keeps the CLI export path covered by CI.

## First example

Hierarchical regression:

```text
alpha_bar ~ Normal(0, 2)
tau_alpha ~ HalfNormal(1)
alpha[j] ~ Normal(alpha_bar, tau_alpha)
beta ~ Normal(0, 1)
sigma ~ HalfNormal(1)
mu[i] = alpha[group_id[i]] + beta * x[i]
y[i] ~ Normal(mu[i], sigma)
```
