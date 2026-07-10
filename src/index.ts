import * as dotenv from 'dotenv';
dotenv.config();

import chalk from 'chalk';
import prompts from 'prompts';

import { listOpenMergeRequests, getMergeRequestChanges, approveMergeRequest, postComment, mergeMergeRequest } from './gitlab';
import { analyzeMergeRequest, getEnabledProviders, getProviderConfig, type AIProvider } from './ai';
import { displayBanner, displayAnalysis, createSpinner, createParallelProgressDisplay } from './display';
import { loadProjects } from './projects';
import type { MergeRequest, MRAnalysisResult } from './types';

function validateBaseEnv(): void {
  const missing = ['GITLAB_URL', 'GITLAB_TOKEN'].filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error(chalk.red(`\n  Missing variables in .env: ${missing.join(', ')}`));
    console.error(chalk.dim('  Copy .env.example to .env and fill in the values.\n'));
    process.exit(1);
  }
}

function relativeDate(isoDate: string): string {
  const days = Math.floor((Date.now() - new Date(isoDate).getTime()) / 86_400_000);
  if (days === 0) return 'hoje';
  if (days === 1) return 'ontem';
  if (days < 30) return `${days}d atras`;
  return new Date(isoDate).toLocaleDateString('pt-BR');
}

function providerTitle(provider: AIProvider): string {
  switch (provider) {
    case 'codex': return 'Codex';
    case 'gemini': return 'Gemini';
    case 'code': return 'Claude Code';
  }
}

async function main(): Promise<void> {
  displayBanner();
  validateBaseEnv();

  const allProjects = loadProjects();

  if (allProjects.length === 0) {
    console.error(chalk.red('\n  No projects configured.'));
    console.error(chalk.dim('  Set GITLAB_PROJECTS in your .env (e.g. 133:front:Frontend Angular)\n'));
    process.exit(1);
  }

  const typeColor: Record<string, (s: string) => string> = {
    front: chalk.bold.magenta,
    api: chalk.bold.green,
    generic: chalk.bold.cyan,
  };

  const projectRes = (await prompts(
    {
      type: allProjects.length === 1 ? null : 'select',
      name: 'index',
      message: 'Which project do you want to review?',
      choices: allProjects.map((p, i) => ({
        title: (typeColor[p.type] ?? chalk.bold)(p.label) + chalk.dim(`  [${p.type}]`),
        value: i,
      })),
    },
    { onCancel: () => process.exit(0) },
  )) as { index: number };

  const selectedProject = allProjects[projectRes?.index ?? 0];
  const { id: projectId, type: projectType, label: projectLabel } = selectedProject;

  const enabledProviders = getEnabledProviders();
  if (enabledProviders.length === 0) {
    console.error(chalk.red('\n  Nenhuma CLI de IA habilitada.'));
    console.error(chalk.dim('  Ative CODEX_ENABLED, GEMINI_ENABLED ou CODE_ENABLED no .env.\n'));
    process.exit(1);
  }

  const providerRes = (await prompts(
    {
      type: 'select',
      name: 'provider',
      message: 'Qual IA usar para a analise?',
      choices: enabledProviders.map(provider => {
        const cfg = getProviderConfig(provider);
        return {
          title: `${chalk.bold(providerTitle(provider))}  ${chalk.dim(`(${cfg.cmd} ${cfg.args.join(' ')})`)}`,
          description: cfg.description,
          value: provider,
        };
      }),
    },
    { onCancel: () => process.exit(0) },
  )) as { provider: AIProvider };

  const provider = providerRes.provider;
  const providerName = getProviderConfig(provider).label;

  displayBanner(provider);

  while (true) {
    const loadSpin = createSpinner(`Buscando MRs abertos em ${projectLabel}...`);
    let mrs: MergeRequest[];

    try {
      mrs = await listOpenMergeRequests(projectId);
      loadSpin.stop(`  ${chalk.green('V')} ${mrs.length} MR(s) aberto(s) encontrado(s)\n`);
    } catch (err) {
      loadSpin.stop();
      console.error(chalk.red(`\n  ${err instanceof Error ? err.message : err}\n`));
      process.exit(1);
    }

    if (mrs.length === 0) {
      console.log(chalk.yellow('  Nenhum Merge Request aberto no momento.\n'));
      break;
    }

    const { selectedIids } = (await prompts(
      {
        type: 'multiselect',
        name: 'selectedIids',
        message: 'Selecione os MRs para analisar (Espaco = marcar, Enter = confirmar):',
        choices: mrs.map(mr => ({
          title:
            chalk.bold(`#${mr.iid}`) +
            (mr.draft ? chalk.dim(' [DRAFT]') : '') +
            `  ${mr.title.length > 44 ? mr.title.slice(0, 41) + '.' : mr.title}` +
            chalk.dim(`  - @${mr.author.username}, ${relativeDate(mr.updated_at)}`),
          value: mr.iid,
        })),
        hint: '- Espaco para marcar, Enter para confirmar, Ctrl+C para sair',
      },
      { onCancel: () => process.exit(0) },
    )) as { selectedIids: number[] };

    if (!selectedIids || selectedIids.length === 0) break;

    const selectedMRs = mrs.filter(mr => selectedIids.includes(mr.iid));
    console.log(chalk.bold(`\n  Analisando ${selectedMRs.length} MR(s) em paralelo...\n`));

    const progress = createParallelProgressDisplay(
      selectedMRs.map(mr => `#${mr.iid}  ${mr.title.length > 36 ? mr.title.slice(0, 33) + '.' : mr.title}`),
    );

    async function fetchAndAnalyze(mr: MergeRequest, index: number): Promise<import('./types').ClaudeAnalysis> {
      progress.update(index, 'running', 'buscando diff...');
      const mrDetail = await getMergeRequestChanges(projectId, mr.iid);

      if (mrDetail.changes.length === 0) {
        throw new Error('MR sem alteracoes de codigo');
      }

      progress.update(index, 'running', `analisando com ${providerName}...`);
      const analysis = await analyzeMergeRequest(provider, projectType, mr, mrDetail.changes);
      progress.update(index, 'done', 'concluido!');
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

    for (const result of results) {
      const { mr } = result;

      if (result.status === 'rejected') {
        console.log(chalk.red(`\n  MR #${mr.iid} - ${mr.title}`));
        console.log(chalk.dim(`     Erro: ${result.error}\n`));
        await prompts(
          { type: 'confirm', name: 'next', message: 'Continuar para o proximo MR?', initial: true },
          { onCancel: () => process.exit(0) },
        );
        continue;
      }

      displayAnalysis(mr, result.analysis);

      const { action } = (await prompts(
        {
          type: 'select',
          name: 'action',
          message: `MR #${mr.iid} - O que deseja fazer?`,
          choices: [
            { title: chalk.green('Aprovar o MR no GitLab'), description: 'Aprova via GitLab API', value: 'approve' },
            { title: chalk.bold.green('Aprovar E fazer merge na develop'), description: 'Aprova e dispara o merge quando o pipeline passar', value: 'approve-merge' },
            { title: chalk.red('Reprovar - postar analise como comentario'), description: 'Posta o relatorio no MR e nao aprova', value: 'comment' },
            { title: chalk.green('Aprovar E postar analise no MR'), description: 'Aprova e registra o relatorio para a equipe', value: 'both' },
            { title: chalk.bold.green('Aprovar, postar analise E fazer merge'), description: 'Aprova, posta o relatorio e dispara o merge na develop', value: 'both-merge' },
            { title: chalk.dim('Pular este MR'), value: 'skip' },
          ],
        },
        { onCancel: () => process.exit(0) },
      )) as { action: 'approve' | 'approve-merge' | 'comment' | 'both' | 'both-merge' | 'skip' };

      console.log();

      const shouldApprove = action === 'approve' || action === 'approve-merge' || action === 'both' || action === 'both-merge';
      const shouldComment = action === 'comment' || action === 'both' || action === 'both-merge';
      const shouldMerge = action === 'approve-merge' || action === 'both-merge';

      if (shouldApprove) {
        const spin = createSpinner('Aprovando MR no GitLab...');
        try {
          await approveMergeRequest(projectId, mr.iid);
          spin.stop(`  ${chalk.green(`MR #${mr.iid} aprovado com sucesso!`)}`);
        } catch (err) {
          spin.stop();
          console.error(chalk.red(`  Erro ao aprovar: ${err instanceof Error ? err.message : err}`));
        }
      }

      if (shouldComment) {
        const spin = createSpinner('Postando analise no GitLab...');
        try {
          const commentBody = `@${mr.author.username}\n\n${result.analysis.comentario_geral}`;
          await postComment(projectId, mr.iid, commentBody);
          spin.stop(`  ${chalk.yellow(`Analise postada como comentario no MR #${mr.iid}`)}`);
        } catch (err) {
          spin.stop();
          console.error(chalk.red(`  Erro ao comentar: ${err instanceof Error ? err.message : err}`));
        }
      }

      if (shouldMerge) {
        const spin = createSpinner('Fazendo merge na develop...');
        try {
          await mergeMergeRequest(projectId, mr.iid);
          spin.stop(`  ${chalk.bold.green(`MR #${mr.iid} merge iniciado!`)}`);
        } catch (err) {
          spin.stop();
          console.error(chalk.red(`  Erro ao fazer merge: ${err instanceof Error ? err.message : err}`));
        }
      }

      if (action === 'skip') {
        console.log(chalk.dim('  Nenhuma acao executada.'));
      }

      console.log();
    }
  }
}

main().catch(err => {
  console.error(chalk.red(`\n  Erro inesperado: ${err instanceof Error ? err.message : err}\n`));
  process.exit(1);
});
