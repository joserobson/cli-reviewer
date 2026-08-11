/**
 * Utilitários para formatação de data/hora com timezone configurável
 */

/**
 * Retorna o timezone configurado (padrão: America/Sao_Paulo)
 */
export function getTimezone(): string {
  return process.env.TZ ?? 'America/Sao_Paulo';
}

/**
 * Formata timestamp ISO em formato brasileiro com timezone correto
 * @param iso - Timestamp ISO string (ex: "2024-08-10T15:30:45.123Z")
 * @returns String formatada (ex: "10/08/2024 12:30:45")
 */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { timeZone: getTimezone() });
}

/**
 * Formata data atual em formato brasileiro para logs
 * @returns String formatada (ex: "10/08/2024 12:30:45")
 */
export function nowFormatted(): string {
  return new Date().toLocaleString('pt-BR', { timeZone: getTimezone() });
}

/**
 * Formata apenas a hora atual em formato brasileiro para logs
 * @returns String formatada (ex: "12:30:45")
 */
export function timeFormatted(): string {
  return new Date().toLocaleTimeString('pt-BR', { timeZone: getTimezone() });
}

/**
 * Retorna timestamp atual em formato ISO
 */
export function nowISO(): string {
  return new Date().toISOString();
}
