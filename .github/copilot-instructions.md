# Copilot Instructions

This repository is building a **lightweight Playwright-based Power BI quality suite**.

## Current intent

Prioritize a practical, reusable suite for **any Power BI report** in the workspace, with interactive discovery and per-page visual smoke testing.

Focus on:

1. broken visual smoke checks
2. refresh history health checks
3. schema drift detection
4. fragile source extraction validation
5. duplicate/suspicious model structure checks

Do **not** prioritize:

- advanced RLS scenarios
- large Page Object Model hierarchies
- complex report-specific UI abstraction
- overengineered offline Power BI browser simulation

## Architectural guidance

- Use `kerski/pbi-dataops-visual-error-testing` as the baseline reference for harness shape, but keep the solution simpler where possible.
- Keep the suite compact and configuration-driven.
- Prefer a thin Playwright harness plus metadata helpers over a large framework.
- Treat the suite as two lanes:
  - **metadata lane** for refresh/schema/source/duplicate checks
  - **visual lane** for live enterprise smoke testing

## Repository conventions

- Use the commands in `package.json`:
  - `npm run discover:interactive`
  - `npm run discover:enterprise`
  - `npm run typecheck`
  - `npm test`
- Default local runs should use the committed mock fixtures already in the repo.
- Use `scripts/discover-interactive.ts` for interactive enterprise visual configuration (recommended).
- Use `scripts/discover-enterprise.ts` for non-interactive/CI use (requires `PBI_WORKSPACE_NAME` + `PBI_REPORT_NAME` in `.env`).
- Keep metadata tests runnable in isolated/local environments.
- Keep visual smoke tests enterprise-oriented and avoid pretending local mocks are equivalent to real Power BI rendering.

## Implementation priorities

When adding or changing code, prefer this order:

1. fixture and contract validation
2. metadata parsing and normalization
3. refresh health logic
4. schema signature and drift logic
5. duplicate heuristics
6. enterprise discovery and live visual smoke implementation

## Editing guidance

- Keep the suite generic — no project-specific report names, workspace names, or IDs in code, docs, or README.
- Reuse existing helper functions before adding new abstractions.
- Avoid introducing environment-specific constants directly into tests.
- Keep enterprise secrets, IDs, and URLs out of test logic where practical.
- Only expand the visual lane when real enterprise validation is available.

## Current known status

- Metadata lane is implemented and passing.
- Visual smoke lane is implemented for enterprise embed-based execution and auto-skips until discovery output and credentials are available.
