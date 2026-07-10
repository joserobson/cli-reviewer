import type { FileChange, MergeRequest, MergeRequestDetail } from './types';

interface GitHubUser {
  login: string;
  name?: string | null;
}

interface GitHubPullRequest {
  id: number;
  number: number;
  title: string;
  body: string | null;
  user: GitHubUser | null;
  head: { ref: string; sha: string };
  base: { ref: string; sha: string };
  created_at: string;
  updated_at: string;
  html_url: string;
  state: string;
  draft?: boolean;
}

interface GitHubPullRequestFile {
  filename: string;
  previous_filename?: string;
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'changed' | string;
  patch?: string;
}

function getConfig(repoId: string) {
  const apiUrl = (process.env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/$/, '');
  const token = process.env.GITHUB_TOKEN?.trim();

  if (!/^[^/]+\/[^/]+$/.test(repoId)) {
    throw new Error(`Repositorio GitHub invalido: "${repoId}". Use owner/repo.`);
  }

  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'mr-reviewer',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  if (token) headers.Authorization = `Bearer ${token}`;

  return {
    base: `${apiUrl}/repos/${repoId}`,
    headers,
  };
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitHub API ${res.status}: ${text.slice(0, 200)}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

function mapPullRequest(pr: GitHubPullRequest): MergeRequest {
  const login = pr.user?.login ?? 'github-user';
  return {
    iid: pr.number,
    id: pr.id,
    title: pr.title,
    description: pr.body,
    author: { name: pr.user?.name ?? login, username: login },
    source_branch: pr.head.ref,
    target_branch: pr.base.ref,
    created_at: pr.created_at,
    updated_at: pr.updated_at,
    web_url: pr.html_url,
    changes_count: '0',
    state: pr.state,
    draft: pr.draft ?? false,
  };
}

function mapFile(file: GitHubPullRequestFile): FileChange {
  return {
    old_path: file.previous_filename ?? file.filename,
    new_path: file.filename,
    diff: file.patch ?? '',
    new_file: file.status === 'added',
    deleted_file: file.status === 'removed',
    renamed_file: file.status === 'renamed',
  };
}

export async function listOpenPullRequests(repoId: string): Promise<MergeRequest[]> {
  const { base, headers } = getConfig(repoId);
  const prs = await request<GitHubPullRequest[]>(
    `${base}/pulls?state=open&sort=updated&direction=desc&per_page=25`,
    { headers },
  );
  return prs.map(mapPullRequest);
}

export async function getPullRequest(repoId: string, number: number): Promise<MergeRequest> {
  const { base, headers } = getConfig(repoId);
  const pr = await request<GitHubPullRequest>(`${base}/pulls/${number}`, { headers });
  return mapPullRequest(pr);
}

export async function getPullRequestChanges(repoId: string, number: number): Promise<MergeRequestDetail> {
  const { base, headers } = getConfig(repoId);
  const [pr, files] = await Promise.all([
    request<GitHubPullRequest>(`${base}/pulls/${number}`, { headers }),
    request<GitHubPullRequestFile[]>(`${base}/pulls/${number}/files?per_page=100`, { headers }),
  ]);

  return {
    ...mapPullRequest(pr),
    changes_count: String(files.length),
    changes: files.map(mapFile).filter(file => file.diff.trim().length > 0),
    diff_refs: {
      base_sha: pr.base.sha,
      head_sha: pr.head.sha,
      start_sha: pr.base.sha,
    },
  };
}

export async function approvePullRequest(repoId: string, number: number): Promise<void> {
  const { base, headers } = getConfig(repoId);
  await request(`${base}/pulls/${number}/reviews`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ event: 'APPROVE', body: 'Approved by automated review.' }),
  });
}

export async function postPullRequestComment(repoId: string, number: number, body: string): Promise<void> {
  const { base, headers } = getConfig(repoId);
  await request(`${base}/issues/${number}/comments`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ body }),
  });
}

export async function mergePullRequest(repoId: string, number: number): Promise<void> {
  const { base, headers } = getConfig(repoId);
  await request(`${base}/pulls/${number}/merge`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ merge_method: 'merge' }),
  });
}
