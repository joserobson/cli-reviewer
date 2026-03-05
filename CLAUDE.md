# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## README Maintenance Rule

**After any change that affects features, configuration, architecture, or usage, update both README files before committing:**

- `README.md` — English version
- `README.pt-BR.md` — Portuguese version

What to keep in sync:
- Feature list, if a capability is added or removed
- Configuration section (`env` block), if new env vars are introduced
- Architecture table (`src/` file list), if modules are added, renamed, or removed
- Usage examples, if commands or flags change
- Prerequisites table, if new dependencies are required

## Running the Application

```bash
npm run review   # Interactive CLI (tsx src/index.ts)
npm run watch    # Background watcher (tsx src/watcher.ts)
npm test         # Run all tests (node:test via tsx)
npx tsc --noEmit # Type-check without emitting output
```

No build step is required — `tsx` executes TypeScript directly.

## Environment Setup

Copy `.env.example` to `.env` and fill in:

```env
GITLAB_URL=https://your-gitlab.example.com
GITLAB_TOKEN=glpat-xxxxxxxxxxxxxxxxxxxx

# One or more projects — format: id:type:label (comma-separated)
# Types: front (Angular), api (.NET C#), generic (any language)
GITLAB_PROJECTS=133:front:Frontend Angular,134:api:API .NET

# Optional: override CLI commands
# CLAUDE_CMD=claude   CLAUDE_ARGS=--print
# GEMINI_CMD=gemini   GEMINI_ARGS=--yolo

# Watcher
WATCH_INTERVAL_MINUTES=2
WATCH_CLAUDE_MONTHLY_TOKENS=0
WATCH_GEMINI_MONTHLY_TOKENS=0
```

## Architecture

The app is a CLI tool that reviews GitLab Merge Requests using local AI CLIs (Claude or Gemini).

**Module responsibilities:**

| File | Purpose |
|------|---------|
| `src/index.ts` | Interactive CLI: project/provider selection, MR listing, action execution |
| `src/watcher.ts` | Background monitor: polls GitLab, detects new MRs, auto-analyzes, notifies |
| `src/ai.ts` | Spawns claude/gemini CLI, builds stack-specific prompts, parses JSON response |
| `src/gitlab.ts` | GitLab API v4 wrapper (list MRs, fetch diff, approve, comment, merge) |
| `src/projects.ts` | Loads project config from `GITLAB_PROJECTS` env var; fallback to legacy vars |
| `src/usage-tracker.ts` | Tracks estimated monthly token usage per provider; selects best LLM |
| `src/display.ts` | Terminal output: banner, spinners, severity-colored analysis |
| `src/types.ts` | Shared TypeScript interfaces (`MergeRequest`, `ProjectConfig`, `ClaudeAnalysis`, etc.) |

**Data flow (CLI):**
```
Env validation → loadProjects() → Provider selection → List MRs → Select MRs
    → Fetch diffs (parallel) → Spawn AI CLI → Parse JSON → Display → Execute action
```

**Data flow (Watcher):**
```
seedInitialState() → poll() loop every N minutes
    → New MR detected → selectProvider() → Fetch diff → Spawn AI CLI
    → Parse JSON → postComment() → Desktop notification
```

## AI Integration

`ai.ts` spawns the selected CLI with the prompt piped via stdin. Three prompt templates exist:

| ProjectType | Template | Stack |
|---|---|---|
| `front` | `buildPromptFront` | Angular / TypeScript |
| `api` | `buildPromptDotNet` | .NET / C# |
| `generic` | `buildPromptGeneric` | Any language |

All templates instruct the AI to return **strict JSON**:

```json
{
  "resumo": "string",
  "aprovacao_recomendada": true,
  "riscos": ["string"],
  "sugestoes": [{ "arquivo": "path", "comentario": "feedback", "severidade": "critico|aviso|sugestao" }],
  "comentario_geral": "markdown for GitLab comment"
}
```

Diffs are truncated to 150 lines per file / 700 total lines before sending.

## Smart LLM Selection

`usage-tracker.ts` stores `{ month, claude: { requests, estimatedTokens }, gemini: ... }` in `.llm-usage.json` (gitignored, auto-resets monthly). Token estimation: `chars / 4`.

Selection priority:
1. Both limits set → pick highest remaining capacity %
2. One exhausted → use the other automatically
3. No limits → round-robin by request count

## GitLab API

Endpoints used:
- `GET /merge_requests?state=opened` — List open MRs
- `GET /merge_requests/{iid}/changes` — Fetch diff
- `POST /merge_requests/{iid}/approve` — Approve
- `POST /merge_requests/{iid}/notes` — Post comment
- `PUT /merge_requests/{iid}/merge` — Merge

Path-based project IDs (e.g., `grupo/projeto`) are automatically URL-encoded.

## Key Dependencies

- **tsx** — TypeScript runtime (no compilation needed)
- **chalk** `^4.1.2` — Terminal colors (must use v4, not v5, for CommonJS compatibility)
- **prompts** — Interactive CLI inputs
- **dotenv** — Environment loading

External tools that must be installed separately: `claude` CLI and/or `gemini` CLI.

## Tests

Tests use Node's built-in `node:test` runner (no extra dependencies). Run with `npm test`.

| File | Coverage |
|---|---|
| `tests/projects.test.ts` | `loadProjects()` parsing, legacy fallback, priority |
| `tests/usage-tracker.test.ts` | Token estimation, monthly reset, provider selection logic |
| `tests/watcher.test.ts` | State load/save, `filterNewMrs()`, multi-cycle simulation |
