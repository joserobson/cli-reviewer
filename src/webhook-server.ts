import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { createHmac, timingSafeEqual } from 'crypto';
import { config } from 'dotenv';

import { sendAgentHubReviewResult, type AgentHubReviewResult } from './agent-hub-callback';
import { analyzeAndApply, getAutoReviewConfig, notify } from './automation';
import { nowFormatted, nowISO } from './datetime-utils';
import { envInt } from './env-utils';
import { loadProjects } from './projects';
import { getRequest, requestLabel } from './scm';
import type { MergeRequest, ProjectConfig } from './types';
import { WebhookEventStore } from './webhook-state';

config();

const webhookEvents = new WebhookEventStore(process.env.WEBHOOK_STATE_PATH);

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

function agentHubTaskId(req: IncomingMessage): string | null {
  const value = req.headers['x-agenthub-review-task-id'];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function reportAgentHub(taskId: string | null, result: AgentHubReviewResult): Promise<void> {
  if (!taskId) return;

  try {
    await sendAgentHubReviewResult(taskId, result);
  } catch (err) {
    console.error(`[callback] Falha ao atualizar task ${taskId}: ${err instanceof Error ? err.message : String(err)}`);
  }
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
  const taskId = agentHubTaskId(req);

  console.log(`   → GitLab webhook: verificando autenticação...`);
  if (!expectedSecret) {
    console.log(`   ❌ WEBHOOK_SECRET não configurado no .env`);
    send(res, 500, { error: 'WEBHOOK_SECRET nao configurado' });
    return;
  }

  const receivedToken = req.headers['x-gitlab-token'];
  if (receivedToken !== expectedSecret) {
    console.log(`   ❌ Token inválido (recebido: ${receivedToken ? '***' : 'ausente'}, esperado: ***)`);
    send(res, 401, { error: 'token invalido' });
    return;
  }
  console.log(`   ✓ Autenticação OK`);

  const raw = await readBody(req);
  console.log(`   → Payload recebido (${raw.length} bytes)`);

  const payload = JSON.parse(raw) as GitLabMergeRequestPayload;
  const eventType = payload.event_type ?? payload.object_kind;
  console.log(`   → Tipo de evento: ${eventType}`);

  if (eventType !== 'merge_request') {
    console.log(`   ⏭️  Evento ignorado (não é merge_request)`);
    send(res, 202, { skipped: 'evento ignorado' });
    await reportAgentHub(taskId, { status: 'skipped', summary: 'evento ignorado' });
    return;
  }

  const action = payload.object_attributes?.action;
  console.log(`   → Ação do MR: ${action}`);

  if (!['open', 'reopen', 'update'].includes(action ?? '')) {
    const summary = `acao ignorada: ${action ?? 'desconhecida'}`;
    console.log(`   ⏭️  ${summary}`);
    send(res, 202, { skipped: summary });
    await reportAgentHub(taskId, { status: 'skipped', summary });
    return;
  }

  const project = findProject(projects, payload);
  const fallbackMr = project ? mrFromPayload(project.id, payload) : null;

  console.log(`   → Projeto: ${payload.project?.id ?? payload.project?.path_with_namespace ?? 'desconhecido'}`);
  console.log(`   → MR: !${fallbackMr?.iid ?? 'desconhecido'} - "${fallbackMr?.title ?? 'sem título'}"`);

  if (!project || !fallbackMr) {
    console.log(`   ❌ Projeto não encontrado na configuração`);
    console.log(`      Projetos configurados: ${projects.map(p => `${p.platform}:${p.id}`).join(', ')}`);
    send(res, 400, { error: 'projeto ou MR nao configurado' });
    await reportAgentHub(taskId, { status: 'failed', errorMessage: 'projeto ou MR nao configurado' });
    return;
  }
  console.log(`   ✓ Projeto encontrado: ${project.label} (${project.platform}:${project.id})`);

  const key = eventKey(project.id, fallbackMr.iid, payload);
  console.log(`   → Event key: ${key}`);

  if (!config.enabled) {
    console.log(`   ⏭️  AUTO_REVIEW_ENABLED=false - análise desabilitada`);
    send(res, 202, { skipped: 'AUTO_REVIEW_ENABLED=false', key });
    await reportAgentHub(taskId, { status: 'skipped', summary: 'AUTO_REVIEW_ENABLED=false' });
    return;
  }

  const eventState = webhookEvents.begin(key);
  console.log(`   → Estado do evento: ${eventState}`);

  if (eventState !== 'started') {
    const summary = eventState === 'processing' ? 'evento em processamento' : 'evento ja processado';
    console.log(`   ⏭️  ${summary}`);
    send(res, 202, { skipped: summary });
    await reportAgentHub(taskId, { status: 'skipped', summary });
    return;
  }

  send(res, 202, { accepted: true, key });
  console.log(`   ✓ Webhook aceito, iniciando análise...`);

  const mr = await getRequest(project, fallbackMr.iid).catch(() => fallbackMr);
  console.log(`\n[webhook] 🔍 Analisando MR !${mr.iid}: "${mr.title}" [${project.label}]`);
  notify(`Webhook MR !${mr.iid}`, `"${mr.title}" - iniciando analise`, config.notifyDesktop);
  await reportAgentHub(taskId, { status: 'running' });

  try {
    const result = await analyzeAndApply(project, mr, config);
    webhookEvents.complete(key);
    console.log(`[webhook] ✅ Análise concluída para MR !${mr.iid}`);
    await reportAgentHub(taskId, result);
  } catch (err) {
    webhookEvents.fail(key);
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[webhook] ❌ Falha ao analisar MR !${mr.iid}: ${errorMessage}`);
    if (err instanceof Error && err.stack) {
      console.error(`   Stack trace: ${err.stack}`);
    }
    await reportAgentHub(taskId, { status: 'failed', errorMessage });
  }
}

async function handleGitHubWebhook(req: IncomingMessage, res: ServerResponse, projects: ProjectConfig[]): Promise<void> {
  const config = getAutoReviewConfig();
  console.log(`   → GitHub webhook: verificando autenticação...`);

  const raw = await readBody(req);
  console.log(`   → Payload recebido (${raw.length} bytes)`);

  if (!verifyGitHubSignature(req, raw)) {
    const hasSecret = !!(process.env.GITHUB_WEBHOOK_SECRET ?? process.env.WEBHOOK_SECRET);
    console.log(`   ❌ Assinatura inválida (secret ${hasSecret ? 'configurado' : 'ausente'})`);
    send(res, 401, { error: 'assinatura invalida' });
    return;
  }
  console.log(`   ✓ Autenticação OK`);

  const eventType = req.headers['x-github-event'];
  console.log(`   → Tipo de evento: ${eventType}`);

  if (eventType !== 'pull_request') {
    console.log(`   ⏭️  Evento ignorado (não é pull_request)`);
    send(res, 202, { skipped: 'evento ignorado' });
    return;
  }

  const payload = JSON.parse(raw) as GitHubPullRequestPayload;
  const action = payload.action;
  console.log(`   → Ação do PR: ${action}`);

  if (!['opened', 'reopened', 'synchronize', 'ready_for_review'].includes(action ?? '')) {
    console.log(`   ⏭️  Ação ignorada: ${action ?? 'desconhecida'}`);
    send(res, 202, { skipped: `acao ignorada: ${action ?? 'desconhecida'}` });
    return;
  }

  const project = findGitHubProject(projects, payload);
  const fallbackPr = prFromPayload(payload);

  console.log(`   → Repositório: ${payload.repository?.full_name ?? 'desconhecido'}`);
  console.log(`   → PR: #${fallbackPr?.iid ?? 'desconhecido'} - "${fallbackPr?.title ?? 'sem título'}"`);

  if (!project || !fallbackPr) {
    console.log(`   ❌ Repositório não encontrado na configuração`);
    console.log(`      Repositórios configurados: ${projects.filter(p => p.platform === 'github').map(p => p.id).join(', ')}`);
    send(res, 400, { error: 'repositorio ou PR nao configurado' });
    return;
  }
  console.log(`   ✓ Projeto encontrado: ${project.label} (${project.platform}:${project.id})`);

  const key = githubEventKey(project.id, payload);
  console.log(`   → Event key: ${key}`);

  if (!config.enabled) {
    console.log(`   ⏭️  AUTO_REVIEW_ENABLED=false - análise desabilitada`);
    send(res, 202, { skipped: 'AUTO_REVIEW_ENABLED=false', key });
    return;
  }

  const eventState = webhookEvents.begin(key);
  console.log(`   → Estado do evento: ${eventState}`);

  if (eventState !== 'started') {
    const summary = eventState === 'processing' ? 'evento em processamento' : 'evento ja processado';
    console.log(`   ⏭️  ${summary}`);
    send(res, 202, { skipped: summary });
    return;
  }

  send(res, 202, { accepted: true, key });
  console.log(`   ✓ Webhook aceito, iniciando análise...`);

  const label = requestLabel(project);
  const pr = await getRequest(project, fallbackPr.iid).catch(() => fallbackPr);
  console.log(`\n[webhook] 🔍 Analisando ${label} #${pr.iid}: "${pr.title}" [${project.label}]`);
  notify(`Webhook ${label} #${pr.iid}`, `"${pr.title}" - iniciando analise`, config.notifyDesktop);

  try {
    await analyzeAndApply(project, pr, config);
    webhookEvents.complete(key);
    console.log(`[webhook] ✅ Análise concluída para ${label} #${pr.iid}`);
  } catch (err) {
    webhookEvents.fail(key);
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[webhook] ❌ Falha ao analisar ${label} #${pr.iid}: ${errorMessage}`);
    if (err instanceof Error && err.stack) {
      console.error(`   Stack trace: ${err.stack}`);
    }
  }
}

async function main(): Promise<void> {
  console.log('┌──────────────────────────────────────────┐');
  console.log('│  CLI Reviewer — Webhook Server           │');
  console.log('└──────────────────────────────────────────┘\n');

  const autoConfig = getAutoReviewConfig();
  if (autoConfig.mode !== 'webhook') {
    console.error('❌ AUTO_REVIEW_MODE deve ser webhook para usar npm run webhook.');
    process.exit(1);
  }

  const projects = loadProjects();
  if (projects.length === 0) {
    console.error('❌ Nenhum projeto configurado. Defina GITLAB_PROJECTS ou GITHUB_REPOSITORIES no .env.');
    process.exit(1);
  }

  // Log de configuração detalhado
  console.log('📋 Configuração carregada:');
  console.log(`   AUTO_REVIEW_ENABLED: ${autoConfig.enabled}`);
  console.log(`   AUTO_REVIEW_MODE: ${autoConfig.mode}`);
  console.log(`   AUTO_REVIEW_POST_COMMENT: ${autoConfig.postComment}`);
  console.log(`   AUTO_REVIEW_SKIP_DRAFT: ${autoConfig.skipDraft}`);
  console.log(`   AUTO_REVIEW_APPROVE_ON_SUCCESS: ${autoConfig.approveOnSuccess}`);
  console.log(`   AUTO_REVIEW_MERGE_ON_SUCCESS: ${autoConfig.mergeOnSuccess}`);
  console.log(`   WEBHOOK_SECRET: ${process.env.WEBHOOK_SECRET ? '✓ configurado' : '⚠️  não configurado'}`);
  console.log(`\n📂 Projetos monitorados (${projects.length}):`);
  for (const p of projects) {
    console.log(`   [${p.platform}/${p.type}] ${p.label} (id: ${p.id})`);
  }
  console.log('');

  const port = envInt('WEBHOOK_PORT', 3333);
  let requestCount = 0;

  const server = createServer((req, res) => {
    const timestamp = nowFormatted();
    requestCount++;

    // Log de TODAS as requisições recebidas
    console.log(`\n[${timestamp}] 📥 Requisição #${requestCount}: ${req.method} ${req.url}`);
    console.log(`   Headers: ${JSON.stringify({
      'user-agent': req.headers['user-agent'],
      'x-gitlab-token': req.headers['x-gitlab-token'] ? '***' : undefined,
      'x-gitlab-event': req.headers['x-gitlab-event'],
      'x-github-event': req.headers['x-github-event'],
      'x-hub-signature-256': req.headers['x-hub-signature-256'] ? '***' : undefined,
      'x-agenthub-review-task-id': req.headers['x-agenthub-review-task-id'],
    })}`);

    if (req.method === 'GET' && req.url === '/health') {
      console.log(`   ✓ Health check OK`);
      send(res, 200, { ok: true, uptime: process.uptime(), requests: requestCount });
      return;
    }

    if (req.method !== 'POST') {
      console.log(`   ⚠️  Método ${req.method} não suportado (esperado POST)`);
      send(res, 404, { error: 'not found' });
      return;
    }

    if (req.url !== '/webhooks/gitlab' && req.url !== '/webhooks/github') {
      console.log(`   ⚠️  URL ${req.url} não encontrada`);
      send(res, 404, { error: 'not found' });
      return;
    }

    console.log(`   → Processando webhook ${req.url === '/webhooks/github' ? 'GitHub' : 'GitLab'}...`);
    const handler = req.url === '/webhooks/github' ? handleGitHubWebhook : handleGitLabWebhook;
    handler(req, res, projects).catch(err => {
      console.error(`   ❌ Erro inesperado: ${err instanceof Error ? err.message : String(err)}`);
      console.error(`   Stack: ${err instanceof Error ? err.stack : 'n/a'}`);
      if (!res.headersSent) send(res, 500, { error: 'erro interno' });
    });
  });

  server.listen(port, () => {
    console.log(`✓ Webhook server iniciado em http://localhost:${port}`);
    console.log(`   GitLab endpoint: http://localhost:${port}/webhooks/gitlab`);
    console.log(`   GitHub endpoint: http://localhost:${port}/webhooks/github`);
    console.log(`   Health check: http://localhost:${port}/health\n`);
    console.log(`⏳ Aguardando webhooks...\n`);
  });

  // Heartbeat a cada 5 minutos para confirmar que o processo está vivo
  setInterval(() => {
    const uptime = Math.floor(process.uptime() / 60);
    console.log(`[${nowFormatted()}] 💓 Heartbeat: servidor ativo há ${uptime} minutos, ${requestCount} requisições processadas`);
  }, 5 * 60 * 1000);
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
