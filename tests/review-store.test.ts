import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadReviewStore, recordReviewEvent } from '../src/review-store';

const TMP = join(tmpdir(), 'mr-reviewer-review-store-test');

function tmpFile(name: string): string {
  mkdirSync(TMP, { recursive: true });
  return join(TMP, name);
}

function clean(path: string): void {
  if (existsSync(path)) unlinkSync(path);
}

describe('review-store', () => {
  it('retorna lista vazia quando arquivo nao existe', () => {
    const path = tmpFile('missing.json');
    clean(path);

    assert.deepEqual(loadReviewStore(path), { events: [] });
  });

  it('retorna lista vazia quando arquivo esta corrompido', () => {
    const path = tmpFile('corrupt.json');
    writeFileSync(path, 'not-json', 'utf8');

    assert.deepEqual(loadReviewStore(path), { events: [] });
  });

  it('registra evento de revisao', () => {
    const path = tmpFile('events.json');
    clean(path);

    const saved = recordReviewEvent({
      platform: 'github',
      projectId: 'owner/repo',
      projectLabel: 'CLI Reviewer',
      projectType: 'generic',
      requestIid: 10,
      requestTitle: 'Add dashboard',
      requestAuthor: 'dev',
      requestUrl: 'https://github.com/owner/repo/pull/10',
      provider: 'codex',
      estimatedTokens: 3000,
      status: 'approved',
      suggestionsCount: 1,
      risksCount: 0,
      commentPosted: true,
      approved: false,
      merged: false,
    }, path);

    const store = loadReviewStore(path);
    assert.equal(store.events.length, 1);
    assert.equal(store.events[0].id, saved.id);
    assert.equal(store.events[0].platform, 'github');
    assert.equal(store.events[0].estimatedTokens, 3000);
  });
});
