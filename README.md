# Bayes Canvas

Visual Bayesian statistical modeling workbench.

The goal is to make complex Bayesian models easier to design, inspect, export, and implement in PPLs such as PyMC, NumPyro, Stan, and Turing.jl.

## Core idea

Bayes Canvas keeps the visual model as the source of truth:

```text
Visual graph → Model IR YAML/JSON → PPL code / AI prompt → Inference → Diagnostics back to graph
```

## MVP scope

- Node-based visual model editor
- Variables, priors, deterministic expressions, likelihoods, and plates
- Shape/index awareness
- Model IR export as JSON/YAML
- AI implementation prompt export
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
