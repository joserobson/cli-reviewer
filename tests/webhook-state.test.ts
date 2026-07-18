import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { WebhookEventStore } from '../src/webhook-state';

const tempDirs: string[] = [];

function createStore(timeoutMs = 60_000): WebhookEventStore {
  const directory = mkdtempSync(join(tmpdir(), 'cli-reviewer-webhook-'));
  tempDirs.push(directory);
  return new WebhookEventStore(join(directory, 'state.json'), timeoutMs);
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('WebhookEventStore', () => {
  it('impede processamento simultaneo e duplicado concluido', () => {
    const store = createStore();
    const now = new Date('2026-07-16T12:00:00Z');

    assert.equal(store.begin('project:1:sha', now), 'started');
    assert.equal(store.begin('project:1:sha', now), 'processing');

    store.complete('project:1:sha', now);
    assert.equal(store.begin('project:1:sha', now), 'completed');
  });

  it('libera retry depois de falha', () => {
    const store = createStore();

    assert.equal(store.begin('project:2:sha'), 'started');
    store.fail('project:2:sha');
    assert.equal(store.begin('project:2:sha'), 'started');
  });

  it('libera processamento travado depois do timeout', () => {
    const store = createStore(1_000);

    assert.equal(store.begin('project:3:sha', new Date('2026-07-16T12:00:00Z')), 'started');
    assert.equal(store.begin('project:3:sha', new Date('2026-07-16T12:00:02Z')), 'started');
  });
});
