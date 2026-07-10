import { readFileSync, writeFileSync, existsSync } from 'fs';
import { AI_PROVIDERS, getEnabledProviders, type AIProvider } from './ai';

interface ProviderUsage {
  requests: number;
  estimatedTokens: number;
}

interface UsageStore {
  month: string; // "YYYY-MM"
  codex: ProviderUsage;
  gemini: ProviderUsage;
  code: ProviderUsage;
  claude?: ProviderUsage;
}

export interface UsageSummary {
  month: string;
  codex: ProviderUsage & { limit: number; enabled: boolean };
  gemini: ProviderUsage & { limit: number; enabled: boolean };
  code: ProviderUsage & { limit: number; enabled: boolean };
}

const STORE_PATH = '.llm-usage.json';

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function emptyUsage(): ProviderUsage {
  return { requests: 0, estimatedTokens: 0 };
}

function emptyStore(): UsageStore {
  return {
    month: currentMonth(),
    codex: emptyUsage(),
    gemini: emptyUsage(),
    code: emptyUsage(),
  };
}

function normalizeStore(store: Partial<UsageStore>): UsageStore {
  return {
    month: store.month ?? currentMonth(),
    codex: store.codex ?? emptyUsage(),
    gemini: store.gemini ?? emptyUsage(),
    code: store.code ?? store.claude ?? emptyUsage(),
  };
}

function loadStore(): UsageStore {
  if (existsSync(STORE_PATH)) {
    try {
      const data = JSON.parse(readFileSync(STORE_PATH, 'utf8')) as Partial<UsageStore>;
      if (data.month === currentMonth()) return normalizeStore(data);
    } catch {
      // Arquivo corrompido: reinicia.
    }
  }
  return emptyStore();
}

function saveStore(store: UsageStore): void {
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
}

/**
 * Estimativa padrao: 1 token ~ 4 caracteres (funciona bem para codigo/portugues).
 * Nao e exata, mas suficiente para gerenciar limites mensais.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function recordUsage(provider: AIProvider, tokens: number): void {
  const store = loadStore();
  store[provider].requests += 1;
  store[provider].estimatedTokens += tokens;
  saveStore(store);
}

export function getUsageSummary(): UsageSummary {
  const store = loadStore();
  const enabled = new Set(getEnabledProviders());

  return {
    month: store.month,
    codex: {
      ...store.codex,
      limit: monthlyLimit('codex'),
      enabled: enabled.has('codex'),
    },
    gemini: {
      ...store.gemini,
      limit: monthlyLimit('gemini'),
      enabled: enabled.has('gemini'),
    },
    code: {
      ...store.code,
      limit: monthlyLimit('code'),
      enabled: enabled.has('code'),
    },
  };
}

/**
 * Seleciona a CLI habilitada com maior capacidade restante.
 *
 * Algoritmo:
 * 1. Remove CLIs desabilitadas por env.
 * 2. Se ha limites configurados, escolhe a maior porcentagem restante.
 * 3. Sem limites, balanceia por contagem de analises; Codex vence empate.
 */
export function selectProvider(estimatedPromptTokens: number): AIProvider {
  const store = loadStore();
  const enabledProviders = getEnabledProviders();

  if (enabledProviders.length === 0) {
    throw new Error('Nenhuma CLI de IA habilitada. Ative CODEX_ENABLED, GEMINI_ENABLED ou CODE_ENABLED no .env.');
  }

  const candidates = enabledProviders.map(provider => {
    const usage = store[provider];
    const limit = monthlyLimit(provider);
    const remaining = limit > 0 ? limit - usage.estimatedTokens : Number.POSITIVE_INFINITY;
    return {
      provider,
      usage,
      limit,
      remaining,
      exhausted: remaining < estimatedPromptTokens,
      remainingPct: limit > 0 ? remaining / limit : Number.POSITIVE_INFINITY,
    };
  });

  const available = candidates.filter(candidate => !candidate.exhausted);
  const pool = available.length > 0 ? available : candidates;
  const limited = pool.filter(candidate => candidate.limit > 0);

  if (limited.length > 0) {
    return limited.sort((a, b) => b.remainingPct - a.remainingPct)[0].provider;
  }

  return pool.sort((a, b) => {
    if (a.usage.requests !== b.usage.requests) return a.usage.requests - b.usage.requests;
    return AI_PROVIDERS.indexOf(a.provider) - AI_PROVIDERS.indexOf(b.provider);
  })[0].provider;
}

function monthlyLimit(provider: AIProvider): number {
  const key = `WATCH_${provider.toUpperCase()}_MONTHLY_TOKENS`;
  const fallback = provider === 'code' ? process.env.WATCH_CLAUDE_MONTHLY_TOKENS : undefined;
  return parseInt(process.env[key] ?? fallback ?? '0');
}
