import {
  approveMergeRequest,
  getMergeRequest,
  getMergeRequestChanges,
  listOpenMergeRequests,
  mergeMergeRequest,
  postComment,
} from './gitlab';
import {
  approvePullRequest,
  getPullRequest,
  getPullRequestChanges,
  listOpenPullRequests,
  mergePullRequest,
  postPullRequestComment,
} from './github';
import type { MergeRequest, MergeRequestDetail, ProjectConfig } from './types';

export function requestLabel(project: ProjectConfig): string {
  return project.platform === 'github' ? 'PR' : 'MR';
}

export async function listOpenRequests(project: ProjectConfig): Promise<MergeRequest[]> {
  return project.platform === 'github'
    ? listOpenPullRequests(project.id)
    : listOpenMergeRequests(project.id);
}

export async function getRequest(project: ProjectConfig, iid: number): Promise<MergeRequest> {
  return project.platform === 'github'
    ? getPullRequest(project.id, iid)
    : getMergeRequest(project.id, iid);
}

export async function getRequestChanges(project: ProjectConfig, iid: number): Promise<MergeRequestDetail> {
  return project.platform === 'github'
    ? getPullRequestChanges(project.id, iid)
    : getMergeRequestChanges(project.id, iid);
}

export async function approveRequest(project: ProjectConfig, iid: number): Promise<void> {
  return project.platform === 'github'
    ? approvePullRequest(project.id, iid)
    : approveMergeRequest(project.id, iid);
}

export async function postRequestComment(project: ProjectConfig, iid: number, body: string): Promise<void> {
  return project.platform === 'github'
    ? postPullRequestComment(project.id, iid, body)
    : postComment(project.id, iid, body);
}

export async function mergeRequest(project: ProjectConfig, iid: number): Promise<void> {
  return project.platform === 'github'
    ? mergePullRequest(project.id, iid)
    : mergeMergeRequest(project.id, iid);
}
