export interface AgentHubReviewResult {
  status: 'running' | 'completed' | 'failed' | 'skipped';
  provider?: 'codex' | 'gemini' | 'code';
  summary?: string;
  recommendedApproval?: boolean;
  suggestionsCount?: number;
  risksCount?: number;
  commentPosted?: boolean;
  errorMessage?: string;
}

export async function sendAgentHubReviewResult(taskId: string, result: AgentHubReviewResult): Promise<void> {
  const baseUrl = process.env.AGENT_HUB_CALLBACK_URL?.replace(/\/$/, '');
  const secret = process.env.AGENT_HUB_CALLBACK_SECRET;

  if (!baseUrl || !secret) {
    throw new Error('AGENT_HUB_CALLBACK_URL e AGENT_HUB_CALLBACK_SECRET sao obrigatorios para callbacks');
  }

  const response = await fetch(`${baseUrl}/${encodeURIComponent(taskId)}/result`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Review-Callback-Token': secret,
    },
    body: JSON.stringify(result),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Agent Hub callback ${response.status}: ${body.slice(0, 200)}`);
  }
}
