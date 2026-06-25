# Bayes Canvas

Visual Bayesian statistical modeling workbench.

The goal is to make complex Bayesian models easier to design, inspect, export, and implement in PPLs such as PyMC, NumPyro, Stan, and Turing.jl.

## Core idea

Bayes Canvas keeps the compiled `ModelDocument` and `LayoutDocument` as the portable source of truth, with the visual graph as the editing projection:

```text
Visual graph → ModelDocument + LayoutDocument → View projections → Review / Package / Handoff → Implementation receipt
```

Canvas, Story, Equations, Structure, and Contract are synchronized projections of the same canonical document. They do not store independent semantic state.

## MVP scope

- Node-based visual model editor
- Variables, priors, deterministic expressions, likelihoods, and plates
- Shape/index awareness
- Multi-view projections for canvas editing, generative story, equations, structure, and handoff contract review
- Model IR export as JSON/YAML
- AI implementation prompt export
- Portable package import with validation preview before replacing current work
- IndexedDB autosave restore prompt for local-first recovery
- PyMC/NumPyro code generation target later

## Prototype stack

- Vite + React + TypeScript
- React Flow for the visual graph editor
- Zod for validating model IR
- YAML export via `yaml`

## Development

```bash
npm install
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
