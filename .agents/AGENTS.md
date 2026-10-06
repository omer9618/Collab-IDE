# Custom Rules

## Git & Safety
- ALWAYS create a new git branch before making any code changes. NEVER push directly to `main`.
- Use descriptive branch names (`feat/…`, `fix/…`, `refactor/…`) and small, focused commits with clear messages explaining *why*, not just *what*.
- NEVER run destructive commands (`rm -rf`, `git reset --hard`, `git push --force`, dropping tables, overwriting files) without explicit confirmation. State exactly what will be lost first.
- NEVER commit secrets, API keys, `.env` files, or credentials. If you spot one already in the repo, flag it immediately.

## Understand Before Acting
- Read the relevant existing code, docs, and conventions BEFORE writing anything. Match the project's existing style, structure, naming, and patterns rather than imposing your own.
- If a requirement is ambiguous or has multiple valid interpretations, ask one focused question or state your assumption explicitly. Never silently guess on something that changes the outcome.
- Before changing anything, identify what depends on it (callers, imports, tests, configs, other services). Impact analysis comes first.

## Proactive Optimization & Regression Prevention
- When verifying if a requirement is already implemented, do not stop at surface-level compliance. Analyze the implementation for optimal, resilient design (edge cases, performance bottlenecks, scale).
- Any "superior" improvement MUST be isolated and guaranteed not to disrupt existing functionality or other established requirements.
- Separate "required fixes" from "optional improvements" in your reports. Never bundle unrequested refactors into a requested change without flagging them.

## Code Quality
- Handle edge cases explicitly: null/undefined, empty inputs, large inputs, concurrency, network failure, timeouts, and malformed data.
- Validate and sanitize all external input. Assume user input is hostile (injection, XSS, path traversal, SSRF).
- Fail loudly and meaningfully. No swallowed exceptions, no empty `catch` blocks, no vague errors. Errors should say what failed and why.
- Prefer simple, readable solutions over clever ones. Don't over-engineer, and don't add abstractions, dependencies, or config until there's a real need.
- Avoid new dependencies unless clearly justified. Check maintenance status, size, and license first, and say why it's needed.
- Don't leave dead code, commented-out blocks, stray debug logs, or unresolved TODOs behind.

## Performance & Scale
- Watch for N+1 queries, unbounded loops, missing pagination, missing indexes, unnecessary re-renders, and memory leaks.
- State the complexity or scaling implications of any non-trivial algorithm or query you write.
- Don't prematurely optimize, but never ship something that obviously breaks at 10x load.

## Security
- Apply least privilege everywhere: DB roles, API scopes, file permissions, CORS, IAM.
- Never trust the client. Enforce authentication, authorization, and validation server-side.
- Hash passwords with a modern algorithm (bcrypt/argon2). Never roll your own crypto.
- Flag any security concern you notice, even if it's outside the current task.

## Testing & Verification
- Run existing tests before AND after your changes. Never claim something works without running it.
- Add or update tests for new behavior, bug fixes (a test that fails before the fix, passes after), and edge cases.
- Run the linter, type checker, and build. Don't hand over code that doesn't compile or pass CI.
- If you can't run or verify something, say so clearly. Never present untested code as confirmed working.

## Honesty & Communication
- Never fabricate APIs, functions, flags, library behavior, or file contents. If unsure, check the docs or the code, or say "I'm not sure."
- Report outcomes truthfully, including failures, partial completions, and things you skipped. No glossing over problems.
- Push back when a requested approach is flawed. Explain the risk, offer a better alternative, and let the user decide.
- Keep summaries short and precise: what changed, why, how it was verified, and any risks or follow-ups.
- Stay scoped to what was asked. Mention nearby issues you noticed, but don't fix them unprompted.

## Documentation & Maintainability
- Update README, docs, comments, API specs, and changelogs affected by your change.
- Comment the *why* behind non-obvious decisions, not the *what* the code already says.
- Keep changes reversible: small diffs, backward-compatible where possible, with migrations and rollback paths for schema or data changes.

## Data & Infrastructure
- Take a backup or confirm one exists before any migration or bulk data change. Test migrations on non-production data first.
- Never touch production resources, real user data, or paid external services without explicit approval.
- Make operations idempotent where possible so retries are safe.
