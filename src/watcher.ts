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

// ─── Poll ─────────────────────────────────────────────────────────────────────

export async function poll(projects: ProjectConfig[]): Promise<void> {
  const config = getAutoReviewConfig();
  const state = loadState();
  let anyNew  = false;

  for (const project of projects) {
    const { id: projectId, label } = project;
    const reviewLabel = requestLabel(project);
    const stateKey = projectStateKey(project);
    const seenIds = state.seenMrIds[stateKey] ?? [];

    console.log(`[${ts()}] 🔄 Verificando ${label} (${project.platform} ${projectId})...`);

    let openMrs: MergeRequest[];
    try {
      openMrs = await listOpenRequests(project);
    } catch (err) {
      console.error(`[${ts()}] ⚠️  Falha ao buscar ${reviewLabel}s de ${label}: ${String(err).slice(0, 200)}`);
      continue;
    }

    const newMrs = filterNewMrs(openMrs, seenIds);

    if (newMrs.length === 0) {
      console.log(`[${ts()}] ✓ ${label}: ${openMrs.length} ${reviewLabel}(s) aberto(s) — nenhum novo`);
      continue;
    }

    anyNew = true;
    console.log(`[${ts()}] 🆕 ${newMrs.length} novo(s) ${reviewLabel}(s) em ${label}:`);
    for (const mr of newMrs) {
      console.log(`        !${mr.iid}  "${mr.title}"  — @${mr.author.username}`);
    }

    for (const mr of newMrs) {
      // Mark as seen immediately to avoid reprocessing on error or disabled automation.
      state.seenMrIds[stateKey] = [...(state.seenMrIds[stateKey] ?? []), mr.iid];
      saveState(state);

      if (!config.enabled) {
        console.log(`[${ts()}] - AUTO_REVIEW_ENABLED=false; ${reviewLabel} !${mr.iid} registrado sem analise automatica`);
        notify(`Novo ${reviewLabel}: !${mr.iid}`, `"${mr.title}" by ${mr.author.name}`, config.notifyDesktop);
        continue;
      }

      console.log(`\n[${ts()}] 🔍 Analisando ${reviewLabel} !${mr.iid}: "${mr.title}" [${label}]`);
      notify(
        `Novo ${reviewLabel}: !${mr.iid}`,
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
    console.log(`[${ts()}] 💤 Nenhum MR novo em nenhum projeto`);
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
      state.seenMrIds[stateKey] = openMrs.map(mr => mr.iid);
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
