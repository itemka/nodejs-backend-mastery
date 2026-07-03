# Conventional Commits

Use concise Conventional Commit messages:

```text
type(scope): summary
```

Use the optional scope only when it adds real context.

## Common Types

- `feat`: user-facing feature or new behavior.
- `fix`: bug fix.
- `refactor`: internal restructuring without behavior change.
- `test`: test-only change.
- `docs`: documentation-only change.
- `style`: formatting or code style changes without runtime behavior changes.
- `chore`: maintenance that does not affect runtime behavior.
- `build`: build system, package, or dependency configuration.
- `ci`: CI workflow or automation.
- `perf`: performance improvement.
- `revert`: revert a prior commit.

## Scope Guidance

- Use a package, app, feature, or layer name.
- Keep scopes lowercase and stable, for example `api`, `auth`, `orders`, `shop-mvc-express`, `local-llm-playground`, `docs`, or `agents`.
- Omit the scope when it would be forced or misleading.

## Subject Guidance

- Keep the subject concise; aim for 50 characters or less when it can stay clear.
- Start the summary with a lowercase imperative verb, for example `add`, `fix`, `move`, or `document`.
- Use a lowercase summary and no trailing period.
- Prefer a specific summary over a vague one like `update code` or `fix issue`.

## Backend Examples

```text
feat(api): add order cancellation endpoint
fix(auth): reject expired refresh tokens
refactor(repository): isolate product query filters
test(api): cover validation errors for checkout
perf(cache): batch product lookup requests
```

## Frontend Examples

```text
feat(chat): add retry state for failed prompts
fix(ui): preserve form values after validation error
refactor(client): split message list rendering
test(client): cover disabled submit state
```

## Docs Examples

```text
docs(agents): add reusable review checklists
docs(api): document pagination parameters
chore(docs): reorganize setup notes
```

Use `BREAKING CHANGE:` in the body when a public API, schema, event, or config contract changes incompatibly.
