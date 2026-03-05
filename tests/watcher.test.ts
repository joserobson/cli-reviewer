import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadState, saveState, filterNewMrs } from '../src/watcher.js';
import type { MergeRequest } from '../src/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TMP = join(tmpdir(), 'mr-reviewer-test');

function tmpFile(name: string): string {
  mkdirSync(TMP, { recursive: true });
  return join(TMP, name);
}

function makeMr(iid: number, title = `MR ${iid}`): MergeRequest {
  return {
    iid,
    id: iid * 100,
    title,
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
  };
}

// ─── loadState ────────────────────────────────────────────────────────────────

describe('loadState', () => {
  it('retorna estado vazio quando arquivo não existe', () => {
    const path = tmpFile('nonexistent.json');
    if (existsSync(path)) unlinkSync(path);

    const state = loadState(path);
    assert.deepEqual(state, { seenMrIds: {} });
  });

  it('carrega estado existente corretamente', () => {
    const path = tmpFile('valid-state.json');
    writeFileSync(path, JSON.stringify({ seenMrIds: { '133': [1, 2, 3] } }), 'utf8');

    const state = loadState(path);
    assert.deepEqual(state.seenMrIds['133'], [1, 2, 3]);
  });

  it('retorna estado vazio quando arquivo está corrompido', () => {
    const path = tmpFile('corrupt.json');
    writeFileSync(path, 'isso não é JSON válido!!!', 'utf8');

    const state = loadState(path);
    assert.deepEqual(state, { seenMrIds: {} });
  });

  it('retorna estado vazio quando arquivo está vazio', () => {
    const path = tmpFile('empty.json');
    writeFileSync(path, '', 'utf8');

    const state = loadState(path);
    assert.deepEqual(state, { seenMrIds: {} });
  });

  it('mantém múltiplos projetos no estado', () => {
    const path = tmpFile('multi-project.json');
    writeFileSync(path, JSON.stringify({
      seenMrIds: {
        '133': [10, 11],
        '134': [20, 21, 22],
      }
    }), 'utf8');

    const state = loadState(path);
    assert.equal(state.seenMrIds['133'].length, 2);
    assert.equal(state.seenMrIds['134'].length, 3);
  });
});

// ─── saveState ────────────────────────────────────────────────────────────────

describe('saveState', () => {
  it('persiste o estado corretamente', () => {
    const path = tmpFile('save-test.json');
    const state = { seenMrIds: { '133': [1, 2, 3] } };

    saveState(state, path);
    const loaded = loadState(path);
    assert.deepEqual(loaded.seenMrIds['133'], [1, 2, 3]);
  });

  it('sobrescreve estado anterior', () => {
    const path = tmpFile('overwrite-test.json');
    saveState({ seenMrIds: { '133': [1] } }, path);
    saveState({ seenMrIds: { '133': [1, 2] } }, path);

    const loaded = loadState(path);
    assert.deepEqual(loaded.seenMrIds['133'], [1, 2]);
  });

  it('round-trip: salvar e carregar produz o mesmo estado', () => {
    const path = tmpFile('roundtrip.json');
    const original = { seenMrIds: { '133': [7, 8, 9], '134': [100] } };

    saveState(original, path);
    const loaded = loadState(path);
    assert.deepEqual(loaded, original);
  });
});

// ─── filterNewMrs ─────────────────────────────────────────────────────────────

describe('filterNewMrs — detecção de MRs novos', () => {
  it('retorna todos os MRs quando seenIds está vazio', () => {
    const mrs = [makeMr(1), makeMr(2), makeMr(3)];
    const newMrs = filterNewMrs(mrs, []);
    assert.equal(newMrs.length, 3);
  });

  it('retorna apenas MRs não vistos', () => {
    const mrs = [makeMr(1), makeMr(2), makeMr(3)];
    const newMrs = filterNewMrs(mrs, [1, 3]);
    assert.equal(newMrs.length, 1);
    assert.equal(newMrs[0].iid, 2);
  });

  it('retorna lista vazia quando todos já foram vistos', () => {
    const mrs = [makeMr(1), makeMr(2)];
    const newMrs = filterNewMrs(mrs, [1, 2]);
    assert.equal(newMrs.length, 0);
  });

  it('retorna lista vazia quando não há MRs abertos', () => {
    const newMrs = filterNewMrs([], [1, 2, 3]);
    assert.equal(newMrs.length, 0);
  });

  it('preserva a ordem dos MRs retornados', () => {
    const mrs = [makeMr(10), makeMr(20), makeMr(30)];
    const newMrs = filterNewMrs(mrs, [20]);
    assert.equal(newMrs[0].iid, 10);
    assert.equal(newMrs[1].iid, 30);
  });

  it('não modifica a lista original de MRs', () => {
    const mrs = [makeMr(1), makeMr(2)];
    const original = [...mrs];
    filterNewMrs(mrs, [1]);
    assert.equal(mrs.length, original.length);
  });
});

// ─── Simulação de ciclo de polling ────────────────────────────────────────────

describe('simulação de estado ao longo de múltiplos ciclos', () => {
  it('acumula IDs vistos corretamente entre ciclos', () => {
    const path = tmpFile('cycle-sim.json');

    // Ciclo 1: detecta MRs 1 e 2
    const state1 = loadState(path);
    state1.seenMrIds['133'] = [1, 2];
    saveState(state1, path);

    // Ciclo 2: aparece MR 3
    const state2 = loadState(path);
    const openMrs = [makeMr(1), makeMr(2), makeMr(3)];
    const newMrs = filterNewMrs(openMrs, state2.seenMrIds['133'] ?? []);

    assert.equal(newMrs.length, 1);
    assert.equal(newMrs[0].iid, 3);

    state2.seenMrIds['133'] = [...(state2.seenMrIds['133'] ?? []), 3];
    saveState(state2, path);

    // Ciclo 3: nenhum MR novo
    const state3 = loadState(path);
    const nothingNew = filterNewMrs(openMrs, state3.seenMrIds['133'] ?? []);
    assert.equal(nothingNew.length, 0);
  });

  it('MRs de projetos diferentes não interferem entre si', () => {
    const path = tmpFile('multi-project-cycle.json');

    const state = loadState(path);
    state.seenMrIds['133'] = [1, 2];
    state.seenMrIds['134'] = [10];
    saveState(state, path);

    const loaded = loadState(path);

    const newFront = filterNewMrs([makeMr(1), makeMr(2), makeMr(3)], loaded.seenMrIds['133'] ?? []);
    const newApi   = filterNewMrs([makeMr(10), makeMr(11)],           loaded.seenMrIds['134'] ?? []);

    assert.equal(newFront.length, 1); // só o 3
    assert.equal(newApi.length, 1);   // só o 11
    assert.equal(newFront[0].iid, 3);
    assert.equal(newApi[0].iid, 11);
  });

  it('projeto novo (sem histórico) trata todos os MRs como vistos no seed', () => {
    const path = tmpFile('seed-sim.json');

    // Simula seedInitialState: marca todos os abertos como vistos
    const openMrs = [makeMr(5), makeMr(6), makeMr(7)];
    const state = loadState(path);
    state.seenMrIds['133'] = openMrs.map(mr => mr.iid);
    saveState(state, path);

    // No próximo ciclo, nenhum deve ser tratado como novo
    const loaded = loadState(path);
    const newMrs = filterNewMrs(openMrs, loaded.seenMrIds['133'] ?? []);
    assert.equal(newMrs.length, 0);
  });
});
