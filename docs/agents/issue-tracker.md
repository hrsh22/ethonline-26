# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`.
- **Read an issue**: `gh issue view <number> --comments`.
- **List issues**: `gh issue list --state open`.
- **Comment on an issue**: `gh issue comment <number> --body "..."`.
- **Apply or remove labels**: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`.
- **Close an issue**: `gh issue close <number> --comment "..."`.

Infer the repository from `git remote -v`; `gh` does this automatically inside the repository.

## Pull requests as a triage surface

**PRs as a request surface: no.**

GitHub shares one number space across issues and pull requests. Resolve ambiguous references with `gh pr view <number>`, then fall back to `gh issue view <number>`.

## Publishing and fetching tickets

When a skill says “publish to the issue tracker,” create a GitHub issue.

When a skill says “fetch the relevant ticket,” run:

`gh issue view <number> --comments`

## Wayfinding operations

- A map is one issue labelled `wayfinder:map`.
- Child tickets use `wayfinder:<type>` labels.
- Use GitHub sub-issues and native issue dependencies where available.
- If those features are unavailable, use task lists and `Blocked by: #<number>` lines.
- Claim work with `gh issue edit <number> --add-assignee @me`.
