import { existsSync, readFileSync, writeFileSync } from 'fs';

export type WebhookEventStatus = 'processing' | 'completed';

export interface WebhookEventState {
  key: string;
  status: WebhookEventStatus;
  updatedAt: string;
}

interface StoredWebhookState {
  events?: WebhookEventState[];
  processedEvents?: string[];
}

export type BeginEventResult = 'started' | 'processing' | 'completed';

export class WebhookEventStore {
  constructor(
    private readonly path = '.webhook-state.json',
    private readonly processingTimeoutMs = 30 * 60 * 1000,
  ) {}

  begin(key: string, now = new Date()): BeginEventResult {
    const state = this.load();
    const existing = state.find(event => event.key === key);

    if (existing?.status === 'completed') return 'completed';

    if (existing?.status === 'processing') {
      const ageMs = now.getTime() - Date.parse(existing.updatedAt);
      if (Number.isFinite(ageMs) && ageMs < this.processingTimeoutMs) return 'processing';
    }

    const next = state.filter(event => event.key !== key);
    next.push({ key, status: 'processing', updatedAt: now.toISOString() });
    this.save(next.slice(-500));
    return 'started';
  }

  complete(key: string, now = new Date()): void {
    const state = this.load().filter(event => event.key !== key);
    state.push({ key, status: 'completed', updatedAt: now.toISOString() });
    this.save(state.slice(-500));
  }

  fail(key: string): void {
    this.save(this.load().filter(event => event.key !== key));
  }

  private load(): WebhookEventState[] {
    if (!existsSync(this.path)) return [];

    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as StoredWebhookState;
      if (Array.isArray(parsed.events)) return parsed.events;

      return Array.isArray(parsed.processedEvents)
        ? parsed.processedEvents.map(key => ({ key, status: 'completed', updatedAt: new Date(0).toISOString() }))
        : [];
    } catch {
      return [];
    }
  }

  private save(events: WebhookEventState[]): void {
    writeFileSync(this.path, JSON.stringify({ events }, null, 2), 'utf8');
  }
}
