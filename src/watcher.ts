import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { config } from 'dotenv';

import { listOpenMergeRequests, getMergeRequestChanges, postComment } from './gitlab';
import { AI_PROVIDERS, analyzeMergeRequest } from './ai';
import { selectProvider, recordUsage, estimateTokens, getUsageSummary } from './usage-tracker';
import { loadProjects } from './projects';
import type { MergeRequest, ProjectConfig } from './types';

config();

// ─── Estado persistente ───────────────────────────────────────────────────────

export const STATE_PATH = '.watcher-state.json';

export interface WatcherState {
  seenMrIds: Record<string, number[]>; // projectId → IIDs já analisados
}

export function loadState(path = STATE_PATH): WatcherState {
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as WatcherState;
    } catch {}
  }
  return { seenMrIds: {} };
}

export function saveState(state: WatcherState, path = STATE_PATH): void {
  writeFileSync(path, JSON.stringify(state, null, 2), 'utf8');
}

// ─── Notificação cross-platform ───────────────────────────────────────────────

function notify(title: string, message: string): void {
  const safeTitle   = title.replace(/'/g, '`').replace(/"/g, '`').slice(0, 60);
  const safeMessage = message.replace(/'/g, '`').replace(/"/g, '`').slice(0, 150);

  try {
    if (process.platform === 'win32') {
      execSync(
        `powershell -Command "` +
        `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null; ` +
        `$t = [Windows.UI.Notifications.ToastTemplateType]::ToastText02; ` +
        `$x = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent($t); ` +
        `$x.GetElementsByTagName('text')[0].AppendChild($x.CreateTextNode('${safeTitle}')) | Out-Null; ` +
        `$x.GetElementsByTagName('text')[1].AppendChild($x.CreateTextNode('${safeMessage}')) | Out-Null; ` +
        `$n = [Windows.UI.Notifications.ToastNotification]::new($x); ` +
        `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('MR Reviewer').Show($n)"`,
        { stdio: 'ignore' },
      );
    } else if (process.platform === 'darwin') {
      execSync(
        `osascript -e 'display notification "${safeMessage}" with title "${safeTitle}"'`,
        { stdio: 'ignore' },
      );
    } else {
      // Linux — requires libnotify-bin (notify-send)
      execSync(`notify-send "${safeTitle}" "${safeMessage}"`, { stdio: 'ignore' });
    }
  } catch {
    // Notification failure must never interrupt analysis
  }
}

// ─── Análise de um MR ─────────────────────────────────────────────────────────

async function analyzeAndPost(project: ProjectConfig, mr: MergeRequest): Promise<void> {
  const { id: projectId, type: projectType } = project;

  console.log(`   ↳ Buscando diff do MR !${mr.iid}...`);
  const detail  = await getMergeRequestChanges(projectId, mr.iid);
  const changes = detail.changes ?? [];

  if (changes.length === 0) {
    console.log(`   ⚠️  MR !${mr.iid} sem alterações de código — pulando`);
    return;
  }

  // Estimativa de tokens: conteúdo do diff + overhead fixo do template de prompt
  const diffText     = changes.map(c => c.diff).join('\n');
  const promptTokens = estimateTokens(diffText) + 2_000;
  const provider     = selectProvider(promptTokens);

  console.log(`   ↳ ~${promptTokens.toLocaleString()} tokens estimados → enviando para ${provider.toUpperCase()}...`);

  const analysis = await analyzeMergeRequest(provider, projectType, mr, changes);
  recordUsage(provider, promptTokens);

  console.log(`   ↳ Análise concluída. Postando comentário no GitLab...`);
  await postComment(projectId, mr.iid, analysis.comentario_geral);

  const verdict = analysis.aprovacao_recomendada ? '✅ Aprovado' : '⚠️ Revisão necessária';
  console.log(`   ✓ ${verdict} | ${analysis.sugestoes.length} sugestão(ões) | Comentário postado em !${mr.iid}`);

  notify(
    `MR !${mr.iid} — ${verdict}`,
    `"${mr.title}" by ${mr.author.name} (via ${provider})`,
  );
}

// ─── Poll ─────────────────────────────────────────────────────────────────────

export async function poll(projects: ProjectConfig[]): Promise<void> {
  const state = loadState();
  let anyNew  = false;

  for (const project of projects) {
    const { id: projectId, label } = project;
    const seenIds = state.seenMrIds[projectId] ?? [];

    console.log(`[${ts()}] 🔄 Verificando ${label} (projeto ${projectId})...`);

    let openMrs: MergeRequest[];
    try {
      openMrs = await listOpenMergeRequests(projectId);
    } catch (err) {
      console.error(`[${ts()}] ⚠️  Falha ao buscar MRs de ${label}: ${String(err).slice(0, 200)}`);
      continue;
    }

    const newMrs = openMrs.filter(mr => !seenIds.includes(mr.iid));

    if (newMrs.length === 0) {
      console.log(`[${ts()}] ✓ ${label}: ${openMrs.length} MR(s) aberto(s) — nenhum novo`);
      continue;
    }

    anyNew = true;
    console.log(`[${ts()}] 🆕 ${newMrs.length} novo(s) MR(s) em ${label}:`);
    for (const mr of newMrs) {
      console.log(`        !${mr.iid}  "${mr.title}"  — @${mr.author.username}`);
    }

    for (const mr of newMrs) {
      // Mark as seen immediately to avoid reprocessing on error
      state.seenMrIds[projectId] = [...(state.seenMrIds[projectId] ?? []), mr.iid];
      saveState(state);

      console.log(`\n[${ts()}] 🔍 Analisando MR !${mr.iid}: "${mr.title}" [${label}]`);
      notify(
        `Novo MR: !${mr.iid}`,
        `"${mr.title}" by ${mr.author.name} — Iniciando análise...`,
      );

      try {
        await analyzeAndPost(project, mr);
      } catch (err) {
        console.error(`[${ts()}] ❌ Falha ao analisar MR !${mr.iid}: ${String(err).slice(0, 300)}`);
        notify(`Falha — MR !${mr.iid}`, String(err).slice(0, 120));
      }
    }
  }

  if (!anyNew) {
    console.log(`[${ts()}] 💤 Nenhum MR novo em nenhum projeto`);
  }
}

// ─── Seed (primeira execução) ─────────────────────────────────────────────────

export async function seedInitialState(projects: ProjectConfig[]): Promise<void> {
  const state  = loadState();
  let   seeded = false;

  for (const { id: projectId, label } of projects) {
    if (state.seenMrIds[projectId] !== undefined) {
      console.log(`[init] ${label}: estado já existe (${state.seenMrIds[projectId].length} MR(s) registrado(s))`);
      continue;
    }

    console.log(`[init] ${label}: carregando MRs abertos...`);
    try {
      const openMrs = await listOpenMergeRequests(projectId);
      state.seenMrIds[projectId] = openMrs.map(mr => mr.iid);
      console.log(`[init] ${label}: ${openMrs.length} MR(s) existente(s) marcado(s) como já vistos — não serão re-analisados`);
      seeded = true;
    } catch (err) {
      console.error(`[init] ⚠️  Erro ao carregar MRs de ${label}: ${String(err).slice(0, 200)}`);
      state.seenMrIds[projectId] = [];
    }
  }

  if (seeded) saveState(state);
}

// ─── Helpers de detecção de novos MRs (exportados para testes) ────────────────

export function filterNewMrs(openMrs: MergeRequest[], seenIds: number[]): MergeRequest[] {
  return openMrs.filter(mr => !seenIds.includes(mr.iid));
}

// ─── Utilitários ──────────────────────────────────────────────────────────────

function ts(): string {
  return new Date().toLocaleTimeString('pt-BR');
}

function printUsage(): void {
  const u = getUsageSummary();
  console.log(`\n📊 Uso estimado este mês (${u.month}):`);

  for (const key of AI_PROVIDERS) {
    const p = u[key];
    const limitText = p.limit > 0
      ? ` / ${p.limit.toLocaleString()} tokens (${Math.round((p.estimatedTokens / p.limit) * 100)}% usado)`
      : ' (sem limite configurado)';
    const status = p.enabled ? 'habilitado' : 'desabilitado';
    console.log(`   ${key.padEnd(8)}: ${p.estimatedTokens.toLocaleString()} tokens est.${limitText} | ${p.requests} análise(s) | ${status}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('┌──────────────────────────────────────────┐');
  console.log('│  MR Reviewer — Watcher                   │');
  console.log('│  Ctrl+C para encerrar                    │');
  console.log('└──────────────────────────────────────────┘');

  const projects = loadProjects();

  if (projects.length === 0) {
    console.error('❌ Nenhum projeto configurado. Defina GITLAB_PROJECTS no .env');
    console.error('   Exemplo: GITLAB_PROJECTS=133:front:Frontend,134:api:API .NET');
    process.exit(1);
  }

  const intervalMin = parseInt(process.env.WATCH_INTERVAL_MINUTES ?? '2');
  const intervalMs  = intervalMin * 60_000;

  printUsage();
  console.log(`\n🔁 Monitorando ${projects.length} projeto(s):`);
  for (const p of projects) console.log(`   [${p.type}] ${p.label} (id: ${p.id})`);
  console.log(`   Intervalo: ${intervalMin} minuto(s)\n`);

  await seedInitialState(projects);

  console.log(`\n[${new Date().toLocaleTimeString('pt-BR')}] ▶  Iniciando primeiro ciclo de verificação...\n`);
  await poll(projects);

  setInterval(async () => {
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`[${new Date().toLocaleTimeString('pt-BR')}] ▶  Novo ciclo de verificação`);
    console.log('─'.repeat(50));
    await poll(projects).catch(err =>
      console.error(`[${new Date().toLocaleTimeString('pt-BR')}] Erro inesperado no poll:`, err),
    );
    console.log(`\n⏳ Próximo ciclo em ${intervalMin} minuto(s)...`);
  }, intervalMs);

  console.log(`\n⏳ Próximo ciclo em ${intervalMin} minuto(s)...`);
}

// Executa somente quando chamado diretamente (não quando importado em testes)
if (require.main === module) {
  main().catch(err => {
    console.error('Erro fatal:', err);
    process.exit(1);
  });
}
