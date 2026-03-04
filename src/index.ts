import * as dotenv from 'dotenv';
dotenv.config();

import chalk from 'chalk';
import prompts from 'prompts';

import { listOpenMergeRequests, getMergeRequestChanges, approveMergeRequest, postComment, mergeMergeRequest } from './gitlab';
import { analyzeMergeRequest, type AIProvider } from './ai';
import { displayBanner, displayAnalysis, createSpinner } from './display';
import type { MergeRequest, ProjectType } from './types';

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

    // ── 4. Selecionar MR ─────────────────────────────────────────────────────
    const { mrIid } = (await prompts(
      {
        type: 'select',
        name: 'mrIid',
        message: 'Selecione o Merge Request para analisar:',
        choices: [
          ...mrs.map(mr => ({
            title:
              chalk.bold(`#${mr.iid}`) +
              (mr.draft ? chalk.dim(' [DRAFT]') : '') +
              `  ${mr.title.length > 44 ? mr.title.slice(0, 41) + '…' : mr.title}` +
              chalk.dim(`  — @${mr.author.username}, ${relativeDate(mr.updated_at)}`),
            value: mr.iid,
          })),
          {
            title: chalk.dim('↩   Sair'),
            value: -1,
          },
        ],
      },
      { onCancel: () => process.exit(0) },
    )) as { mrIid: number };

    if (mrIid === -1) break;

    const selectedMR = mrs.find(mr => mr.iid === mrIid)!;

    // ── 5. Buscar diff ───────────────────────────────────────────────────────
    const diffSpin = createSpinner('Buscando alterações do MR...');
    let mrDetail: Awaited<ReturnType<typeof getMergeRequestChanges>>;

    try {
      mrDetail = await getMergeRequestChanges(projectId, mrIid);
      diffSpin.stop(`  ${chalk.green('✓')} ${mrDetail.changes.length} arquivo(s) alterado(s)\n`);
    } catch (err) {
      diffSpin.stop();
      console.error(chalk.red(`\n  ❌ ${err instanceof Error ? err.message : err}\n`));
      continue;
    }

    if (mrDetail.changes.length === 0) {
      console.log(chalk.yellow('  Este MR não possui alterações de código.\n'));
      continue;
    }

    // ── 6. Analisar com o CLI escolhido ──────────────────────────────────────
    const analyzeSpin = createSpinner(`Analisando com ${providerName} (aguarde)...`);
    let analysis: Awaited<ReturnType<typeof analyzeMergeRequest>>;

    try {
      analysis = await analyzeMergeRequest(provider, projectType, selectedMR, mrDetail.changes);
      analyzeSpin.stop(`  ${chalk.green('✓')} Análise concluída!\n`);
    } catch (err) {
      analyzeSpin.stop();
      console.error(chalk.red(`\n  ❌ ${err instanceof Error ? err.message : err}\n`));
      continue;
    }

    // ── 7. Exibir análise ────────────────────────────────────────────────────
    displayAnalysis(selectedMR, analysis);

    // ── 8. Ação do usuário ───────────────────────────────────────────────────
    const { action } = (await prompts(
      {
        type: 'select',
        name: 'action',
        message: 'O que deseja fazer?',
        choices: [
          {
            title: chalk.green('✅  Aprovar o MR no GitLab'),
            description: 'Aprova via GitLab API',
            value: 'approve',
          },
          {
            title: chalk.bold.green('✅🔀 Aprovar E fazer merge na develop'),
            description: 'Aprova e dispara o merge (executa quando o pipeline passar)',
            value: 'approve-merge',
          },
          {
            title: chalk.red('❌  Reprovar — postar análise como comentário no MR'),
            description: 'Posta o relatório no MR e não aprova',
            value: 'comment',
          },
          {
            title: chalk.green('✅  Aprovar E postar análise no MR'),
            description: 'Aprova e registra o relatório para a equipe',
            value: 'both',
          },
          {
            title: chalk.bold.green('✅💬🔀 Aprovar, postar análise E fazer merge'),
            description: 'Aprova, posta o relatório e dispara o merge na develop',
            value: 'both-merge',
          },
          {
            title: chalk.dim('↩   Voltar à lista de MRs'),
            value: 'skip',
          },
        ],
      },
      { onCancel: () => process.exit(0) },
    )) as { action: 'approve' | 'approve-merge' | 'comment' | 'both' | 'both-merge' | 'skip' };

    console.log();

    // ── 9. Executar ──────────────────────────────────────────────────────────
    const shouldApprove = action === 'approve' || action === 'approve-merge' || action === 'both' || action === 'both-merge';
    const shouldComment = action === 'comment' || action === 'both' || action === 'both-merge';
    const shouldMerge   = action === 'approve-merge' || action === 'both-merge';

    if (shouldApprove) {
      const spin = createSpinner('Aprovando MR no GitLab...');
      try {
        await approveMergeRequest(projectId, mrIid);
        spin.stop(`  ${chalk.green(`✅ MR #${mrIid} aprovado com sucesso!`)}`);
      } catch (err) {
        spin.stop();
        console.error(chalk.red(`  ❌ Erro ao aprovar: ${err instanceof Error ? err.message : err}`));
      }
    }

    if (shouldComment) {
      const spin = createSpinner('Postando análise no GitLab...');
      try {
        const commentBody = `@${selectedMR.author.username}\n\n${analysis.comentario_geral}`;
        await postComment(projectId, mrIid, commentBody);
        spin.stop(`  ${chalk.yellow(`💬 Análise postada como comentário no MR #${mrIid}`)}`);
      } catch (err) {
        spin.stop();
        console.error(chalk.red(`  ❌ Erro ao comentar: ${err instanceof Error ? err.message : err}`));
      }
    }

    if (shouldMerge) {
      const spin = createSpinner('Fazendo merge na develop...');
      try {
        await mergeMergeRequest(projectId, mrIid);
        spin.stop(`  ${chalk.bold.green(`🔀 MR #${mrIid} merge iniciado! (será concluído quando o pipeline passar)`)}`);
      } catch (err) {
        spin.stop();
        console.error(chalk.red(`  ❌ Erro ao fazer merge: ${err instanceof Error ? err.message : err}`));
      }
    }

    if (action === 'skip') {
      console.log(chalk.dim('  Nenhuma ação executada.'));
    }

    console.log();
  } // fim do loop principal
}

main().catch(err => {
  console.error(chalk.red(`\n  ❌ Erro inesperado: ${err instanceof Error ? err.message : err}\n`));
  process.exit(1);
});
