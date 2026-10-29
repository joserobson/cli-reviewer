import { readFileSync, writeFileSync, existsSync } from 'fs';
import { config } from 'dotenv';

import { analyzeAndApply, getAutoReviewConfig, notify, printUsage } from './automation';
import { timeFormatted } from './datetime-utils';
import { envInt } from './env-utils';
import { loadProjects } from './projects';
import { listOpenRequests, requestLabel } from './scm';
import type { MergeRequest, ProjectConfig } from './types';

config();

// ─── Estado persistente ───────────────────────────────────────────────────────

export const STATE_PATH = process.env.WATCHER_STATE_PATH ?? '.watcher-state.json';

export interface WatcherState {
  seenMrIds: Record<string, number[]>; // projectId → IIDs já analisados
  seenShas?: Record<string, Record<string, string>>; // projectId → IID → SHA do último commit analisado
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

// ─── Poll ─────────────────────────────────────────────────────────────────────

export async function poll(projects: ProjectConfig[]): Promise<void> {
  const config = getAutoReviewConfig();
  const state = loadState();
  let anyNew  = false;

  for (const project of projects) {
    const { id: projectId, label } = project;
    const reviewLabel = requestLabel(project);
    const stateKey = projectStateKey(project);

    console.log(`[${ts()}] 🔄 Verificando ${label} (${project.platform} ${projectId})...`);

    let openMrs: MergeRequest[];
    try {
      openMrs = await listOpenRequests(project);
    } catch (err) {
      console.error(`[${ts()}] ⚠️  Falha ao buscar ${reviewLabel}s de ${label}: ${String(err).slice(0, 200)}`);
      continue;
    }

    const { toReview, backfill } = detectMrsToReview(
      openMrs,
      state.seenMrIds[stateKey] ?? [],
      state.seenShas?.[stateKey] ?? {},
    );

    // Estado antigo (sem SHA): registra o commit atual sem reanalisar.
    if (backfill.length > 0) {
      for (const mr of backfill) recordSeen(state, stateKey, mr);
      saveState(state);
    }

    if (toReview.length === 0) {
      console.log(`[${ts()}] ✓ ${label}: ${openMrs.length} ${reviewLabel}(s) aberto(s) — nenhum novo ou atualizado`);
      continue;
    }

    anyNew = true;
    console.log(`[${ts()}] 🆕 ${toReview.length} ${reviewLabel}(s) para analisar em ${label}:`);
    for (const { mr, reason } of toReview) {
      const tag = reason === 'updated' ? 'novo commit' : 'novo';
      console.log(`        !${mr.iid}  "${mr.title}"  — @${mr.author.username}  (${tag})`);
    }

    for (const { mr, reason } of toReview) {
      // Mark as seen immediately to avoid reprocessing on error or disabled automation.
      recordSeen(state, stateKey, mr);
      saveState(state);

      const eventLabel = reason === 'updated' ? `${reviewLabel} atualizado` : `Novo ${reviewLabel}`;

      if (!config.enabled) {
        console.log(`[${ts()}] - AUTO_REVIEW_ENABLED=false; ${reviewLabel} !${mr.iid} registrado sem analise automatica`);
        notify(`${eventLabel}: !${mr.iid}`, `"${mr.title}" by ${mr.author.name}`, config.notifyDesktop);
        continue;
      }

      console.log(`\n[${ts()}] 🔍 Analisando ${reviewLabel} !${mr.iid}${reason === 'updated' ? ' (novo commit)' : ''}: "${mr.title}" [${label}]`);
      notify(
        `${eventLabel}: !${mr.iid}`,
        `"${mr.title}" by ${mr.author.name} — Iniciando análise...`,
        config.notifyDesktop,
      );

      try {
        await analyzeAndApply(project, mr, config);
      } catch (err) {
        console.error(`[${ts()}] ❌ Falha ao analisar ${reviewLabel} !${mr.iid}: ${String(err).slice(0, 300)}`);
        notify(`Falha - ${reviewLabel} !${mr.iid}`, String(err).slice(0, 120), config.notifyDesktop);
      }
    }
  }

  if (!anyNew) {
    console.log(`[${ts()}] 💤 Nenhum MR novo ou atualizado em nenhum projeto`);
  }
}

// ─── Seed (primeira execução) ─────────────────────────────────────────────────

export async function seedInitialState(projects: ProjectConfig[]): Promise<void> {
  const state  = loadState();
  let   seeded = false;

  for (const project of projects) {
    const { label } = project;
    const reviewLabel = requestLabel(project);
    const stateKey = projectStateKey(project);
    if (state.seenMrIds[stateKey] !== undefined) {
      console.log(`[init] ${label}: estado já existe (${state.seenMrIds[stateKey].length} ${reviewLabel}(s) registrado(s))`);
      continue;
    }

    console.log(`[init] ${label}: carregando ${reviewLabel}s abertos...`);
    try {
      const openMrs = await listOpenRequests(project);
      state.seenMrIds[stateKey] = [];
      for (const mr of openMrs) recordSeen(state, stateKey, mr);
      console.log(`[init] ${label}: ${openMrs.length} ${reviewLabel}(s) existente(s) marcado(s) como já vistos — não serão re-analisados`);
      seeded = true;
    } catch (err) {
      console.error(`[init] ⚠️  Erro ao carregar ${reviewLabel}s de ${label}: ${String(err).slice(0, 200)}`);
      state.seenMrIds[stateKey] = [];
    }
  }

  if (seeded) saveState(state);
}

// ─── Helpers de detecção de novos MRs (exportados para testes) ────────────────

export function filterNewMrs(openMrs: MergeRequest[], seenIds: number[]): MergeRequest[] {
  return openMrs.filter(mr => !seenIds.includes(mr.iid));
}

export type ReviewReason = 'new' | 'updated';

export interface MrToReview {
  mr: MergeRequest;
  reason: ReviewReason;
}

/**
 * Decide o que analisar: MRs nunca vistos ('new') e MRs já vistos cujo último
 * commit mudou ('updated'). MRs vistos sem SHA registrado (estado antigo) vão
 * para `backfill`: só gravam o SHA atual, sem reanálise.
 */
export function detectMrsToReview(
  openMrs: MergeRequest[],
  seenIds: number[],
  seenShas: Record<string, string> = {},
): { toReview: MrToReview[]; backfill: MergeRequest[] } {
  const toReview: MrToReview[] = [];
  const backfill: MergeRequest[] = [];

  for (const mr of openMrs) {
    if (!seenIds.includes(mr.iid)) {
      toReview.push({ mr, reason: 'new' });
      continue;
    }
    if (!mr.sha) continue;

    const known = seenShas[String(mr.iid)];
    if (known === undefined) backfill.push(mr);
    else if (known !== mr.sha) toReview.push({ mr, reason: 'updated' });
  }

  return { toReview, backfill };
}

export function recordSeen(state: WatcherState, stateKey: string, mr: MergeRequest): void {
  const ids = state.seenMrIds[stateKey] ?? [];
  if (!ids.includes(mr.iid)) state.seenMrIds[stateKey] = [...ids, mr.iid];

  if (mr.sha) {
    state.seenShas ??= {};
    state.seenShas[stateKey] ??= {};
    state.seenShas[stateKey][String(mr.iid)] = mr.sha;
  }
}

function projectStateKey(project: ProjectConfig): string {
  return `${project.platform}:${project.id}`;
}

// ─── Utilitários ──────────────────────────────────────────────────────────────

function ts(): string {
  return timeFormatted();
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('┌──────────────────────────────────────────┐');
  console.log('│  CLI Reviewer — Watcher                  │');
  console.log('│  Ctrl+C para encerrar                    │');
  console.log('└──────────────────────────────────────────┘');

  const projects = loadProjects();

  if (projects.length === 0) {
    console.error('❌ Nenhum projeto configurado. Defina GITLAB_PROJECTS ou GITHUB_REPOSITORIES no .env');
    console.error('   Exemplo: GITLAB_PROJECTS=133:front:Frontend ou GITHUB_REPOSITORIES=owner/repo:generic:CLI');
    process.exit(1);
  }

  const autoConfig = getAutoReviewConfig();
  if (autoConfig.mode !== 'polling') {
    console.error('❌ AUTO_REVIEW_MODE=webhook configurado. Use npm run webhook.');
    process.exit(1);
  }

  const intervalMin = envInt('WATCH_INTERVAL_MINUTES', 2);
  if (intervalMin <= 0) {
    console.error('❌ WATCH_INTERVAL_MINUTES deve ser maior que zero.');
    process.exit(1);
  }
  const intervalMs  = intervalMin * 60_000;

  printUsage();
  console.log(`\n🔁 Monitorando ${projects.length} projeto(s):`);
  for (const p of projects) console.log(`   [${p.platform}/${p.type}] ${p.label} (id: ${p.id})`);
  console.log(`   Intervalo: ${intervalMin} minuto(s)\n`);
  console.log(`   Auto review: ${autoConfig.enabled ? 'ativo' : 'inativo'} | Comentarios: ${autoConfig.postComment ? 'sim' : 'nao'} | Drafts: ${autoConfig.skipDraft ? 'ignorar' : 'analisar'} | Aprovar: ${autoConfig.approveOnSuccess ? 'sim' : 'nao'} | Merge: ${autoConfig.mergeOnSuccess ? 'sim' : 'nao'}\n`);

  await seedInitialState(projects);

  console.log(`\n[${timeFormatted()}] ▶  Iniciando primeiro ciclo de verificação...\n`);
  await poll(projects);

  setInterval(async () => {
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`[${timeFormatted()}] ▶  Novo ciclo de verificação`);
    console.log('─'.repeat(50));
    await poll(projects).catch(err =>
      console.error(`[${timeFormatted()}] Erro inesperado no poll:`, err),
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
