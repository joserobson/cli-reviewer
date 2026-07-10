import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createHmac, timingSafeEqual } from 'crypto';
import { config } from 'dotenv';

import { analyzeAndApply, getAutoReviewConfig, notify } from './automation';
import { envInt } from './env-utils';
import { loadProjects } from './projects';
import { getRequest, requestLabel } from './scm';
import type { MergeRequest, ProjectConfig } from './types';

config();

const WEBHOOK_STATE_PATH = '.webhook-state.json';

interface WebhookState {
  processedEvents: string[];
}

interface GitLabMergeRequestPayload {
  event_type?: string;
  object_kind?: string;
  project?: { id?: number; path_with_namespace?: string };
  user?: { name?: string; username?: string };
  object_attributes?: {
    action?: string;
    iid?: number;
    title?: string;
    description?: string | null;
    source_branch?: string;
    target_branch?: string;
    created_at?: string;
    updated_at?: string;
    url?: string;
    state?: string;
    draft?: boolean;
    work_in_progress?: boolean;
    last_commit?: { id?: string };
  };
}

interface GitHubPullRequestPayload {
  action?: string;
  repository?: { full_name?: string };
  sender?: { login?: string };
  pull_request?: {
    id: number;
    number: number;
    title: string;
    body: string | null;
    user?: { login?: string };
    head: { ref: string; sha: string };
    base: { ref: string; sha: string };
    created_at: string;
    updated_at: string;
    html_url: string;
    state: string;
    draft?: boolean;
  };
}

function loadWebhookState(): WebhookState {
  if (!existsSync(WEBHOOK_STATE_PATH)) return { processedEvents: [] };
  try {
    return JSON.parse(readFileSync(WEBHOOK_STATE_PATH, 'utf8')) as WebhookState;
  } catch {
    return { processedEvents: [] };
  }
}

function saveWebhookState(state: WebhookState): void {
  writeFileSync(WEBHOOK_STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

function eventKey(projectId: string, iid: number, payload: GitLabMergeRequestPayload): string {
  const attrs = payload.object_attributes;
  const ref = attrs?.last_commit?.id ?? attrs?.updated_at ?? 'unknown';
  return `${projectId}:${iid}:${ref}`;
}

function githubEventKey(projectId: string, payload: GitHubPullRequestPayload): string {
  const pr = payload.pull_request;
  return `${projectId}:${pr?.number ?? 'unknown'}:${pr?.head.sha ?? pr?.updated_at ?? 'unknown'}`;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString('utf8');
      if (body.length > 1_000_000) {
        req.destroy(new Error('Payload muito grande'));
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: object): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function verifyGitHubSignature(req: IncomingMessage, raw: string): boolean {
  const secret = process.env.GITHUB_WEBHOOK_SECRET ?? process.env.WEBHOOK_SECRET;
  if (!secret) return true;

  const signature = req.headers['x-hub-signature-256'];
  if (typeof signature !== 'string' || !signature.startsWith('sha256=')) return false;

  const expected = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function findProject(projects: ProjectConfig[], payload: GitLabMergeRequestPayload): ProjectConfig | null {
  const numericId = payload.project?.id !== undefined ? String(payload.project.id) : undefined;
  const path = payload.project?.path_with_namespace;
  return projects.find(p => p.platform === 'gitlab' && (p.id === numericId || p.id === path)) ?? null;
}

function mrFromPayload(projectId: string, payload: GitLabMergeRequestPayload): MergeRequest | null {
  const attrs = payload.object_attributes;
  if (!attrs?.iid) return null;

  return {
    iid: attrs.iid,
    id: attrs.iid,
    title: attrs.title ?? `MR !${attrs.iid}`,
    description: attrs.description ?? null,
    author: {
      name: payload.user?.name ?? 'GitLab user',
      username: payload.user?.username ?? 'gitlab',
    },
    source_branch: attrs.source_branch ?? '',
    target_branch: attrs.target_branch ?? '',
    created_at: attrs.created_at ?? new Date().toISOString(),
    updated_at: attrs.updated_at ?? new Date().toISOString(),
    web_url: attrs.url ?? '',
    changes_count: '0',
    state: attrs.state ?? 'opened',
    draft: attrs.draft ?? attrs.work_in_progress ?? false,
  };
}

function findGitHubProject(projects: ProjectConfig[], payload: GitHubPullRequestPayload): ProjectConfig | null {
  const repo = payload.repository?.full_name;
  return projects.find(p => p.platform === 'github' && p.id.toLowerCase() === repo?.toLowerCase()) ?? null;
}

function prFromPayload(payload: GitHubPullRequestPayload): MergeRequest | null {
  const pr = payload.pull_request;
  if (!pr) return null;

  const username = pr.user?.login ?? payload.sender?.login ?? 'github';
  return {
    iid: pr.number,
    id: pr.id,
    title: pr.title,
    description: pr.body,
    author: { name: username, username },
    source_branch: pr.head.ref,
    target_branch: pr.base.ref,
    created_at: pr.created_at,
    updated_at: pr.updated_at,
    web_url: pr.html_url,
    changes_count: '0',
    state: pr.state,
    draft: pr.draft ?? false,
  };
}

async function handleGitLabWebhook(req: IncomingMessage, res: ServerResponse, projects: ProjectConfig[]): Promise<void> {
  const config = getAutoReviewConfig();
  const expectedSecret = process.env.WEBHOOK_SECRET;

  if (!expectedSecret) {
    send(res, 500, { error: 'WEBHOOK_SECRET nao configurado' });
    return;
  }

  if (req.headers['x-gitlab-token'] !== expectedSecret) {
    send(res, 401, { error: 'token invalido' });
    return;
  }

  const raw = await readBody(req);
  const payload = JSON.parse(raw) as GitLabMergeRequestPayload;
  const eventType = payload.event_type ?? payload.object_kind;
  if (eventType !== 'merge_request') {
    send(res, 202, { skipped: 'evento ignorado' });
    return;
  }

  const action = payload.object_attributes?.action;
  if (!['open', 'reopen', 'update'].includes(action ?? '')) {
    send(res, 202, { skipped: `acao ignorada: ${action ?? 'desconhecida'}` });
    return;
  }

  const project = findProject(projects, payload);
  const fallbackMr = project ? mrFromPayload(project.id, payload) : null;
  if (!project || !fallbackMr) {
    send(res, 400, { error: 'projeto ou MR nao configurado' });
    return;
  }

  const key = eventKey(project.id, fallbackMr.iid, payload);
  const state = loadWebhookState();
  if (state.processedEvents.includes(key)) {
    send(res, 202, { skipped: 'evento ja processado' });
    return;
  }

  state.processedEvents = [...state.processedEvents.slice(-499), key];
  saveWebhookState(state);

  if (!config.enabled) {
    send(res, 202, { skipped: 'AUTO_REVIEW_ENABLED=false', key });
    return;
  }

  send(res, 202, { accepted: true, key });

  const mr = await getRequest(project, fallbackMr.iid).catch(() => fallbackMr);
  console.log(`\n[webhook] Analisando MR !${mr.iid}: "${mr.title}" [${project.label}]`);
  notify(`Webhook MR !${mr.iid}`, `"${mr.title}" - iniciando analise`, config.notifyDesktop);
  await analyzeAndApply(project, mr, config).catch(err => {
    console.error(`[webhook] Falha ao analisar MR !${mr.iid}: ${err instanceof Error ? err.message : String(err)}`);
  });
}

async function handleGitHubWebhook(req: IncomingMessage, res: ServerResponse, projects: ProjectConfig[]): Promise<void> {
  const config = getAutoReviewConfig();
  const raw = await readBody(req);

  if (!verifyGitHubSignature(req, raw)) {
    send(res, 401, { error: 'assinatura invalida' });
    return;
  }

  if (req.headers['x-github-event'] !== 'pull_request') {
    send(res, 202, { skipped: 'evento ignorado' });
    return;
  }

  const payload = JSON.parse(raw) as GitHubPullRequestPayload;
  if (!['opened', 'reopened', 'synchronize', 'ready_for_review'].includes(payload.action ?? '')) {
    send(res, 202, { skipped: `acao ignorada: ${payload.action ?? 'desconhecida'}` });
    return;
  }

  const project = findGitHubProject(projects, payload);
  const fallbackPr = prFromPayload(payload);
  if (!project || !fallbackPr) {
    send(res, 400, { error: 'repositorio ou PR nao configurado' });
    return;
  }

  const key = githubEventKey(project.id, payload);
  const state = loadWebhookState();
  if (state.processedEvents.includes(key)) {
    send(res, 202, { skipped: 'evento ja processado' });
    return;
  }

  state.processedEvents = [...state.processedEvents.slice(-499), key];
  saveWebhookState(state);

  if (!config.enabled) {
    send(res, 202, { skipped: 'AUTO_REVIEW_ENABLED=false', key });
    return;
  }

  send(res, 202, { accepted: true, key });

  const label = requestLabel(project);
  const pr = await getRequest(project, fallbackPr.iid).catch(() => fallbackPr);
  console.log(`\n[webhook] Analisando ${label} !${pr.iid}: "${pr.title}" [${project.label}]`);
  notify(`Webhook ${label} !${pr.iid}`, `"${pr.title}" - iniciando analise`, config.notifyDesktop);
  await analyzeAndApply(project, pr, config).catch(err => {
    console.error(`[webhook] Falha ao analisar ${label} !${pr.iid}: ${err instanceof Error ? err.message : String(err)}`);
  });
}

async function main(): Promise<void> {
  const autoConfig = getAutoReviewConfig();
  if (autoConfig.mode !== 'webhook') {
    console.error('AUTO_REVIEW_MODE deve ser webhook para usar npm run webhook.');
    process.exit(1);
  }

  const projects = loadProjects();
  if (projects.length === 0) {
    console.error('Nenhum projeto configurado. Defina GITLAB_PROJECTS ou GITHUB_REPOSITORIES no .env.');
    process.exit(1);
  }

  const port = envInt('WEBHOOK_PORT', 3333);
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      send(res, 200, { ok: true });
      return;
    }

    if (req.method !== 'POST' || (req.url !== '/webhooks/gitlab' && req.url !== '/webhooks/github')) {
      send(res, 404, { error: 'not found' });
      return;
    }

    const handler = req.url === '/webhooks/github' ? handleGitHubWebhook : handleGitLabWebhook;
    handler(req, res, projects).catch(err => {
      console.error(`[webhook] Erro inesperado: ${err instanceof Error ? err.message : String(err)}`);
      if (!res.headersSent) send(res, 500, { error: 'erro interno' });
    });
  });

  server.listen(port, () => {
    console.log(`CLI Reviewer webhook ouvindo em http://localhost:${port}`);
    console.log(`   GitLab: http://localhost:${port}/webhooks/gitlab`);
    console.log(`   GitHub: http://localhost:${port}/webhooks/github`);
  });
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
