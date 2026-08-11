import { execSync } from 'child_process';

import { AI_PROVIDERS, analyzeMergeRequest } from './ai';
import { approveRequest, getRequestChanges, mergeRequest, postRequestComment, requestLabel } from './scm';
import { selectProvider, recordUsage, estimateTokens, getUsageSummary } from './usage-tracker';
import { envFlag } from './env-utils';
import { recordReviewEvent } from './review-store';
import type { MergeRequest, ProjectConfig } from './types';

export interface AutoReviewConfig {
  enabled: boolean;
  mode: 'polling' | 'webhook';
  postComment: boolean;
  notifyDesktop: boolean;
  skipDraft: boolean;
  approveOnSuccess: boolean;
  mergeOnSuccess: boolean;
}

export interface AutoReviewResult {
  status: 'completed' | 'skipped';
  provider?: 'codex' | 'gemini' | 'code';
  summary: string;
  recommendedApproval?: boolean;
  suggestionsCount: number;
  risksCount: number;
  commentPosted: boolean;
}

export function getAutoReviewConfig(): AutoReviewConfig {
  const mode = process.env.AUTO_REVIEW_MODE?.trim().toLowerCase();

  return {
    enabled: envFlag('AUTO_REVIEW_ENABLED', false),
    mode: mode === 'webhook' ? 'webhook' : 'polling',
    postComment: envFlag('AUTO_REVIEW_POST_COMMENT', true),
    notifyDesktop: envFlag('AUTO_REVIEW_NOTIFY_DESKTOP', true),
    skipDraft: envFlag('AUTO_REVIEW_SKIP_DRAFT', true),
    approveOnSuccess: envFlag('AUTO_REVIEW_APPROVE_ON_SUCCESS', false),
    mergeOnSuccess: envFlag('AUTO_REVIEW_MERGE_ON_SUCCESS', false),
  };
}

export function shouldSkipMergeRequest(mr: MergeRequest, config = getAutoReviewConfig()): string | null {
  if (config.skipDraft && mr.draft) return 'draft MR';
  return null;
}

export function notify(title: string, message: string, enabled = getAutoReviewConfig().notifyDesktop): void {
  if (!enabled) return;

  const safeTitle = title.replace(/'/g, '`').replace(/"/g, '`').slice(0, 60);
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
        `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('CLI Reviewer').Show($n)"`,
        { stdio: 'ignore' },
      );
    } else if (process.platform === 'darwin') {
      execSync(`osascript -e 'display notification "${safeMessage}" with title "${safeTitle}"'`, { stdio: 'ignore' });
    } else {
      execSync(`notify-send "${safeTitle}" "${safeMessage}"`, { stdio: 'ignore' });
    }
  } catch {
    // Notification failure must never interrupt analysis.
  }
}

export async function analyzeAndApply(
  project: ProjectConfig,
  mr: MergeRequest,
  config = getAutoReviewConfig(),
): Promise<AutoReviewResult> {
  const skipReason = shouldSkipMergeRequest(mr, config);
  const label = requestLabel(project);
  if (skipReason) {
    console.log(`   - ${label} !${mr.iid} ignorado (${skipReason})`);
    recordReview(project, mr, {
      provider: 'codex',
      estimatedTokens: 0,
      status: 'skipped',
      suggestionsCount: 0,
      risksCount: 0,
      commentPosted: false,
      approved: false,
      merged: false,
      error: skipReason,
    });
    return {
      status: 'skipped',
      summary: skipReason,
      suggestionsCount: 0,
      risksCount: 0,
      commentPosted: false,
    };
  }

  const { type: projectType } = project;

  console.log(`   -> Buscando diff do ${label} !${mr.iid}...`);
  let detail;
  try {
    detail = await getRequestChanges(project, mr.iid);
    console.log(`   ✓ Diff obtido com sucesso`);
  } catch (err) {
    console.error(`   ❌ Erro ao buscar diff: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }

  const changes = detail.changes ?? [];
  console.log(`   → ${changes.length} arquivo(s) alterado(s)`);

  if (changes.length === 0) {
    console.log(`   - ${label} !${mr.iid} sem alteracoes de codigo; pulando`);
    recordReview(project, mr, {
      provider: 'codex',
      estimatedTokens: 0,
      status: 'skipped',
      suggestionsCount: 0,
      risksCount: 0,
      commentPosted: false,
      approved: false,
      merged: false,
      error: 'sem alteracoes de codigo',
    });
    return {
      status: 'skipped',
      summary: 'sem alteracoes de codigo',
      suggestionsCount: 0,
      risksCount: 0,
      commentPosted: false,
    };
  }

  const diffText = changes.map(c => c.diff).join('\n');
  const promptTokens = estimateTokens(diffText) + 2_000;
  const provider = selectProvider(promptTokens);

  console.log(`   -> ~${promptTokens.toLocaleString()} tokens estimados; enviando para ${provider.toUpperCase()}...`);

  try {
    console.log(`   -> Executando análise com ${provider} (tipo projeto: ${projectType})...`);
    const analysis = await analyzeMergeRequest(provider, projectType, mr, changes);
    console.log(`   ✓ Análise concluída: ${analysis.aprovacao_recomendada ? 'APROVADO' : 'REQUER REVISÃO'}`);
    console.log(`      Riscos: ${analysis.riscos.length} | Sugestões: ${analysis.sugestoes.length}`);
    recordUsage(provider, promptTokens);

    let commentPosted = false;
    let approved = false;
    let merged = false;

    if (config.postComment) {
      console.log(`   -> Postando comentario no ${project.platform}...`);
      try {
        await postRequestComment(project, mr.iid, analysis.comentario_geral);
        console.log(`   ✓ Comentário postado com sucesso`);
        commentPosted = true;
      } catch (err) {
        console.error(`   ❌ Erro ao postar comentário: ${err instanceof Error ? err.message : String(err)}`);
        throw err;
      }
    } else {
      console.log('   - Comentario automatico desabilitado por AUTO_REVIEW_POST_COMMENT=false');
    }

    if (analysis.aprovacao_recomendada && config.approveOnSuccess) {
      console.log(`   -> Aprovando ${label} no ${project.platform}...`);
      try {
        await approveRequest(project, mr.iid);
        console.log(`   ✓ MR aprovado com sucesso`);
        approved = true;
      } catch (err) {
        console.error(`   ❌ Erro ao aprovar: ${err instanceof Error ? err.message : String(err)}`);
        // Não falhar a análise completa se só a aprovação falhar
      }
    }

    if (analysis.aprovacao_recomendada && config.mergeOnSuccess) {
      console.log(`   -> Disparando merge no ${project.platform}...`);
      try {
        await mergeRequest(project, mr.iid);
        console.log(`   ✓ Merge executado com sucesso`);
        merged = true;
      } catch (err) {
        console.error(`   ❌ Erro ao fazer merge: ${err instanceof Error ? err.message : String(err)}`);
        // Não falhar a análise completa se só o merge falhar
      }
    }

    recordReview(project, mr, {
      provider,
      estimatedTokens: promptTokens,
      status: analysis.aprovacao_recomendada ? 'approved' : 'needs-review',
      suggestionsCount: analysis.sugestoes.length,
      risksCount: analysis.riscos.length,
      commentPosted,
      approved,
      merged,
    });

    const verdict = analysis.aprovacao_recomendada ? 'Aprovado' : 'Revisao necessaria';
    console.log(`   OK ${verdict} | ${analysis.sugestoes.length} sugestao(oes) | ${label} !${mr.iid}`);

    notify(
      `${label} !${mr.iid} - ${verdict}`,
      `"${mr.title}" by ${mr.author.name} (via ${provider})`,
      config.notifyDesktop,
    );

    return {
      status: 'completed',
      provider,
      summary: verdict,
      recommendedApproval: analysis.aprovacao_recomendada,
      suggestionsCount: analysis.sugestoes.length,
      risksCount: analysis.riscos.length,
      commentPosted,
    };
  } catch (err) {
    console.error(`   ❌ ERRO DURANTE ANÁLISE: ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof Error && err.stack) {
      console.error(`      Stack: ${err.stack.split('\n').slice(0, 3).join('\n')}`);
    }

    recordReview(project, mr, {
      provider,
      estimatedTokens: promptTokens,
      status: 'failed',
      suggestionsCount: 0,
      risksCount: 0,
      commentPosted: false,
      approved: false,
      merged: false,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

function recordReview(
  project: ProjectConfig,
  mr: MergeRequest,
  data: Omit<Parameters<typeof recordReviewEvent>[0], 'platform' | 'projectId' | 'projectLabel' | 'projectType' | 'requestIid' | 'requestTitle' | 'requestAuthor' | 'requestUrl'>,
): void {
  recordReviewEvent({
    ...data,
    platform: project.platform,
    projectId: project.id,
    projectLabel: project.label,
    projectType: project.type,
    requestIid: mr.iid,
    requestTitle: mr.title,
    requestAuthor: mr.author.username,
    requestUrl: mr.web_url,
  });
}

export function printUsage(): void {
  const u = getUsageSummary();
  console.log(`\nUso estimado este mes (${u.month}):`);

  for (const key of AI_PROVIDERS) {
    const p = u[key];
    const limitText = p.limit > 0
      ? ` / ${p.limit.toLocaleString()} tokens (${Math.round((p.estimatedTokens / p.limit) * 100)}% usado)`
      : ' (sem limite configurado)';
    const status = p.enabled ? 'habilitado' : 'desabilitado';
    console.log(`   ${key.padEnd(8)}: ${p.estimatedTokens.toLocaleString()} tokens est.${limitText} | ${p.requests} analise(s) | ${status}`);
  }
}
