# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the Application

```bash
npm run review          # Run the CLI (executes tsx src/index.ts)
npx tsc --noEmit       # Type-check without emitting output
```

No build step is required — `tsx` executes TypeScript directly.

## Environment Setup

Copy `.env.example` to `.env` and fill in:
- `GITLAB_URL` — GitLab instance URL (e.g., `https://lab.rerum.dev.br`)
- `GITLAB_TOKEN` — Personal access token with `api` scope
- `GITLAB_PROJECT_ID` — Numeric ID or path-based (`grupo/projeto`)

## Architecture

The app is a CLI tool that reviews GitLab Merge Requests using local AI CLIs (Claude or Gemini).

**Data flow:**
```
Env validation → Provider selection → List MRs → Select MR
    → Fetch diff → Build prompt → Spawn AI CLI
    → Parse JSON response → Display results → Execute action (approve/comment)
```

**Module responsibilities:**

| File | Purpose |
|------|---------|
| `src/index.ts` | Main orchestration: user prompts, flow control, action execution |
| `src/ai.ts` | Spawns `claude --print` or `gemini --yolo`, builds prompts, parses JSON |
| `src/gitlab.ts` | GitLab API v4 wrapper (list MRs, fetch diff, approve, post notes) |
| `src/display.ts` | CLI output: banner, spinners, formatted analysis with severity colors |
| `src/types.ts` | Shared TypeScript interfaces (`MergeRequest`, `FileChange`, `ClaudeAnalysis`, `Suggestion`) |
| `src/claude.ts` | Deprecated — superseded by `ai.ts` |

## AI Integration

`ai.ts` spawns the selected CLI tool with diff content piped as stdin. The prompt instructs the AI to act as a senior Angular/TypeScript reviewer and return **strict JSON** with this structure:

```json
{
  "resumo": "string",
  "aprovacao_recomendada": true,
  "riscos": ["string"],
  "sugestoes": [
    { "arquivo": "path", "comentario": "feedback", "severidade": "critico|aviso|sugestao" }
  ],
  "comentario_geral": "markdown for GitLab comment"
}
```

Diffs are truncated to 150 lines per file / 700 total lines before sending.

## GitLab API

Endpoints used:
- `GET /merge_requests?state=opened` — List open MRs
- `GET /merge_requests/{iid}/changes` — Fetch diff
- `POST /merge_requests/{iid}/approve` — Approve
- `POST /merge_requests/{iid}/notes` — Post comment

Path-based project IDs (e.g., `grupo/projeto`) are automatically URL-encoded.

## Key Dependencies

- **tsx** — TypeScript runtime (no compilation needed)
- **chalk** `^4.1.2` — Terminal colors (must use v4, not v5, for CommonJS compatibility)
- **prompts** — Interactive CLI inputs
- **dotenv** — Environment loading

External tools that must be installed separately: `claude` CLI and/or `gemini` CLI.
