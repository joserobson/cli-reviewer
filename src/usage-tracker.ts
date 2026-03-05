import { readFileSync, writeFileSync, existsSync } from 'fs';
import type { AIProvider } from './ai';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface ProviderUsage {
  requests: number;
  estimatedTokens: number;
}

interface UsageStore {
  month: string; // "YYYY-MM"
  claude: ProviderUsage;
  gemini: ProviderUsage;
}

export interface UsageSummary {
  month: string;
  claude: ProviderUsage & { limit: number };
  gemini: ProviderUsage & { limit: number };
}

// ─── Persistência ─────────────────────────────────────────────────────────────

const STORE_PATH = '.llm-usage.json';

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function emptyStore(): UsageStore {
  return {
    month: currentMonth(),
    claude: { requests: 0, estimatedTokens: 0 },
    gemini: { requests: 0, estimatedTokens: 0 },
  };
}

function loadStore(): UsageStore {
  if (existsSync(STORE_PATH)) {
    try {
      const data = JSON.parse(readFileSync(STORE_PATH, 'utf8')) as UsageStore;
      // Novo mês → zera automaticamente
      if (data.month === currentMonth()) return data;
    } catch {
      // Arquivo corrompido → reinicia
    }
  }
  return emptyStore();
}

function saveStore(store: UsageStore): void {
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
}

// ─── Estimativa de tokens ─────────────────────────────────────────────────────

/**
 * Estimativa padrão: 1 token ≈ 4 caracteres (funciona bem para código/português).
 * Não é exata, mas suficiente para gerenciar limites mensais.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ─── API pública ──────────────────────────────────────────────────────────────

export function recordUsage(provider: AIProvider, tokens: number): void {
  const store = loadStore();
  store[provider].requests += 1;
  store[provider].estimatedTokens += tokens;
  saveStore(store);
}

export function getUsageSummary(): UsageSummary {
  const store = loadStore();
  return {
    month: store.month,
    claude: {
      ...store.claude,
      limit: parseInt(process.env.WATCH_CLAUDE_MONTHLY_TOKENS ?? '0'),
    },
    gemini: {
      ...store.gemini,
      limit: parseInt(process.env.WATCH_GEMINI_MONTHLY_TOKENS ?? '0'),
    },
  };
}

/**
 * Seleciona o provider com maior capacidade restante.
 *
 * Algoritmo (em ordem de prioridade):
 * 1. Se os dois limites estão configurados → compara % restante; se um está
 *    esgotado para este prompt, usa o outro.
 * 2. Se só um limite está configurado → protege apenas ele.
 * 3. Sem limites → balanceia por contagem de requisições (round-robin simples).
 */
export function selectProvider(estimatedPromptTokens: number): AIProvider {
  const store = loadStore();

  const claudeLimit = parseInt(process.env.WATCH_CLAUDE_MONTHLY_TOKENS ?? '0');
  const geminiLimit = parseInt(process.env.WATCH_GEMINI_MONTHLY_TOKENS ?? '0');

  const claudeUsed = store.claude.estimatedTokens;
  const geminiUsed = store.gemini.estimatedTokens;

  if (claudeLimit > 0 && geminiLimit > 0) {
    const claudeRemaining = claudeLimit - claudeUsed;
    const geminiRemaining = geminiLimit - geminiUsed;

    // Um esgotado → usa o outro
    const claudeExhausted = claudeRemaining < estimatedPromptTokens;
    const geminiExhausted = geminiRemaining < estimatedPromptTokens;
    if (claudeExhausted && !geminiExhausted) return 'gemini';
    if (geminiExhausted && !claudeExhausted) return 'claude';

    // Ambos com capacidade → maior % restante vence
    const claudePct = claudeRemaining / claudeLimit;
    const geminiPct = geminiRemaining / geminiLimit;
    return claudePct >= geminiPct ? 'claude' : 'gemini';
  }

  // Só um limite configurado → protege ele quando estiver próximo do fim
  if (claudeLimit > 0 && (claudeLimit - claudeUsed) < estimatedPromptTokens) return 'gemini';
  if (geminiLimit > 0 && (geminiLimit - geminiUsed) < estimatedPromptTokens) return 'claude';

  // Sem limites ou nenhum esgotado → balanceia por número de análises
  return store.claude.requests <= store.gemini.requests ? 'claude' : 'gemini';
}
