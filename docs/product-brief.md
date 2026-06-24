# Product brief

## Problem

Bayesian statistical modeling becomes hard to reason about when the model contains hierarchical parameters, hyperparameters, deterministic transformations, plates, and non-trivial likelihoods. PPL code is powerful, but code-first workflows make it easy to lose the full model structure.

## Product thesis

A visual modeling environment can make Bayesian models easier to design by treating the model graph, equations, distributions, dimensions, and observations as the primary artifact. PPL code should be generated from a stricter model IR rather than written directly as the source of truth.

## Target users

- Researchers building hierarchical Bayesian models
- Data scientists using PyMC, NumPyro, Stan, or Turing.jl
- Learners who understand model structure visually
- AI-assisted model builders who need precise model specs

## Differentiator

This is not just a GUI for running inference. The product is a model design surface:

- Visual dependency graph
- Plate/index/shape tracking
- Priors, likelihoods, and deterministic formulas as editable objects
- Exportable intermediate representation
- AI-friendly prompt generation
- PPL backends later

## MVP

1. Build a React Flow editor.
2. Represent variables, distributions, deterministic nodes, and plates.
3. Export a strict JSON model IR.
4. Validate missing priors, disconnected nodes, and shape mismatches.
5. Generate an AI prompt for PyMC implementation.
