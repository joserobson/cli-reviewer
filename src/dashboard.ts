import { createServer, type ServerResponse } from 'http';
import { config } from 'dotenv';

import { envInt } from './env-utils';
import { loadReviewStore, type ReviewEvent } from './review-store';
import { getUsageSummary } from './usage-tracker';

config();

interface DashboardSummary {
  totalReviews: number;
  approved: number;
  needsReview: number;
  failed: number;
  skipped: number;
  commentsPosted: number;
  approvalsPosted: number;
  mergesStarted: number;
  estimatedTokens: number;
}

function summarize(events: ReviewEvent[]): DashboardSummary {
  return {
    totalReviews: events.length,
    approved: events.filter(e => e.status === 'approved').length,
    needsReview: events.filter(e => e.status === 'needs-review').length,
    failed: events.filter(e => e.status === 'failed').length,
    skipped: events.filter(e => e.status === 'skipped').length,
    commentsPosted: events.filter(e => e.commentPosted).length,
    approvalsPosted: events.filter(e => e.approved).length,
    mergesStarted: events.filter(e => e.merged).length,
    estimatedTokens: events.reduce((sum, e) => sum + e.estimatedTokens, 0),
  };
}

function jsonData(): object {
  const store = loadReviewStore();
  const events = [...store.events].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return {
    summary: summarize(events),
    usage: getUsageSummary(),
    events,
  };
}

function send(res: ServerResponse, status: number, body: string, contentType: string): void {
  res.writeHead(status, { 'Content-Type': contentType });
  res.end(body);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR');
}

function renderDashboard(): string {
  const data = jsonData() as { summary: DashboardSummary; usage: ReturnType<typeof getUsageSummary>; events: ReviewEvent[] };
  const { summary, usage, events } = data;

  const providerRows = (['codex', 'gemini', 'code'] as const).map(provider => {
    const p = usage[provider];
    const limit = p.limit > 0 ? p.limit.toLocaleString('pt-BR') : 'sem limite';
    const percent = p.limit > 0 ? `${Math.round((p.estimatedTokens / p.limit) * 100)}%` : '-';
    return `
      <tr>
        <td>${provider}</td>
        <td>${p.enabled ? 'habilitado' : 'desabilitado'}</td>
        <td>${p.requests.toLocaleString('pt-BR')}</td>
        <td>${p.estimatedTokens.toLocaleString('pt-BR')}</td>
        <td>${limit}</td>
        <td>${percent}</td>
      </tr>`;
  }).join('');

  const eventRows = events.slice(0, 100).map(event => `
    <tr>
      <td>${formatDate(event.timestamp)}</td>
      <td>${event.platform}</td>
      <td>${escapeHtml(event.projectLabel)}</td>
      <td><a href="${escapeHtml(event.requestUrl)}" target="_blank" rel="noreferrer">!${event.requestIid}</a></td>
      <td>${escapeHtml(event.requestTitle)}</td>
      <td>${event.provider}</td>
      <td><span class="status ${event.status}">${event.status}</span></td>
      <td>${event.estimatedTokens.toLocaleString('pt-BR')}</td>
      <td>${event.suggestionsCount}</td>
      <td>${event.risksCount}</td>
    </tr>
  `).join('');

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CLI Reviewer Dashboard</title>
  <style>
    :root { color-scheme: light; font-family: Inter, Segoe UI, Arial, sans-serif; }
    body { margin: 0; background: #f6f7f9; color: #20242a; }
    header { background: #18202a; color: #fff; padding: 20px 28px; }
    h1 { margin: 0; font-size: 24px; letter-spacing: 0; }
    main { padding: 24px 28px 40px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-bottom: 24px; }
    .metric { background: #fff; border: 1px solid #dfe4ea; border-radius: 8px; padding: 14px; }
    .metric span { display: block; color: #667085; font-size: 12px; margin-bottom: 8px; }
    .metric strong { font-size: 24px; }
    section { margin-top: 24px; }
    h2 { font-size: 18px; margin: 0 0 12px; }
    .table-wrap { overflow-x: auto; background: #fff; border: 1px solid #dfe4ea; border-radius: 8px; }
    table { width: 100%; border-collapse: collapse; min-width: 820px; }
    th, td { padding: 10px 12px; border-bottom: 1px solid #edf0f3; text-align: left; font-size: 13px; vertical-align: top; }
    th { background: #f0f3f6; color: #475467; font-weight: 600; }
    a { color: #175cd3; text-decoration: none; }
    .status { display: inline-block; padding: 3px 8px; border-radius: 999px; font-size: 12px; }
    .approved { background: #dcfae6; color: #067647; }
    .needs-review { background: #fef0c7; color: #b54708; }
    .failed { background: #fee4e2; color: #b42318; }
    .skipped { background: #e4e7ec; color: #344054; }
    .empty { padding: 18px; color: #667085; }
  </style>
</head>
<body>
  <header>
    <h1>CLI Reviewer Dashboard</h1>
  </header>
  <main>
    <div class="grid">
      <div class="metric"><span>Revisões registradas</span><strong>${summary.totalReviews}</strong></div>
      <div class="metric"><span>Aprovadas pela IA</span><strong>${summary.approved}</strong></div>
      <div class="metric"><span>Revisão necessária</span><strong>${summary.needsReview}</strong></div>
      <div class="metric"><span>Falhas</span><strong>${summary.failed}</strong></div>
      <div class="metric"><span>Tokens estimados</span><strong>${summary.estimatedTokens.toLocaleString('pt-BR')}</strong></div>
      <div class="metric"><span>Comentários postados</span><strong>${summary.commentsPosted}</strong></div>
    </div>

    <section>
      <h2>Consumo por provider (${usage.month})</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Provider</th><th>Status</th><th>Requisições</th><th>Tokens</th><th>Limite</th><th>Uso</th></tr></thead>
          <tbody>${providerRows}</tbody>
        </table>
      </div>
    </section>

    <section>
      <h2>Últimas revisões</h2>
      <div class="table-wrap">
        ${eventRows ? `<table>
          <thead><tr><th>Data</th><th>Plataforma</th><th>Projeto</th><th>Review</th><th>Título</th><th>Provider</th><th>Status</th><th>Tokens</th><th>Sugestões</th><th>Riscos</th></tr></thead>
          <tbody>${eventRows}</tbody>
        </table>` : '<div class="empty">Nenhuma revisão registrada ainda.</div>'}
      </div>
    </section>
  </main>
</body>
</html>`;
}

function main(): void {
  const port = envInt('DASHBOARD_PORT', 3334);

  createServer((req, res) => {
    if (req.url === '/health') {
      send(res, 200, JSON.stringify({ ok: true }), 'application/json');
      return;
    }

    if (req.url === '/api/dashboard') {
      send(res, 200, JSON.stringify(jsonData(), null, 2), 'application/json');
      return;
    }

    if (req.url === '/' || req.url === '/dashboard') {
      send(res, 200, renderDashboard(), 'text/html; charset=utf-8');
      return;
    }

    send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  }).listen(port, () => {
    console.log(`CLI Reviewer dashboard: http://localhost:${port}/dashboard`);
  });
}

main();
