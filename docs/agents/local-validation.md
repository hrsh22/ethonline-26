# Targeted local validation

Use the smallest gate that can prove the changed seam while editing. Run the complete relevant row
once before pushing a finished ticket. Do not run the full workspace suite after each small change.

Inspect the same deterministic classification used by CI:

```bash
git diff --no-renames --name-only origin/main...HEAD | node scripts/ci-changes.ts
```

The classifier fails closed for unknown paths. `true` outputs identify the additional gates selected
for the branch; formatting always runs.

| Change surface                | Fast edit loop                         | Finished-ticket gate                                                                                                                |
| ----------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Documentation only            | `pnpm format:prettier:check`           | Same command                                                                                                                        |
| Public API implementation     | Focused API Vitest files               | `pnpm check` and `pnpm --filter @orbit/api test`                                                                                    |
| Shared API contract/client    | Focused API/web Vitest files           | `pnpm check`, `pnpm --filter @orbit/api test`, `pnpm --dir apps/web test`, and `pnpm --dir apps/web test:production`                |
| Web only                      | `pnpm --dir apps/web test`             | `pnpm check`, `pnpm --dir apps/web test`, and `pnpm --dir apps/web test:production`                                                 |
| Bounded scripts               | Focused Vitest files                   | `pnpm check`, `pnpm test:scripts:ci`, `pnpm --filter @orbit/config test`, and `pnpm --filter @orbit/protocol test`                  |
| Protocol source               | Focused protocol or web Vitest files   | Bounded-script gates plus `pnpm --dir apps/web test` and `pnpm --dir apps/web test:production`; start with `pnpm check`             |
| Contract unit behavior        | Focused `forge test --match-path ...`  | `pnpm check`, all TypeScript/package unit suites, contract unit/gas/invariants, `pnpm test:deployment`, and the web production gate |
| Contract/shared economics     | Focused unit or invariant target       | `pnpm check`, all TypeScript/package unit suites, contract unit/gas/invariants, `pnpm test:deployment`, and the web production gate |
| Deployment, manifest, or hook | Focused config/Foundry/deployment test | `pnpm check`, all TypeScript/package unit suites, contract unit/gas/invariants, `pnpm test:deployment`, and the web production gate |

The production browser matrix is a release gate, not an edit-loop gate. Run a
focused slice while working on a route (`pnpm --dir apps/web test:browser
--only=<label>`) and the full matrix once before a release. See
`docs/operations/browser-matrix.md`.

`pnpm check` remains the complete formatting, lint, type, and generated-configuration gate. The
root `pnpm test` remains available for a final repository-wide audit, but ordinary web and
TypeScript work must use the path-selected commands above. CI preserves full stateful invariants for
contract-affecting work and never moves them behind a non-blocking or nightly-only gate.

The manual CI `web` and `full` profiles exist only for representative timing and workflow diagnosis.
They are not a reason to rerun the expensive profile after every commit.
