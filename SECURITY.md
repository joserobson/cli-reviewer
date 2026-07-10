# Security Policy

## Supported Versions

Security fixes are handled on the main development branch unless maintainers define release branches in the future.

## Reporting a Vulnerability

Do not open a public issue for secrets, token exposure, command injection, or GitLab permission problems.

Report privately to the project maintainers with:

- a short description of the issue;
- affected files or configuration;
- reproduction steps;
- potential impact;
- suggested fix, if known.

## Secrets and Local Configuration

Never commit:

- `.env`;
- GitLab Personal Access Tokens;
- real GitLab instance URLs when they are private;
- local AI CLI credentials;
- `.llm-usage.json`;
- `.watcher-state.json`.

Use `.env.example` for documented placeholder values only. GitLab tokens used by this tool should have only the required `api` scope and should be rotated immediately if exposed.
