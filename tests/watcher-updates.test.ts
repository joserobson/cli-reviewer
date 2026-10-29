import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { detectMrsToReview, recordSeen, type WatcherState } from '../src/watcher.js';
import type { MergeRequest } from '../src/types.js';

function makeMr(iid: number, sha?: string): MergeRequest {
  return {
    iid,
    id: iid * 100,
    title: `MR ${iid}`,
    description: null,
    author: { name: 'Dev', username: 'dev' },
    source_branch: `feature/${iid}`,
    target_branch: 'main',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    web_url: `https://gitlab.example.com/mr/${iid}`,
    changes_count: '3',
    state: 'opened',
    draft: false,
    sha,
  };
}

describe('detectMrsToReview — novos commits', () => {
  it('marca MR nunca visto como new', () => {
    const { toReview, backfill } = detectMrsToReview([makeMr(1, 'a1')], [], {});
    assert.deepEqual(toReview.map(r => [r.mr.iid, r.reason]), [[1, 'new']]);
    assert.equal(backfill.length, 0);
  });

  it('marca MR visto com SHA diferente como updated', () => {
    const { toReview } = detectMrsToReview([makeMr(1, 'b2')], [1], { '1': 'a1' });
    assert.deepEqual(toReview.map(r => [r.mr.iid, r.reason]), [[1, 'updated']]);
  });

  it('ignora MR visto com o mesmo SHA (edição de título/descrição)', () => {
    const { toReview, backfill } = detectMrsToReview([makeMr(1, 'a1')], [1], { '1': 'a1' });
    assert.equal(toReview.length, 0);
    assert.equal(backfill.length, 0);
  });

  it('estado antigo sem SHA: faz backfill sem reanalisar', () => {
    const { toReview, backfill } = detectMrsToReview([makeMr(1, 'a1')], [1], {});
    assert.equal(toReview.length, 0);
    assert.deepEqual(backfill.map(mr => mr.iid), [1]);
  });

  it('MR visto sem SHA na API não é reanalisado', () => {
    const { toReview, backfill } = detectMrsToReview([makeMr(1)], [1], { '1': 'a1' });
    assert.equal(toReview.length, 0);
    assert.equal(backfill.length, 0);
  });

  it('combina novos, atualizados e inalterados preservando a ordem', () => {
    const mrs = [makeMr(1, 'a1'), makeMr(2, 'b2'), makeMr(3, 'c3')];
    const { toReview } = detectMrsToReview(mrs, [1, 2], { '1': 'a1', '2': 'old' });
    assert.deepEqual(toReview.map(r => [r.mr.iid, r.reason]), [[2, 'updated'], [3, 'new']]);
  });
});

describe('recordSeen', () => {
  it('registra IID e SHA sem duplicar IIDs', () => {
    const state: WatcherState = { seenMrIds: {} };
    recordSeen(state, 'gitlab:133', makeMr(1, 'a1'));
    recordSeen(state, 'gitlab:133', makeMr(1, 'b2'));

    assert.deepEqual(state.seenMrIds['gitlab:133'], [1]);
    assert.equal(state.seenShas?.['gitlab:133']['1'], 'b2');
  });

  it('funciona com estado antigo (sem seenShas) e sem SHA', () => {
    const state: WatcherState = { seenMrIds: { 'gitlab:133': [1] } };
    recordSeen(state, 'gitlab:133', makeMr(2));

    assert.deepEqual(state.seenMrIds['gitlab:133'], [1, 2]);
    assert.equal(state.seenShas, undefined);
  });

  it('ciclo completo: novo → sem mudança → novo commit', () => {
    const state: WatcherState = { seenMrIds: {} };
    const key = 'gitlab:133';
    const run = (mr: MergeRequest) => {
      const { toReview } = detectMrsToReview([mr], state.seenMrIds[key] ?? [], state.seenShas?.[key] ?? {});
      toReview.forEach(r => recordSeen(state, key, r.mr));
      return toReview.map(r => r.reason);
    };

    assert.deepEqual(run(makeMr(7, 'a1')), ['new']);
    assert.deepEqual(run(makeMr(7, 'a1')), []);
    assert.deepEqual(run(makeMr(7, 'b2')), ['updated']);
    assert.deepEqual(run(makeMr(7, 'b2')), []);
  });
});
