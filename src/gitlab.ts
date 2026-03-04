import type { MergeRequest, MergeRequestDetail } from './types';

function getConfig(projectId: string) {
  const url   = process.env.GITLAB_URL;
  const token = process.env.GITLAB_TOKEN;

  if (!url || !token) {
    throw new Error('Variáveis GITLAB_URL e GITLAB_TOKEN são obrigatórias');
  }

  // Suporta ID numérico (133) e path de grupo (grupo/projeto)
  const encodedId = /^\d+$/.test(projectId) ? projectId : encodeURIComponent(projectId);

  return {
    base: `${url}/api/v4/projects/${encodedId}`,
    headers: {
      'PRIVATE-TOKEN': token,
      'Content-Type': 'application/json',
    } as Record<string, string>,
  };
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitLab API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export async function listOpenMergeRequests(projectId: string): Promise<MergeRequest[]> {
  const { base, headers } = getConfig(projectId);
  return request<MergeRequest[]>(
    `${base}/merge_requests?state=opened&order_by=updated_at&sort=desc&per_page=25`,
    { headers },
  );
}

export async function getMergeRequestChanges(projectId: string, iid: number): Promise<MergeRequestDetail> {
  const { base, headers } = getConfig(projectId);
  return request<MergeRequestDetail>(`${base}/merge_requests/${iid}/changes`, { headers });
}

export async function approveMergeRequest(projectId: string, iid: number): Promise<void> {
  const { base, headers } = getConfig(projectId);
  await request(`${base}/merge_requests/${iid}/approve`, { method: 'POST', headers });
}

export async function postComment(projectId: string, iid: number, body: string): Promise<void> {
  const { base, headers } = getConfig(projectId);
  await request(`${base}/merge_requests/${iid}/notes`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ body }),
  });
}

export async function mergeMergeRequest(projectId: string, iid: number): Promise<void> {
  const { base, headers } = getConfig(projectId);
  await request(`${base}/merge_requests/${iid}/merge`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ merge_when_pipeline_succeeds: true }),
  });
}
