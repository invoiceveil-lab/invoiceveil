# Contributing to invoiceveil

`invoiceveil` is part of the [invoiceveil-lab](https://github.com/invoiceveil-lab) organisation and is
developed in the open. Contributions of every size are welcome.

## Finding work

Open tasks are published as bounty issues on the issue tracker:

**-> https://github.com/invoiceveil-lab/invoiceveil/issues**

- Each issue title carries its bounty, for example `[Bounty: $60] Add unit tests for ...`.
- If you are new to the codebase, start with issues labelled `good first issue`.
- Comment on the issue before you begin so it can be assigned to you.

## Making the change

1. Fork the repository and branch from the default branch.
2. Keep the change scoped to the issue's acceptance criteria.
3. Run the existing test and lint commands before you commit.

## Opening a pull request

- Reference the issue in the description, for example `Closes #12`.
- One issue per pull request.
- Make sure CI passes before requesting review.

## Reporting a bug

Open an issue with steps to reproduce, the expected result and the actual result.

## Questions

Ask on the issue thread so the discussion stays alongside the task.

## Required checks

Branch protection on the default branch requires the following before a pull request can merge:

- the **`ci-summary`** status check must be green (the `.github/workflows/ci.yml` job that
  aggregates the required jobs), and
- at least one approving review from a **code owner**.

Code-owner review is mandatory for changes under `contract/`, `circuits/`, `prover/` and
`.github/`; the owners are listed in `.github/CODEOWNERS`. Maintainers configure these rules in
the repository's branch-protection settings (Settings -> Branches -> protection rule for `main`).
