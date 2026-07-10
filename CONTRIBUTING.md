# Contributing

Thanks for helping improve MR Reviewer. This project is a TypeScript CLI that runs locally and talks to GitLab plus local AI CLI tools.

## Local Setup

```bash
npm install
cp .env.example .env
npm test
npm run typecheck
```

Edit `.env` with your own GitLab URL, token, project list, and enabled AI providers. Never commit `.env` or local usage/state files.

## Development Workflow

Use `npm run review` for the interactive CLI and `npm run watch` for the background watcher. Keep module responsibilities narrow:

- GitLab API behavior belongs in `src/gitlab.ts`.
- AI provider execution and prompts belong in `src/ai.ts`.
- Watcher polling/state behavior belongs in `src/watcher.ts`.
- Usage accounting and provider selection belong in `src/usage-tracker.ts`.

When a change affects features, configuration, architecture, prerequisites, or usage, update both `README.md` and `README.pt-BR.md`.

## Validation

Before opening a pull request, run:

```bash
npm test
npm run typecheck
```

Add or update tests in `tests/*.test.ts` for project parsing, provider selection, watcher state, usage tracking, or GitLab behavior. Tests should not call real GitLab instances or real AI CLIs.

## Commit and Pull Request Style

Use short, descriptive commit subjects. Conventional prefixes are welcome, for example:

- `feat: adiciona suporte ao Codex`
- `fix: valida configuracao ausente`
- `docs: atualiza guia de instalacao`

Pull requests should include a clear summary, validation commands run, linked issue or MR when available, and screenshots only when terminal output formatting changes.
