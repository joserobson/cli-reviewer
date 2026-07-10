import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { config } from 'dotenv';

import { analyzeAndApply, getAutoReviewConfig, notify } from './automation';
import { envInt } from './env-utils';
import { getMergeRequest } from './gitlab';
import { loadProjects } from './projects';
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

function findProject(projects: ProjectConfig[], payload: GitLabMergeRequestPayload): ProjectConfig | null {
  const numericId = payload.project?.id !== undefined ? String(payload.project.id) : undefined;
  const path = payload.project?.path_with_namespace;
  return projects.find(p => p.id === numericId || p.id === path) ?? null;
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

  const mr = await getMergeRequest(project.id, fallbackMr.iid).catch(() => fallbackMr);
  console.log(`\n[webhook] Analisando MR !${mr.iid}: "${mr.title}" [${project.label}]`);
  notify(`Webhook MR !${mr.iid}`, `"${mr.title}" - iniciando analise`, config.notifyDesktop);
  await analyzeAndApply(project, mr, config).catch(err => {
    console.error(`[webhook] Falha ao analisar MR !${mr.iid}: ${err instanceof Error ? err.message : String(err)}`);
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
    console.error('Nenhum projeto configurado. Defina GITLAB_PROJECTS no .env.');
    process.exit(1);
  }

  const port = envInt('WEBHOOK_PORT', 3333);
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      send(res, 200, { ok: true });
      return;
    }

    if (req.method !== 'POST' || req.url !== '/webhooks/gitlab') {
      send(res, 404, { error: 'not found' });
      return;
    }

    handleGitLabWebhook(req, res, projects).catch(err => {
      console.error(`[webhook] Erro inesperado: ${err instanceof Error ? err.message : String(err)}`);
      if (!res.headersSent) send(res, 500, { error: 'erro interno' });
    });
  });

  server.listen(port, () => {
    console.log(`MR Reviewer webhook ouvindo em http://localhost:${port}/webhooks/gitlab`);
  });
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
