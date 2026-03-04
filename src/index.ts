import * as dotenv from 'dotenv';
dotenv.config();

import chalk from 'chalk';
import prompts from 'prompts';

import { listOpenMergeRequests, getMergeRequestChanges, approveMergeRequest, postComment, mergeMergeRequest } from './gitlab';
import { analyzeMergeRequest, type AIProvider } from './ai';
import { displayBanner, displayAnalysis, createSpinner, createParallelProgressDisplay } from './display';
import type { MergeRequest, ProjectType, MRAnalysisResult } from './types';

// ─── Configuração dos projetos ────────────────────────────────────────────────

const PROJECTS: Record<ProjectType, { label: string; envKey: string }> = {
  front: { label: 'Frontend Angular', envKey: 'GITLAB_PROJECT_ID' },
  api:   { label: 'API .NET',         envKey: 'GITLAB_API_PROJECT_ID' },
};

// ─── Validação de variáveis de ambiente ──────────────────────────────────────

function validateEnv(projectType: ProjectType): string {
  const base = ['GITLAB_URL', 'GITLAB_TOKEN'];
  const { envKey, label } = PROJECTS[projectType];

  const missingBase = base.filter(k => !process.env[k]);
  if (missingBase.length > 0) {
    console.error(chalk.red(`\n  ❌ Variáveis faltando no .env: ${missingBase.join(', ')}`));
    console.error(chalk.dim('  Copie .env.example para .env e preencha os valores.\n'));
    process.exit(1);
  }

  const projectId = process.env[envKey];
  if (!projectId) {
    console.error(chalk.red(`\n  ❌ Variável ${envKey} não definida no .env`));
    console.error(chalk.dim(`  Configure o ID do projeto ${label} e tente novamente.\n`));
    process.exit(1);
  }

  return projectId;
}

// ─── Data relativa ────────────────────────────────────────────────────────────

function relativeDate(isoDate: string): string {
  const days = Math.floor((Date.now() - new Date(isoDate).getTime()) / 86_400_000);
  if (days === 0) return 'hoje';
  if (days === 1) return 'ontem';
  if (days < 30)  return `${days}d atrás`;
  return new Date(isoDate).toLocaleDateString('pt-BR');
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  displayBanner();

  // ── 1. Escolher o projeto ──────────────────────────────────────────────────
  const projectRes = (await prompts(
    {
      type: 'select',
      name: 'projectType',
      message: 'Qual projeto deseja revisar?',
      choices: [
        {
          title: `${chalk.bold.magenta('Frontend')}  ${chalk.dim('Angular / TypeScript')}`,
          description: 'MRs do projeto Frontend Angular',
          value: 'front',
        },
        {
          title: `${chalk.bold.green('API .NET')}   ${chalk.dim('.NET / C#')}`,
          description: 'MRs do projeto API .NET',
          value: 'api',
        },
      ],
    },
    { onCancel: () => process.exit(0) },
  )) as { projectType: ProjectType };

  const projectType = projectRes.projectType;
  const projectId   = validateEnv(projectType);

  // ── 2. Escolher o AI provider ──────────────────────────────────────────────
  const providerRes = (await prompts(
    {
      type: 'select',
      name: 'provider',
      message: 'Qual IA usar para a análise?',
      choices: [
        {
          title: `${chalk.bold.cyan('Claude')}  ${chalk.dim('(claude --print)')}`,
          description: 'Usa o Claude CLI autenticado na sua máquina',
          value: 'claude',
        },
        {
          title: `${chalk.bold.blue('Gemini')}  ${chalk.dim('(gemini --yolo)')}`,
          description: 'Usa o Gemini CLI autenticado na sua máquina',
          value: 'gemini',
        },
      ],
    },
    { onCancel: () => process.exit(0) },
  )) as { provider: AIProvider };

  const provider = providerRes.provider;

  // Redesenha o banner com o provider escolhido
  displayBanner(provider);

  const projectLabel = PROJECTS[projectType].label;
  const providerName = provider === 'claude' ? 'Claude' : 'Gemini';

  // ── Loop principal: permite avaliar múltiplos MRs ─────────────────────────
  while (true) {
    // ── 3. Listar MRs abertos ────────────────────────────────────────────────
    const loadSpin = createSpinner(`Buscando MRs abertos em ${projectLabel}...`);
    let mrs: MergeRequest[];

    try {
      mrs = await listOpenMergeRequests(projectId);
      loadSpin.stop(`  ${chalk.green('✓')} ${mrs.length} MR(s) aberto(s) encontrado(s)\n`);
    } catch (err) {
      loadSpin.stop();
      console.error(chalk.red(`\n  ❌ ${err instanceof Error ? err.message : err}\n`));
      process.exit(1);
    }

    if (mrs.length === 0) {
      console.log(chalk.yellow('  Nenhum Merge Request aberto no momento.\n'));
      break;
    }

    // ── 4. Selecionar MR(s) ──────────────────────────────────────────────────
    const { selectedIids } = (await prompts(
      {
        type: 'multiselect',
        name: 'selectedIids',
        message: 'Selecione os MRs para analisar (Espaço = marcar, Enter = confirmar):',
        choices: mrs.map(mr => ({
          title:
            chalk.bold(`#${mr.iid}`) +
            (mr.draft ? chalk.dim(' [DRAFT]') : '') +
            `  ${mr.title.length > 44 ? mr.title.slice(0, 41) + '…' : mr.title}` +
            chalk.dim(`  — @${mr.author.username}, ${relativeDate(mr.updated_at)}`),
          value: mr.iid,
        })),
        hint: '– Espaço para marcar, Enter para confirmar, Ctrl+C para sair',
      },
      { onCancel: () => process.exit(0) },
    )) as { selectedIids: number[] };

    if (!selectedIids || selectedIids.length === 0) break;

    const selectedMRs = mrs.filter(mr => selectedIids.includes(mr.iid));

    // ── 5. Buscar diffs e analisar em paralelo ───────────────────────────────
    console.log(chalk.bold(`\n  Analisando ${selectedMRs.length} MR(s) em paralelo...\n`));

    const progress = createParallelProgressDisplay(
      selectedMRs.map(mr => `#${mr.iid}  ${mr.title.length > 36 ? mr.title.slice(0, 33) + '…' : mr.title}`),
    );

    async function fetchAndAnalyze(mr: MergeRequest, index: number): Promise<import('./types').ClaudeAnalysis> {
      progress.update(index, 'running', 'buscando diff...');
      const mrDetail = await getMergeRequestChanges(projectId, mr.iid);

      if (mrDetail.changes.length === 0) {
        throw new Error('MR sem alterações de código');
      }

      progress.update(index, 'running', `analisando com ${providerName}...`);
      const analysis = await analyzeMergeRequest(provider, projectType, mr, mrDetail.changes);
      progress.update(index, 'done', 'concluído!');
      return analysis;
    }

    const settled = await Promise.allSettled(
      selectedMRs.map((mr, i) => fetchAndAnalyze(mr, i)),
    );

    progress.stop();
    console.log();

    const results: MRAnalysisResult[] = settled.map((s, i) => {
      const mr = selectedMRs[i];
      if (s.status === 'fulfilled') {
        return { status: 'fulfilled', mr, analysis: s.value };
      }
      const reason = s.reason;
      return { status: 'rejected', mr, error: reason instanceof Error ? reason.message : String(reason) };
    });

    // ── 6. Revisar resultados um a um ────────────────────────────────────────
    for (const result of results) {
      const { mr } = result;

      if (result.status === 'rejected') {
        console.log(chalk.red(`\n  ❌ MR #${mr.iid} — ${mr.title}`));
        console.log(chalk.dim(`     Erro: ${result.error}\n`));
        await prompts(
          { type: 'confirm', name: 'next', message: 'Continuar para o próximo MR?', initial: true },
          { onCancel: () => process.exit(0) },
        );
        continue;
      }

      displayAnalysis(mr, result.analysis);

      const { action } = (await prompts(
        {
          type: 'select',
          name: 'action',
          message: `MR #${mr.iid} — O que deseja fazer?`,
          choices: [
            { title: chalk.green('✅  Aprovar o MR no GitLab'),                       description: 'Aprova via GitLab API',                                              value: 'approve' },
            { title: chalk.bold.green('✅🔀 Aprovar E fazer merge na develop'),        description: 'Aprova e dispara o merge (executa quando o pipeline passar)',        value: 'approve-merge' },
            { title: chalk.red('❌  Reprovar — postar análise como comentário'),       description: 'Posta o relatório no MR e não aprova',                               value: 'comment' },
            { title: chalk.green('✅  Aprovar E postar análise no MR'),                description: 'Aprova e registra o relatório para a equipe',                        value: 'both' },
            { title: chalk.bold.green('✅💬🔀 Aprovar, postar análise E fazer merge'), description: 'Aprova, posta o relatório e dispara o merge na develop',             value: 'both-merge' },
            { title: chalk.dim('↩   Pular este MR'),                                  value: 'skip' },
          ],
        },
        { onCancel: () => process.exit(0) },
      )) as { action: 'approve' | 'approve-merge' | 'comment' | 'both' | 'both-merge' | 'skip' };

      console.log();

      const shouldApprove = action === 'approve' || action === 'approve-merge' || action === 'both' || action === 'both-merge';
      const shouldComment = action === 'comment' || action === 'both' || action === 'both-merge';
      const shouldMerge   = action === 'approve-merge' || action === 'both-merge';

      if (shouldApprove) {
        const spin = createSpinner('Aprovando MR no GitLab...');
        try {
          await approveMergeRequest(projectId, mr.iid);
          spin.stop(`  ${chalk.green(`✅ MR #${mr.iid} aprovado com sucesso!`)}`);
        } catch (err) {
          spin.stop();
          console.error(chalk.red(`  ❌ Erro ao aprovar: ${err instanceof Error ? err.message : err}`));
        }
      }

      if (shouldComment) {
        const spin = createSpinner('Postando análise no GitLab...');
        try {
          const commentBody = `@${mr.author.username}\n\n${result.analysis.comentario_geral}`;
          await postComment(projectId, mr.iid, commentBody);
          spin.stop(`  ${chalk.yellow(`💬 Análise postada como comentário no MR #${mr.iid}`)}`);
        } catch (err) {
          spin.stop();
          console.error(chalk.red(`  ❌ Erro ao comentar: ${err instanceof Error ? err.message : err}`));
        }
      }

      if (shouldMerge) {
        const spin = createSpinner('Fazendo merge na develop...');
        try {
          await mergeMergeRequest(projectId, mr.iid);
          spin.stop(`  ${chalk.bold.green(`🔀 MR #${mr.iid} merge iniciado!`)}`);
        } catch (err) {
          spin.stop();
          console.error(chalk.red(`  ❌ Erro ao fazer merge: ${err instanceof Error ? err.message : err}`));
        }
      }

      if (action === 'skip') {
        console.log(chalk.dim('  Nenhuma ação executada.'));
      }

      console.log();
    } // fim do for (results)
  } // fim do loop principal
}

main().catch(err => {
  console.error(chalk.red(`\n  ❌ Erro inesperado: ${err instanceof Error ? err.message : err}\n`));
  process.exit(1);
});
