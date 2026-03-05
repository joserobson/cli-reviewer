import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';

import { estimateTokens, recordUsage, getUsageSummary, selectProvider } from '../src/usage-tracker';

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function writeStore(data: object): void {
  writeFileSync('.llm-usage.json', JSON.stringify(data, null, 2), 'utf8');
}

function cleanStore(): void {
  if (existsSync('.llm-usage.json')) unlinkSync('.llm-usage.json');
}

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const original: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    original[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try { fn(); } finally {
    for (const [k, v] of Object.entries(original)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// ─── estimateTokens ───────────────────────────────────────────────────────────

describe('estimateTokens', () => {
  it('retorna 0 para string vazia', () => {
    assert.equal(estimateTokens(''), 0);
  });

  it('estima ~1 token para 4 caracteres', () => {
    assert.equal(estimateTokens('abcd'), 1);
  });

  it('arredonda para cima (ceil)', () => {
    assert.equal(estimateTokens('abc'), 1);  // 3/4 = 0.75 → ceil = 1
    assert.equal(estimateTokens('abcde'), 2); // 5/4 = 1.25 → ceil = 2
  });

  it('estima corretamente para diff maior', () => {
    const text = 'x'.repeat(400);
    assert.equal(estimateTokens(text), 100);
  });
});

// ─── getUsageSummary ──────────────────────────────────────────────────────────

describe('getUsageSummary', () => {
  afterEach(cleanStore);

  it('retorna zeros quando não há store', () => {
    cleanStore();
    const summary = getUsageSummary();
    assert.equal(summary.claude.requests, 0);
    assert.equal(summary.claude.estimatedTokens, 0);
    assert.equal(summary.gemini.requests, 0);
    assert.equal(summary.month, currentMonth());
  });

  it('retorna zeros quando o store é de outro mês (reset automático)', () => {
    writeStore({
      month: '2020-01',
      claude: { requests: 50, estimatedTokens: 999999 },
      gemini: { requests: 30, estimatedTokens: 500000 },
    });
    const summary = getUsageSummary();
    assert.equal(summary.claude.requests, 0);
    assert.equal(summary.gemini.requests, 0);
  });

  it('retorna dados do mês atual corretamente', () => {
    writeStore({
      month: currentMonth(),
      claude: { requests: 5, estimatedTokens: 10000 },
      gemini: { requests: 3, estimatedTokens: 6000 },
    });
    const summary = getUsageSummary();
    assert.equal(summary.claude.requests, 5);
    assert.equal(summary.claude.estimatedTokens, 10000);
    assert.equal(summary.gemini.requests, 3);
  });

  it('lê o limite configurado no env', () => {
    cleanStore();
    withEnv({ WATCH_CLAUDE_MONTHLY_TOKENS: '7000000', WATCH_GEMINI_MONTHLY_TOKENS: '1500000' }, () => {
      const summary = getUsageSummary();
      assert.equal(summary.claude.limit, 7000000);
      assert.equal(summary.gemini.limit, 1500000);
    });
  });
});

// ─── selectProvider ───────────────────────────────────────────────────────────

describe('selectProvider', () => {
  afterEach(cleanStore);

  it('sem limites e sem histórico → prefere claude (menos requisições)', () => {
    cleanStore();
    withEnv({ WATCH_CLAUDE_MONTHLY_TOKENS: '0', WATCH_GEMINI_MONTHLY_TOKENS: '0' }, () => {
      const provider = selectProvider(1000);
      assert.equal(provider, 'claude');
    });
  });

  it('sem limites → balanceia por contagem (round-robin)', () => {
    writeStore({
      month: currentMonth(),
      claude: { requests: 5, estimatedTokens: 0 },
      gemini: { requests: 3, estimatedTokens: 0 },
    });
    withEnv({ WATCH_CLAUDE_MONTHLY_TOKENS: '0', WATCH_GEMINI_MONTHLY_TOKENS: '0' }, () => {
      // gemini tem menos requisições → deve ser escolhido
      const provider = selectProvider(1000);
      assert.equal(provider, 'gemini');
    });
  });

  it('ambos com limites → escolhe quem tem maior % restante', () => {
    writeStore({
      month: currentMonth(),
      claude: { requests: 10, estimatedTokens: 6_000_000 }, // 60% usado de 10M
      gemini: { requests: 5,  estimatedTokens: 300_000 },   // 20% usado de 1.5M
    });
    withEnv({ WATCH_CLAUDE_MONTHLY_TOKENS: '10000000', WATCH_GEMINI_MONTHLY_TOKENS: '1500000' }, () => {
      // Gemini tem 80% restante vs Claude com 40% → gemini
      const provider = selectProvider(1000);
      assert.equal(provider, 'gemini');
    });
  });

  it('claude esgotado → usa gemini automaticamente', () => {
    writeStore({
      month: currentMonth(),
      claude: { requests: 100, estimatedTokens: 9_999_000 }, // quase no limite de 10M
      gemini: { requests: 10,  estimatedTokens: 100_000 },
    });
    withEnv({ WATCH_CLAUDE_MONTHLY_TOKENS: '10000000', WATCH_GEMINI_MONTHLY_TOKENS: '5000000' }, () => {
      // Prompt de 5000 tokens: claude só tem 1000 restantes → esgotado
      const provider = selectProvider(5_000);
      assert.equal(provider, 'gemini');
    });
  });

  it('gemini esgotado → usa claude automaticamente', () => {
    writeStore({
      month: currentMonth(),
      claude: { requests: 5,   estimatedTokens: 100_000 },
      gemini: { requests: 100, estimatedTokens: 1_499_000 }, // quase no limite de 1.5M
    });
    withEnv({ WATCH_CLAUDE_MONTHLY_TOKENS: '10000000', WATCH_GEMINI_MONTHLY_TOKENS: '1500000' }, () => {
      // Prompt de 5000 tokens: gemini só tem 1000 restantes → esgotado
      const provider = selectProvider(5_000);
      assert.equal(provider, 'claude');
    });
  });

  it('só limite do claude configurado — protege quando quase esgotado', () => {
    writeStore({
      month: currentMonth(),
      claude: { requests: 50, estimatedTokens: 999_999 }, // quase no limite de 1M
      gemini: { requests: 10, estimatedTokens: 0 },
    });
    withEnv({ WATCH_CLAUDE_MONTHLY_TOKENS: '1000000', WATCH_GEMINI_MONTHLY_TOKENS: '0' }, () => {
      // Prompt de 5000 tokens: claude só tem 1 token restante → usa gemini
      const provider = selectProvider(5_000);
      assert.equal(provider, 'gemini');
    });
  });
});
