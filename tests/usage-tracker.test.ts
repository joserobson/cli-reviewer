import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';

import { estimateTokens, getUsageSummary, selectProvider } from '../src/usage-tracker';

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

describe('estimateTokens', () => {
  it('retorna 0 para string vazia', () => {
    assert.equal(estimateTokens(''), 0);
  });

  it('estima ~1 token para 4 caracteres', () => {
    assert.equal(estimateTokens('abcd'), 1);
  });

  it('arredonda para cima', () => {
    assert.equal(estimateTokens('abc'), 1);
    assert.equal(estimateTokens('abcde'), 2);
  });

  it('estima corretamente para diff maior', () => {
    assert.equal(estimateTokens('x'.repeat(400)), 100);
  });
});

describe('getUsageSummary', () => {
  afterEach(cleanStore);

  it('retorna zeros quando nao ha store', () => {
    cleanStore();
    const summary = getUsageSummary();
    assert.equal(summary.codex.requests, 0);
    assert.equal(summary.gemini.estimatedTokens, 0);
    assert.equal(summary.code.requests, 0);
    assert.equal(summary.month, currentMonth());
  });

  it('retorna zeros quando o store e de outro mes', () => {
    writeStore({
      month: '2020-01',
      codex: { requests: 50, estimatedTokens: 999999 },
      gemini: { requests: 30, estimatedTokens: 500000 },
      code: { requests: 10, estimatedTokens: 100000 },
    });
    const summary = getUsageSummary();
    assert.equal(summary.codex.requests, 0);
    assert.equal(summary.gemini.requests, 0);
    assert.equal(summary.code.requests, 0);
  });

  it('migra uso antigo de claude para code', () => {
    writeStore({
      month: currentMonth(),
      claude: { requests: 5, estimatedTokens: 10000 },
      gemini: { requests: 3, estimatedTokens: 6000 },
    });
    const summary = getUsageSummary();
    assert.equal(summary.code.requests, 5);
    assert.equal(summary.code.estimatedTokens, 10000);
    assert.equal(summary.gemini.requests, 3);
  });

  it('le limites e flags configuradas no env', () => {
    cleanStore();
    withEnv({
      CODEX_ENABLED: 'true',
      GEMINI_ENABLED: 'false',
      CODE_ENABLED: 'true',
      WATCH_CODEX_MONTHLY_TOKENS: '7000000',
      WATCH_GEMINI_MONTHLY_TOKENS: '1500000',
      WATCH_CODE_MONTHLY_TOKENS: '900000',
    }, () => {
      const summary = getUsageSummary();
      assert.equal(summary.codex.limit, 7000000);
      assert.equal(summary.gemini.limit, 1500000);
      assert.equal(summary.code.limit, 900000);
      assert.equal(summary.codex.enabled, true);
      assert.equal(summary.gemini.enabled, false);
      assert.equal(summary.code.enabled, true);
    });
  });
});

describe('selectProvider', () => {
  afterEach(cleanStore);

  it('sem limites e sem historico prefere codex', () => {
    cleanStore();
    withEnv({
      CODEX_ENABLED: 'true',
      GEMINI_ENABLED: 'true',
      CODE_ENABLED: 'false',
      WATCH_CODEX_MONTHLY_TOKENS: '0',
      WATCH_GEMINI_MONTHLY_TOKENS: '0',
    }, () => {
      assert.equal(selectProvider(1000), 'codex');
    });
  });

  it('ignora providers desabilitados', () => {
    cleanStore();
    withEnv({
      CODEX_ENABLED: 'false',
      GEMINI_ENABLED: 'true',
      CODE_ENABLED: 'false',
    }, () => {
      assert.equal(selectProvider(1000), 'gemini');
    });
  });

  it('sem limites balanceia por contagem', () => {
    writeStore({
      month: currentMonth(),
      codex: { requests: 5, estimatedTokens: 0 },
      gemini: { requests: 3, estimatedTokens: 0 },
      code: { requests: 0, estimatedTokens: 0 },
    });
    withEnv({
      CODEX_ENABLED: 'true',
      GEMINI_ENABLED: 'true',
      CODE_ENABLED: 'false',
      WATCH_CODEX_MONTHLY_TOKENS: '0',
      WATCH_GEMINI_MONTHLY_TOKENS: '0',
    }, () => {
      assert.equal(selectProvider(1000), 'gemini');
    });
  });

  it('com limites escolhe quem tem maior percentual restante', () => {
    writeStore({
      month: currentMonth(),
      codex: { requests: 10, estimatedTokens: 6_000_000 },
      gemini: { requests: 5, estimatedTokens: 300_000 },
      code: { requests: 0, estimatedTokens: 0 },
    });
    withEnv({
      CODEX_ENABLED: 'true',
      GEMINI_ENABLED: 'true',
      CODE_ENABLED: 'false',
      WATCH_CODEX_MONTHLY_TOKENS: '10000000',
      WATCH_GEMINI_MONTHLY_TOKENS: '1500000',
    }, () => {
      assert.equal(selectProvider(1000), 'gemini');
    });
  });

  it('codex esgotado usa gemini automaticamente', () => {
    writeStore({
      month: currentMonth(),
      codex: { requests: 100, estimatedTokens: 9_999_000 },
      gemini: { requests: 10, estimatedTokens: 100_000 },
      code: { requests: 0, estimatedTokens: 0 },
    });
    withEnv({
      CODEX_ENABLED: 'true',
      GEMINI_ENABLED: 'true',
      CODE_ENABLED: 'false',
      WATCH_CODEX_MONTHLY_TOKENS: '10000000',
      WATCH_GEMINI_MONTHLY_TOKENS: '5000000',
    }, () => {
      assert.equal(selectProvider(5_000), 'gemini');
    });
  });

  it('gemini esgotado usa codex automaticamente', () => {
    writeStore({
      month: currentMonth(),
      codex: { requests: 5, estimatedTokens: 100_000 },
      gemini: { requests: 100, estimatedTokens: 1_499_000 },
      code: { requests: 0, estimatedTokens: 0 },
    });
    withEnv({
      CODEX_ENABLED: 'true',
      GEMINI_ENABLED: 'true',
      CODE_ENABLED: 'false',
      WATCH_CODEX_MONTHLY_TOKENS: '10000000',
      WATCH_GEMINI_MONTHLY_TOKENS: '1500000',
    }, () => {
      assert.equal(selectProvider(5_000), 'codex');
    });
  });
});
