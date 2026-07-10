import { execSync } from 'child_process';

import { AI_PROVIDERS, analyzeMergeRequest } from './ai';
import { approveRequest, getRequestChanges, mergeRequest, postRequestComment, requestLabel } from './scm';
import { selectProvider, recordUsage, estimateTokens, getUsageSummary } from './usage-tracker';
import { envFlag } from './env-utils';
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

export async function analyzeAndApply(project: ProjectConfig, mr: MergeRequest, config = getAutoReviewConfig()): Promise<void> {
  const skipReason = shouldSkipMergeRequest(mr, config);
  const label = requestLabel(project);
  if (skipReason) {
    console.log(`   - ${label} !${mr.iid} ignorado (${skipReason})`);
    return;
  }

  const { type: projectType } = project;

  console.log(`   -> Buscando diff do ${label} !${mr.iid}...`);
  const detail = await getRequestChanges(project, mr.iid);
  const changes = detail.changes ?? [];

  if (changes.length === 0) {
    console.log(`   - ${label} !${mr.iid} sem alteracoes de codigo; pulando`);
    return;
  }

  const diffText = changes.map(c => c.diff).join('\n');
  const promptTokens = estimateTokens(diffText) + 2_000;
  const provider = selectProvider(promptTokens);

  console.log(`   -> ~${promptTokens.toLocaleString()} tokens estimados; enviando para ${provider.toUpperCase()}...`);

  const analysis = await analyzeMergeRequest(provider, projectType, mr, changes);
  recordUsage(provider, promptTokens);

  if (config.postComment) {
    console.log(`   -> Postando comentario no ${project.platform}...`);
    await postRequestComment(project, mr.iid, analysis.comentario_geral);
  } else {
    console.log('   - Comentario automatico desabilitado por AUTO_REVIEW_POST_COMMENT=false');
  }

  if (analysis.aprovacao_recomendada && config.approveOnSuccess) {
    console.log(`   -> Aprovando ${label} no ${project.platform}...`);
    await approveRequest(project, mr.iid);
  }

  if (analysis.aprovacao_recomendada && config.mergeOnSuccess) {
    console.log(`   -> Disparando merge no ${project.platform}...`);
    await mergeRequest(project, mr.iid);
  }

  const verdict = analysis.aprovacao_recomendada ? 'Aprovado' : 'Revisao necessaria';
  console.log(`   OK ${verdict} | ${analysis.sugestoes.length} sugestao(oes) | ${label} !${mr.iid}`);

  notify(
    `${label} !${mr.iid} - ${verdict}`,
    `"${mr.title}" by ${mr.author.name} (via ${provider})`,
    config.notifyDesktop,
  );
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
