# MR Reviewer

> AI-powered GitLab Merge Request reviewer that runs entirely on your machine — no cloud API costs.

**[Leia em Português](README.pt-BR.md)**

---

## What it does

MR Reviewer connects to your GitLab instance, fetches open Merge Requests, sends the diff to a local AI CLI (Claude or Gemini), and returns a structured code review in seconds. It works in two modes:

- **Interactive CLI** — pick MRs manually, review results, then approve/comment/merge from the terminal.
- **Watcher** — runs in the background, detects new MRs automatically, posts the review as a GitLab comment, and sends a Windows desktop notification.

Because it spawns `claude --print` or `gemini --yolo` locally, you pay nothing beyond your existing subscription.

---

## Features

- Analyzes Angular/TypeScript, .NET C#, or any stack (generic mode) with stack-specific rules
- Detects bad patterns: `setTimeout` in components, N+1 queries, `async void`, direct DOM manipulation, and more
- Severity-ranked suggestions: **critical / warning / suggestion**
- Parallel analysis of multiple MRs at once
- Auto-posts the full review as a formatted GitLab comment
- Smart LLM selector: tracks estimated monthly token usage per provider and automatically routes to the one with most remaining capacity
- Monthly usage resets automatically; configurable limits per provider

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Node.js ≥ 18 | `node --version` |
| [Claude CLI](https://claude.ai/download) | Must be authenticated (`claude --print` works) |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | Must be authenticated (`gemini --yolo` works) |
| GitLab Personal Access Token | Scope: `api` |
| Desktop notifications (Watcher only) | Windows built-in · macOS built-in · Linux: `sudo apt install libnotify-bin` |

You only need one of the AI CLIs; having both enables the smart selector.

---

## Installation

```bash
git clone https://github.com/your-username/mr-reviewer.git
cd mr-reviewer
npm install
cp .env.example .env
# Edit .env with your GitLab credentials
```

---

## Configuration

Edit `.env`:

```env
GITLAB_URL=https://your-gitlab.example.com
GITLAB_TOKEN=glpat-xxxxxxxxxxxxxxxxxxxx

# One or more projects — format: id:type:label (comma-separated)
# Supported types: front (Angular), api (.NET C#), generic (any language)
GITLAB_PROJECTS=133:front:Frontend Angular,134:api:API .NET

# Optional: customize CLI commands (defaults shown)
# CLAUDE_CMD=claude
# CLAUDE_ARGS=--print
# GEMINI_CMD=gemini
# GEMINI_ARGS=--yolo

# Watcher settings
WATCH_INTERVAL_MINUTES=2
WATCH_CLAUDE_MONTHLY_TOKENS=7000000
WATCH_GEMINI_MONTHLY_TOKENS=1500000
```

Project IDs accept both numeric (`133`) and path-based (`group/project`) formats.

---

## Usage

### Interactive CLI

```bash
npm run review
```

Flow:
1. Select project (Angular or .NET API)
2. Select AI provider (Claude or Gemini)
3. Pick one or more open MRs
4. Review the analysis
5. Choose an action: approve / post comment / merge / skip

### Watcher (background monitor)

```bash
npm run watch
```

The watcher polls GitLab every `WATCH_INTERVAL_MINUTES` minutes. When a new MR is opened:

1. Sends a Windows desktop notification
2. Fetches the diff and runs the analysis automatically
3. Posts the review as a comment on the MR
4. Logs usage statistics to the terminal

On first run, existing open MRs are seeded as "already seen" so they are not re-analyzed.

---

## Smart LLM Selection

Usage is tracked in `.llm-usage.json` (gitignored, auto-resets monthly).

| Scenario | Behavior |
|---|---|
| Both limits set | Picks the provider with the highest **remaining capacity %** |
| One provider exhausted | Automatically falls back to the other |
| No limits configured | Round-robin by request count |

Token estimation: `characters / 4` — standard approximation, sufficient for budgeting.

---

## Architecture

```
src/
├── index.ts          # Interactive CLI — prompts, flow control, actions
├── watcher.ts        # Background monitor — polling, notifications, auto-post
├── ai.ts             # Spawns claude/gemini, builds prompts, parses JSON
├── gitlab.ts         # GitLab API v4 wrapper
├── projects.ts       # Project config loader (parses GITLAB_PROJECTS env var)
├── usage-tracker.ts  # Token usage tracking + smart provider selection
├── display.ts        # Terminal output — banner, spinners, analysis formatting
└── types.ts          # Shared TypeScript interfaces
```

**Data flow (CLI):**
```
Env validation → Project/provider selection → List MRs → Select MRs
    → Fetch diffs (parallel) → Spawn AI CLI → Parse JSON → Display
    → Execute action (approve / comment / merge)
```

**Data flow (Watcher):**
```
Poll GitLab → New MR detected → Estimate tokens → Select provider
    → Fetch diff → Spawn AI CLI → Parse JSON → Post comment → Notify
```

---

## GitLab API endpoints used

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/merge_requests?state=opened` | List open MRs |
| GET | `/merge_requests/:iid/changes` | Fetch diff |
| POST | `/merge_requests/:iid/approve` | Approve |
| POST | `/merge_requests/:iid/notes` | Post comment |
| PUT | `/merge_requests/:iid/merge` | Merge |

---

## Type-checking

```bash
npx tsc --noEmit
```

No build step required — `tsx` executes TypeScript directly.

---

## License

MIT
