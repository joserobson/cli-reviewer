# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## README Maintenance Rule

**After any change that affects features, configuration, architecture, or usage, update both README files before committing:**

- `README.md` — English version
- `README.pt-BR.md` — Portuguese version

Keep in sync: feature list, configuration/`env` section, architecture table (`src/` files), usage examples, prerequisites. Document every new env var in `.env.example` too. Never commit `.env`, tokens, or local state files (`.llm-usage.json`, `.watcher-state.json`, `.webhook-state.json`, `.review-dashboard.json`).

## Commands

```bash
npm run setup       # Interactive .env wizard (src/setup.ts)
npm run doctor      # Validate env / CLI availability (src/doctor.ts)
npm run diagnostic  # System diagnostic; see TROUBLESHOOTING.md (src/diagnostic.ts)
npm run review      # Interactive CLI (src/index.ts)
npm run watch       # Polling watcher (src/watcher.ts)
npm run webhook     # Webhook HTTP server (src/webhook-server.ts)
npm run dashboard   # Local metrics dashboard (src/dashboard.ts)
npm test            # All tests (tsx --test tests/*.test.ts)
npm run typecheck   # tsc --noEmit
```

Run a single test file: `npx tsx --test tests/projects.test.ts`. Filter by name: add `--test-name-pattern="<regex>"`.

No build step — `tsx` runs TypeScript directly. CI (`.github/workflows/ci.yml`) runs `npm ci`, `npm test`, `npm run typecheck` on Node 20. Docker image is Node 22.

## Architecture

CLI tool that reviews GitLab Merge Requests **and GitHub Pull Requests** by spawning local AI CLIs (Codex, Gemini, Claude Code). Three entry modes share one pipeline:

- **Interactive** (`index.ts`) — pick project/provider/MRs, review, then approve/comment/merge.
- **Polling** (`watcher.ts`) — polls every `WATCH_INTERVAL_MINUTES`, detects new MRs against `.watcher-state.json`.
- **Webhook** (`webhook-server.ts`) — `POST /webhooks/gitlab`, `POST /webhooks/github`, `GET /health`. Idempotency via `WebhookEventStore` (`webhook-state.ts`, `processing`→`completed` with a 30-min stale timeout). Optionally reports results back to Agent Hub (`agent-hub-callback.ts`, task id from `X-AgentHub-Review-Task-Id`).

Automatic modes (watch/webhook) go through `automation.ts`, which reads `AUTO_REVIEW_*` safety switches (`getAutoReviewConfig`): post comment, desktop notify, skip drafts, approve/merge on success (both default off). Each run is recorded via `review-store.ts` and shown by `dashboard.ts`.

Key modules:

| File | Role |
|---|---|
| `scm.ts` | Platform dispatcher: routes by `project.platform` (`gitlab`/`github`) to `gitlab.ts` / `github.ts`. **Callers should use `scm.ts`, not the platform modules directly.** |
| `ai.ts` | Provider registry (`AI_PROVIDERS = codex, gemini, code`), env-overridable `*_CMD`/`*_ARGS`, stack-specific prompts, spawns CLI with prompt on stdin, parses JSON |
| `projects.ts` | Parses `GITLAB_PROJECTS` / `GITHUB_REPOSITORIES` (`id:type:label`, comma-separated); falls back to legacy `GITLAB_PROJECT_ID` / `GITLAB_API_PROJECT_ID` |
| `usage-tracker.ts` | Monthly per-provider usage + `selectProvider()` |
| `types.ts` | Shared types (`ProjectConfig`, `MergeRequest`, `ClaudeAnalysis`, …) |
| `display.ts` | All terminal output — keep CLI printing here |
| `env-utils.ts` / `datetime-utils.ts` | `envFlag`/`envInt`/`maskSecret`; TZ-aware formatting (default `America/Sao_Paulo`) |
| `claude.ts` | Empty legacy stub (superseded by `ai.ts`) |

Note the provider id for Claude Code is `code` (env vars `CODE_ENABLED`, `CODE_CMD`, `CODE_ARGS`, `WATCH_CODE_MONTHLY_TOKENS`; legacy `WATCH_CLAUDE_MONTHLY_TOKENS` is still read as a fallback). Codex/Gemini are enabled by default, Claude Code is off by default.

### AI integration

Prompt templates by `ProjectType`: `front` (Angular/TS), `api` (.NET/C#), `generic`. All must return strict JSON:

```json
{ "resumo": "", "aprovacao_recomendada": true, "riscos": [],
  "sugestoes": [{ "arquivo": "", "comentario": "", "severidade": "critico|aviso|sugestao" }],
  "comentario_geral": "markdown posted to the MR/PR" }
```

Diffs are truncated to 150 lines/file and 700 lines total (`MAX_LINES_PER_FILE`, `MAX_TOTAL_LINES` in `ai.ts`). Prompts and user-facing strings are in Portuguese.

### Provider selection

`usage-tracker.ts` persists `{ month, <provider>: { requests, estimatedTokens } }` (path from `LLM_USAGE_STORE_PATH`, default `.llm-usage.json`; auto-resets monthly; tokens ≈ chars/4). Priority: highest remaining % when limits are set → skip exhausted providers → round-robin by request count when no limits.

### Docker / deployment

`Dockerfile` installs Codex, Gemini CLI and Claude Code and runs as non-root `reviewer` via `docker-entrypoint.sh` (gosu). State is redirected to `/var/lib/cli-reviewer` with `WEBHOOK_STATE_PATH`, `WATCHER_STATE_PATH`, `REVIEW_STORE_PATH`, `LLM_USAGE_STORE_PATH`, `CLAUDE_CONFIG_DIR`. Ports 3333 (webhook) and 3334 (dashboard). Deployment guides live in `docs/deployment/` (9router pilot) and a design spec in `docs/specifications/`.

## Tests

`node:test` via `tsx`. Existing coverage: `projects`, `usage-tracker`, `watcher`, `automation`, `review-store`, `webhook-state`. Keep tests deterministic — mock state files and never call GitLab/GitHub or the AI CLIs.

## Conventions

Two-space indent, lowercase hyphenated filenames, commit subjects short and imperative in Portuguese or conventional-commit style (`feat:`, `fix:`, `docs:`). `chalk` must stay on v4 (CommonJS). `AGENTS.md` carries similar guidance for other agents.
