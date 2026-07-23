# Change Discipline

Use this rule when editing code, docs, tests, config, or automation.

- Keep the diff focused on the requested task.
- Limit incidental cleanup to artifacts made obsolete by the current change. When cleanup is the requested outcome, keep it within that explicit scope and report other cleanup separately.
- Do not make unrelated refactors, renames, formatting sweeps, or dependency changes.
- Do not upgrade dependencies unless the task requires it or the current version blocks the work.
- Do not hand-edit generated or tool-owned files; change them through their owning commands instead — e.g. `docs/architecture/generated/**` via `pnpm run arch:export`, `workspaces/apps/shop-mvc-express/docs/openapi.json` via `pnpm --filter shop-mvc-express openapi:generate`, and `pnpm-lock.yaml` via pnpm commands.
- Every suppression carries a written reason on the same line or directly above it, and stays as narrow as possible — `eslint-disable*`, `@ts-expect-error`, `@ts-ignore`, skipped tests, and ignored check paths. An unexplained suppression is indistinguishable from a rule nobody needs. Committed `.only` tests are prohibited; remove the focus marker instead of explaining it.
- Do not perform large rewrites without an explicit request.
- Prefer minimal diffs that preserve existing behavior outside the requested scope.
- Preserve public APIs, response shapes, event formats, exported names, and configuration keys unless the task requires changing them.
- Match existing file organization before adding new abstractions.
- Keep compatibility and migration impact visible when behavior changes.
- Stop and report before risky migrations, destructive data changes, force pushes, broad deletes, or commands that can overwrite user work.
- If new information shows the requested change is unsafe or much larger than expected, pause and explain the trade-off before continuing.
