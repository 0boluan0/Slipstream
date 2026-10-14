# Contributing

Small, evidence-backed changes are welcome.

1. Open an issue for behavior or trust-contract changes before a large implementation.
2. Create a focused branch and preserve the privacy/evidence boundaries in `SPEC.md`.
3. Add a regression fixture for parsing, provenance, verification, or UI state changes.
4. Run `npm test`, `npm run lint`, and `npm run build:renderer` from `slipstream/`; add `npm run test:legacy` when a change touches the frozen action workspace (`src/main/legacy/`). New tests are behavioral `node:test` files in `slipstream/test/`; reading-quality cases belong in `slipstream/eval/`, never in prompts.
5. Do not include real emails, screenshots, credentials, or personal identifiers in tests or issues.

Pull requests should explain the user problem, trust/privacy impact, tests performed, and visible before/after behavior.
