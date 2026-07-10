import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { config } from 'dotenv';

import { getProviders } from './ai';
import { getAutoReviewConfig } from './automation';
import { envInt, maskSecret } from './env-utils';
import { loadProjects } from './projects';

config();

type Status = 'ok' | 'warn' | 'fail';

interface Check {
  label: string;
  status: Status;
  detail: string;
}

function commandExists(command: string): boolean {
  const probe = process.platform === 'win32' ? 'where.exe' : 'command';
  const args = process.platform === 'win32' ? [command] : ['-v', command];
  const result = spawnSync(probe, args, { stdio: 'ignore', shell: process.platform !== 'win32' });
  return result.status === 0;
}

function statusMark(status: Status): string {
  if (status === 'ok') return 'OK  ';
  if (status === 'warn') return 'WARN';
  return 'FAIL';
}

function print(checks: Check[]): void {
  console.log('\nMR Reviewer doctor\n');
  for (const check of checks) {
    console.log(`${statusMark(check.status)}  ${check.label}: ${check.detail}`);
  }

  const failures = checks.filter(c => c.status === 'fail').length;
  const warnings = checks.filter(c => c.status === 'warn').length;
  console.log(`\nResultado: ${failures} falha(s), ${warnings} aviso(s).`);
  if (failures > 0) process.exitCode = 1;
}

function main(): void {
  const checks: Check[] = [];
  const envExists = existsSync('.env');
  checks.push({
    label: '.env',
    status: envExists ? 'ok' : 'fail',
    detail: envExists ? 'encontrado' : 'nao encontrado; rode npm run setup ou copie .env.example',
  });

  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
  checks.push({
    label: 'Node.js',
    status: nodeMajor >= 18 ? 'ok' : 'fail',
    detail: `v${process.versions.node}${nodeMajor >= 18 ? '' : '; requer >=18'}`,
  });

  checks.push({
    label: 'GITLAB_URL',
    status: process.env.GITLAB_URL ? 'ok' : 'fail',
    detail: process.env.GITLAB_URL ? process.env.GITLAB_URL : 'ausente',
  });
  checks.push({
    label: 'GITLAB_TOKEN',
    status: process.env.GITLAB_TOKEN ? 'ok' : 'fail',
    detail: maskSecret(process.env.GITLAB_TOKEN),
  });

  const projects = loadProjects();
  checks.push({
    label: 'GITLAB_PROJECTS',
    status: projects.length > 0 ? 'ok' : 'fail',
    detail: projects.length > 0
      ? `${projects.length} projeto(s): ${projects.map(p => `${p.id}:${p.type}`).join(', ')}`
      : 'configure ao menos um projeto no formato id:front|api|generic:label',
  });

  const providers = getProviders();
  const enabled = Object.entries(providers).filter(([, cfg]) => cfg.enabled);
  checks.push({
    label: 'AI providers',
    status: enabled.length > 0 ? 'ok' : 'fail',
    detail: enabled.length > 0 ? enabled.map(([key]) => key).join(', ') : 'habilite CODEX_ENABLED, GEMINI_ENABLED ou CODE_ENABLED',
  });

  for (const [key, provider] of Object.entries(providers)) {
    if (!provider.enabled) {
      checks.push({ label: `${provider.label} (${key})`, status: 'warn', detail: 'desabilitado' });
      continue;
    }

    checks.push({
      label: `${provider.label} (${provider.cmd})`,
      status: commandExists(provider.cmd) ? 'ok' : 'fail',
      detail: commandExists(provider.cmd)
        ? `encontrado; args: ${provider.args.join(' ') || '(nenhum)'}`
        : `comando nao encontrado; instale a CLI ou ajuste ${key.toUpperCase()}_CMD`,
    });
  }

  const autoConfig = getAutoReviewConfig();
  checks.push({
    label: 'AUTO_REVIEW_MODE',
    status: 'ok',
    detail: autoConfig.mode,
  });

  if (autoConfig.mode === 'webhook') {
    const port = envInt('WEBHOOK_PORT', 0);
    checks.push({
      label: 'WEBHOOK_PORT',
      status: port > 0 ? 'ok' : 'fail',
      detail: port > 0 ? String(port) : 'configure uma porta valida',
    });
    checks.push({
      label: 'WEBHOOK_SECRET',
      status: process.env.WEBHOOK_SECRET ? 'ok' : 'fail',
      detail: process.env.WEBHOOK_SECRET ? maskSecret(process.env.WEBHOOK_SECRET) : 'ausente',
    });
  } else {
    const interval = envInt('WATCH_INTERVAL_MINUTES', 0);
    checks.push({
      label: 'WATCH_INTERVAL_MINUTES',
      status: interval > 0 ? 'ok' : 'fail',
      detail: interval > 0 ? `${interval} minuto(s)` : 'deve ser maior que zero',
    });
  }

  print(checks);
}

main();
