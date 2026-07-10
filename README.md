# CLI Reviewer

> AI-powered GitLab Merge Request and GitHub Pull Request reviewer that runs entirely on your machine, using local AI CLIs.

**[Leia em Português](README.pt-BR.md)**

---

## What it does

CLI Reviewer connects to GitLab and GitHub, fetches open Merge Requests or Pull Requests, sends the diff to a local AI CLI (Codex, Gemini, or Claude Code), and returns a structured code review in seconds. It works in three modes:

- **Interactive CLI** — pick MRs manually, review results, then approve/comment/merge from the terminal.
- **Watcher** — polls GitLab/GitHub in the background, detects new MRs/PRs automatically, posts the review as a platform comment, and sends a desktop notification.
- **Webhook server** — receives GitLab Merge Request and GitHub Pull Request events for near real-time automation on a server/VPS.

Because it spawns your configured local CLI, review data stays on your machine except for the GitLab/GitHub API calls needed to fetch diffs and post comments.

---

## Features

- Analyzes Angular/TypeScript, .NET C#, or any stack (generic mode) with stack-specific rules
- Detects bad patterns: `setTimeout` in components, N+1 queries, `async void`, direct DOM manipulation, and more
- Severity-ranked suggestions: **critical / warning / suggestion**
- Parallel analysis of multiple MRs at once
- Auto-posts the full review as a formatted GitLab/GitHub comment
- Smart LLM selector: tracks estimated monthly token usage per provider and automatically routes to the one with most remaining capacity
- Monthly usage resets automatically; configurable limits per provider
- Local web dashboard with review history, status counts, and estimated token consumption

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Node.js ≥ 18 | `node --version` |
| Codex CLI | Optional provider; must be installed and authenticated if enabled |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | Optional provider; must be installed and authenticated if enabled |
| Claude Code / Claude CLI | Optional provider; must be installed and authenticated if enabled |
| GitLab Personal Access Token | Scope: `api` |
| GitHub token | Optional for reading public PRs; required to comment, approve, or merge |
| Desktop notifications (Watcher only) | Windows built-in · macOS built-in · Linux: `sudo apt install libnotify-bin` |

You only need one enabled AI CLI. Having multiple providers enables the smart selector.

---

## Installation

```bash
git clone https://github.com/your-username/mr-reviewer.git
cd mr-reviewer
npm install
cp .env.example .env
# Edit .env with your GitLab/GitHub credentials
npm run doctor
npm test
npm run typecheck
```

On PowerShell, use `Copy-Item .env.example .env` instead of `cp` if needed.

---

## First-time setup

For a guided setup, run:

```bash
npm run setup
npm run doctor
```

Choose **local** for on-demand reviews or simple polling on your own machine. Choose **server/VPS** for continuous automation with GitLab/GitHub webhooks.

`npm run doctor` validates Node.js, `.env`, GitLab/GitHub settings, configured projects, enabled AI providers, provider commands, and polling/webhook-specific settings.

---

## Configuration

Edit `.env`:

```env
GITLAB_URL=https://your-gitlab.example.com
GITLAB_TOKEN=glpat-xxxxxxxxxxxxxxxxxxxx
GITHUB_TOKEN=github_pat_xxxxxxxxxxxxxxxxxxxx
GITHUB_API_URL=https://api.github.com

# One or more projects/repositories — format: id:type:label (comma-separated)
# Supported types: front (Angular), api (.NET C#), generic (any language)
GITLAB_PROJECTS=133:front:Frontend Angular,134:api:API .NET
GITHUB_REPOSITORIES=owner/repo:generic:CLI Reviewer

# Enable one or more local AI CLIs
CODEX_ENABLED=true
GEMINI_ENABLED=true
CODE_ENABLED=false

# Optional: customize CLI commands
# CODEX_CMD=codex
# CODEX_ARGS=exec -
# GEMINI_CMD=gemini
# GEMINI_ARGS=--yolo
# CODE_CMD=claude
# CODE_ARGS=--print

# Automatic review settings
AUTO_REVIEW_ENABLED=false
AUTO_REVIEW_MODE=polling
AUTO_REVIEW_POST_COMMENT=true
AUTO_REVIEW_NOTIFY_DESKTOP=true
AUTO_REVIEW_SKIP_DRAFT=true
AUTO_REVIEW_APPROVE_ON_SUCCESS=false
AUTO_REVIEW_MERGE_ON_SUCCESS=false
WATCH_INTERVAL_MINUTES=2
DASHBOARD_PORT=3334
WEBHOOK_PORT=3333
WEBHOOK_SECRET=change-me
GITHUB_WEBHOOK_SECRET=change-me
WATCH_CODEX_MONTHLY_TOKENS=0
WATCH_GEMINI_MONTHLY_TOKENS=0
WATCH_CODE_MONTHLY_TOKENS=0
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
2. Select AI provider (Codex, Gemini, or Claude Code)
3. Pick one or more open MRs
4. Review the analysis
5. Choose an action: approve / post comment / merge / skip

### Watcher (background monitor)

```bash
npm run watch
```

The watcher polls GitLab/GitHub every `WATCH_INTERVAL_MINUTES` minutes. When a new MR/PR is opened:

1. Sends a desktop notification
2. Fetches the diff and runs the analysis automatically
3. Posts the review as a comment on the MR
4. Logs usage statistics to the terminal

On first run, existing open MRs are seeded as "already seen" so they are not re-analyzed.

The watcher honors the `AUTO_REVIEW_*` safety switches. By default it ignores Draft MRs, posts comments, sends desktop notifications, and does **not** approve or merge automatically.
Set `AUTO_REVIEW_ENABLED=true` to let `npm run watch` analyze and post automatically; when it is `false`, new MRs are detected and recorded without automatic review.

### Webhook server

```bash
npm run webhook
```

Set `AUTO_REVIEW_ENABLED=true`, `AUTO_REVIEW_MODE=webhook`, `WEBHOOK_PORT`, and `WEBHOOK_SECRET`. For GitLab, open `Settings > Webhooks`, use `https://your-domain.com/webhooks/gitlab`, set the same secret token, and enable Merge Request events. For GitHub, use `https://your-domain.com/webhooks/github`, set `GITHUB_WEBHOOK_SECRET`, and enable Pull request events.

For local tests, expose the port with a tunnel:

```bash
cloudflared tunnel --url http://localhost:3333
# or
ngrok http 3333
```

### Dashboard

```bash
npm run dashboard
```

Open `http://localhost:3334/dashboard` to inspect review history, approval/review-needed counts, comments/actions taken, and estimated token usage per provider. The dashboard reads local state from `.review-dashboard.json` and `.llm-usage.json`; both files are gitignored.

---

## Smart LLM Selection

Usage is tracked in `.llm-usage.json` (gitignored, auto-resets monthly).
Review history for the dashboard is tracked in `.review-dashboard.json` (gitignored).

| Scenario | Behavior |
|---|---|
| One or more limits set | Picks the enabled provider with the highest **remaining capacity %** |
| One provider exhausted | Automatically falls back to another enabled provider |
| No limits configured | Round-robin by request count |

Token estimation: `characters / 4` — standard approximation, sufficient for budgeting.

---

## Architecture

```
src/
├── index.ts          # Interactive CLI — prompts, flow control, actions
├── watcher.ts        # Background monitor — polling, notifications, auto-post
├── webhook-server.ts # HTTP server for GitLab/GitHub webhooks
├── dashboard.ts      # Local web dashboard for reviews and token usage
├── setup.ts          # Guided first-run .env creation
├── doctor.ts         # Local diagnostics before running the reviewer
├── automation.ts     # Shared automatic review behavior
├── ai.ts             # Spawns enabled AI CLIs, builds prompts, parses JSON
├── gitlab.ts         # GitLab API v4 wrapper
├── github.ts         # GitHub REST API wrapper
├── scm.ts            # Platform router for GitLab/GitHub operations
├── projects.ts       # Project config loader
├── usage-tracker.ts  # Token usage tracking + smart provider selection
├── review-store.ts   # Local review history for dashboard metrics
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
Poll GitLab/GitHub → New MR/PR detected → Estimate tokens → Select provider
    → Fetch diff → Spawn AI CLI → Parse JSON → Post comment → Notify
```

---

## Platform API endpoints used

| Method | Endpoint | Purpose |
|---|---|---|
| GET | GitLab `/merge_requests?state=opened` / GitHub `/pulls?state=open` | List open reviews |
| GET | GitLab `/merge_requests/:iid/changes` / GitHub `/pulls/:number/files` | Fetch diff |
| POST | GitLab `/merge_requests/:iid/approve` / GitHub `/pulls/:number/reviews` | Approve |
| POST | GitLab `/merge_requests/:iid/notes` / GitHub `/issues/:number/comments` | Post comment |
| PUT | GitLab `/merge_requests/:iid/merge` / GitHub `/pulls/:number/merge` | Merge |

---

## Type-checking

```bash
npm run typecheck
```

No build step required — `tsx` executes TypeScript directly.

## Development and contribution

Before opening a pull request, run:

```bash
npm test
npm run typecheck
```

See `CONTRIBUTING.md` for the contribution workflow and `SECURITY.md` for secret handling and vulnerability reporting. GitHub Actions runs the same validation on pull requests.

## Troubleshooting

| Problem | Check |
|---|---|
| Missing GitLab configuration | Copy `.env.example` to `.env` and set `GITLAB_URL`, `GITLAB_TOKEN`, and `GITLAB_PROJECTS` |
| Missing GitHub configuration | Set `GITHUB_REPOSITORIES`; set `GITHUB_TOKEN` for comments, approvals, or merge |
| No AI provider available | Enable at least one of `CODEX_ENABLED`, `GEMINI_ENABLED`, or `CODE_ENABLED` |
| AI command not found | Install/authenticate the CLI or override `*_CMD` and `*_ARGS` in `.env` |
| Enabled provider is not installed | Run `npm run doctor` and either install the CLI or set `CODEX_ENABLED`, `GEMINI_ENABLED`, or `CODE_ENABLED` to `false` |
| Invalid GitLab token | Confirm the token has `api` scope and is not expired |
| GitLab project has no permission | Confirm the token user can read MRs and post notes in every `GITLAB_PROJECTS` entry |
| GitHub repository has no permission | Confirm the token can read PRs and write Pull Request reviews/comments |
| Watcher does not post comments | Confirm token scope `api`, project IDs, and GitLab permissions |
| Webhook returns 401 | Confirm GitLab's secret token matches `WEBHOOK_SECRET` or GitHub's signature uses `GITHUB_WEBHOOK_SECRET` |

---

## License

MIT
