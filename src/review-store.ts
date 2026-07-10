import { existsSync, readFileSync, writeFileSync } from 'fs';

export const REVIEW_STORE_PATH = '.review-dashboard.json';

export interface ReviewEvent {
  id: string;
  timestamp: string;
  platform: 'gitlab' | 'github';
  projectId: string;
  projectLabel: string;
  projectType: 'front' | 'api' | 'generic';
  requestIid: number;
  requestTitle: string;
  requestAuthor: string;
  requestUrl: string;
  provider: 'codex' | 'gemini' | 'code';
  estimatedTokens: number;
  status: 'approved' | 'needs-review' | 'failed' | 'skipped';
  suggestionsCount: number;
  risksCount: number;
  commentPosted: boolean;
  approved: boolean;
  merged: boolean;
  error?: string;
}

export interface ReviewStore {
  events: ReviewEvent[];
}

export function loadReviewStore(path = REVIEW_STORE_PATH): ReviewStore {
  if (!existsSync(path)) return { events: [] };

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<ReviewStore>;
    return { events: Array.isArray(parsed.events) ? parsed.events : [] };
  } catch {
    return { events: [] };
  }
}

export function saveReviewStore(store: ReviewStore, path = REVIEW_STORE_PATH): void {
  writeFileSync(path, JSON.stringify(store, null, 2), 'utf8');
}

export function recordReviewEvent(event: Omit<ReviewEvent, 'id' | 'timestamp'>, path = REVIEW_STORE_PATH): ReviewEvent {
  const store = loadReviewStore(path);
  const saved: ReviewEvent = {
    ...event,
    id: `${Date.now()}-${event.platform}-${event.projectId}-${event.requestIid}`,
    timestamp: new Date().toISOString(),
  };

  store.events.push(saved);
  saveReviewStore(store, path);
  return saved;
}
