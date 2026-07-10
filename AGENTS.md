# Repository Guidelines

## Project Structure & Module Organization

This repository is a TypeScript CLI for reviewing GitLab merge requests with local AI CLIs. Source files live in `src/`:

- `src/index.ts`: interactive CLI flow.
- `src/watcher.ts`: background MR monitor.
- `src/ai.ts`: Claude/Gemini process integration and prompt construction.
- `src/gitlab.ts`: GitLab API wrapper.
- `src/projects.ts`, `src/usage-tracker.ts`, `src/display.ts`, `src/types.ts`: configuration, usage accounting, terminal UI, and shared types.

Tests live in `tests/` and mirror the module under test, for example `tests/projects.test.ts`. Documentation is maintained in both `README.md` and `README.pt-BR.md`. Local runtime state such as `.env`, `.llm-usage.json`, and `.watcher-state.json` must stay out of commits.

## Build, Test, and Development Commands

- `npm install`: install dependencies.
- `npm run review`: run the interactive reviewer via `tsx src/index.ts`.
- `npm run watch`: run the background watcher via `tsx src/watcher.ts`.
- `npm test`: run the Node test suite through `tsx --test`.
- `npx tsc --noEmit`: type-check without generating files.

There is no separate build step; `tsx` executes TypeScript directly.

## Coding Style & Naming Conventions

Use TypeScript with two-space indentation and explicit exported types where they clarify module boundaries. Keep filenames lowercase with hyphenated names when needed, matching existing files such as `usage-tracker.ts`. Prefer small modules with clear responsibilities over broad utility files. Keep CLI output centralized in `display.ts` when possible.

## Testing Guidelines

Tests use Node's built-in `node:test` runner. Add or update tests in `tests/*.test.ts` when changing parsing, watcher behavior, provider selection, state handling, or GitLab request logic. Keep tests deterministic by mocking file state and external process/API behavior instead of calling GitLab or AI CLIs.

## Commit & Pull Request Guidelines

Recent history uses concise Portuguese or conventional-style subjects, for example `feat: watcher automático...`, `docs: atualiza...`, and `chore: improve...`. Prefer short imperative summaries with a scope when helpful.

Pull requests should describe the behavior changed, list validation commands run, and link the relevant issue or MR when available. Include screenshots only for terminal output changes where formatting matters.

## Documentation & Configuration Notes

After changes that affect features, configuration, architecture, usage, or prerequisites, update both `README.md` and `README.pt-BR.md`. Never commit real GitLab tokens or local AI CLI credentials; document new environment variables in `.env.example`.
