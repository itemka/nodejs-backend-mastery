# Change Discipline

Use this rule when editing code, docs, tests, config, or automation.

- Keep the diff focused on the requested task.
- Do not make unrelated refactors, renames, formatting sweeps, or dependency changes.
- Do not upgrade dependencies unless the task requires it or the current version blocks the work.
- Do not perform large rewrites without an explicit request.
- Prefer minimal diffs that preserve existing behavior outside the requested scope.
- Preserve public APIs, response shapes, event formats, exported names, and configuration keys unless the task requires changing them.
- Match existing file organization before adding new abstractions.
- Keep compatibility and migration impact visible when behavior changes.
- Stop and report before risky migrations, destructive data changes, force pushes, broad deletes, or commands that can overwrite user work.
- If new information shows the requested change is unsafe or much larger than expected, pause and explain the trade-off before continuing.
