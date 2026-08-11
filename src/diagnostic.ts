#!/usr/bin/env tsx
/**
 * Script de diagnóstico para troubleshooting do webhook server
 * Execução: tsx src/diagnostic.ts ou npm run diagnostic
 */

import { config } from 'dotenv';
import { existsSync, readFileSync } from 'fs';
import { getAutoReviewConfig } from './automation';
import { loadProjects } from './projects';
import { envInt } from './env-utils';

config();

console.log('═══════════════════════════════════════════════════════════');
console.log('  CLI REVIEWER - DIAGNÓSTICO DO WEBHOOK SERVER');
console.log('═══════════════════════════════════════════════════════════\n');

// 1. Verificar variáveis de ambiente críticas
console.log('1️⃣  VARIÁVEIS DE AMBIENTE:\n');

const criticalVars = [
  'GITLAB_URL',
  'GITLAB_TOKEN',
  'GITLAB_PROJECTS',
  'GITHUB_REPOSITORIES',
  'AUTO_REVIEW_MODE',
  'AUTO_REVIEW_ENABLED',
  'WEBHOOK_SECRET',
  'GITHUB_WEBHOOK_SECRET',
  'WEBHOOK_PORT',
];

for (const varName of criticalVars) {
  const value = process.env[varName];
  if (value === undefined) {
    console.log(`   ⚠️  ${varName}: não definido`);
  } else if (varName.includes('SECRET') || varName.includes('TOKEN')) {
    console.log(`   ✓ ${varName}: ****** (${value.length} caracteres)`);
  } else if (value.length > 50) {
    console.log(`   ✓ ${varName}: ${value.slice(0, 47)}... (${value.length} caracteres)`);
  } else {
    console.log(`   ✓ ${varName}: ${value}`);
  }
}

// 2. Verificar configuração de auto-review
console.log('\n2️⃣  CONFIGURAÇÃO DE AUTO-REVIEW:\n');
try {
  const autoConfig = getAutoReviewConfig();
  console.log(`   Modo: ${autoConfig.mode}`);
  console.log(`   Habilitado: ${autoConfig.enabled}`);
  console.log(`   Postar comentário: ${autoConfig.postComment}`);
  console.log(`   Notificações desktop: ${autoConfig.notifyDesktop}`);
  console.log(`   Ignorar drafts: ${autoConfig.skipDraft}`);
  console.log(`   Aprovar automaticamente: ${autoConfig.approveOnSuccess}`);
  console.log(`   Merge automaticamente: ${autoConfig.mergeOnSuccess}`);

  if (autoConfig.mode !== 'webhook') {
    console.log(`\n   ⚠️  ATENÇÃO: AUTO_REVIEW_MODE=${autoConfig.mode}, mas esperado 'webhook'`);
  }

  if (!autoConfig.enabled) {
    console.log(`\n   ⚠️  ATENÇÃO: AUTO_REVIEW_ENABLED=false - análises desabilitadas!`);
  }
} catch (err) {
  console.log(`   ❌ Erro ao carregar configuração: ${err instanceof Error ? err.message : String(err)}`);
}

// 3. Verificar projetos configurados
console.log('\n3️⃣  PROJETOS CONFIGURADOS:\n');
try {
  const projects = loadProjects();
  if (projects.length === 0) {
    console.log(`   ❌ Nenhum projeto configurado!`);
    console.log(`      Defina GITLAB_PROJECTS ou GITHUB_REPOSITORIES no .env`);
  } else {
    console.log(`   ✓ ${projects.length} projeto(s) encontrado(s):\n`);
    for (const p of projects) {
      console.log(`      [${p.platform}/${p.type}] ${p.label}`);
      console.log(`         ID: ${p.id}`);
      if (p.platform === 'gitlab') {
        console.log(`         URL: ${p.gitlabUrl ?? 'não definido'}`);
      }
    }
  }
} catch (err) {
  console.log(`   ❌ Erro ao carregar projetos: ${err instanceof Error ? err.message : String(err)}`);
}

// 4. Verificar arquivos de estado
console.log('\n4️⃣  ARQUIVOS DE ESTADO:\n');

const stateFiles = [
  { path: process.env.WEBHOOK_STATE_PATH ?? '.webhook-state.json', name: 'Webhook state' },
  { path: process.env.REVIEW_STORE_PATH ?? '.review-dashboard.json', name: 'Review dashboard' },
  { path: process.env.LLM_USAGE_STORE_PATH ?? '.llm-usage.json', name: 'LLM usage' },
];

for (const { path, name } of stateFiles) {
  if (existsSync(path)) {
    try {
      const content = readFileSync(path, 'utf8');
      const data = JSON.parse(content);
      const size = (content.length / 1024).toFixed(2);
      console.log(`   ✓ ${name}: ${path} (${size} KB)`);

      if (name === 'Webhook state') {
        const processedCount = Object.keys(data.processed ?? {}).length;
        const processingCount = data.processing?.length ?? 0;
        console.log(`      Processados: ${processedCount} | Em processamento: ${processingCount}`);
      } else if (name === 'Review dashboard') {
        const reviewCount = data.reviews?.length ?? 0;
        console.log(`      Reviews registrados: ${reviewCount}`);
      }
    } catch (err) {
      console.log(`   ⚠️  ${name}: arquivo existe mas não pode ser lido`);
    }
  } else {
    console.log(`   ℹ️  ${name}: arquivo não existe (${path})`);
  }
}

// 5. Verificar porta do webhook
console.log('\n5️⃣  WEBHOOK SERVER:\n');
const port = envInt('WEBHOOK_PORT', 3333);
console.log(`   Porta configurada: ${port}`);
console.log(`   Endpoint GitLab: http://localhost:${port}/webhooks/gitlab`);
console.log(`   Endpoint GitHub: http://localhost:${port}/webhooks/github`);
console.log(`   Health check: http://localhost:${port}/health`);

// 6. Verificar CLIs disponíveis
console.log('\n6️⃣  COMANDOS CLI DISPONÍVEIS:\n');

const { execSync } = require('child_process');

const cliCommands = [
  { cmd: 'codex --version', name: 'Codex CLI' },
  { cmd: 'gemini --version', name: 'Gemini CLI' },
  { cmd: 'claude --version', name: 'Claude CLI' },
];

for (const { cmd, name } of cliCommands) {
  try {
    const output = execSync(cmd, { encoding: 'utf8', stdio: 'pipe' }).trim();
    console.log(`   ✓ ${name}: ${output.split('\n')[0]}`);
  } catch {
    console.log(`   ❌ ${name}: não disponível`);
  }
}

// 7. Verificar conectividade GitLab/GitHub
console.log('\n7️⃣  CONECTIVIDADE:\n');

const gitlabUrl = process.env.GITLAB_URL;
const gitlabToken = process.env.GITLAB_TOKEN;

if (gitlabUrl && gitlabToken) {
  console.log(`   Testando GitLab: ${gitlabUrl}`);
  try {
    const response = await fetch(`${gitlabUrl}/api/v4/user`, {
      headers: { 'PRIVATE-TOKEN': gitlabToken },
    });
    if (response.ok) {
      const user = await response.json();
      console.log(`   ✓ GitLab conectado: ${user.name ?? user.username}`);
    } else {
      console.log(`   ❌ GitLab retornou erro: ${response.status} ${response.statusText}`);
    }
  } catch (err) {
    console.log(`   ❌ Erro ao conectar GitLab: ${err instanceof Error ? err.message : String(err)}`);
  }
} else {
  console.log(`   ⚠️  GitLab não configurado (GITLAB_URL ou GITLAB_TOKEN ausente)`);
}

console.log('\n═══════════════════════════════════════════════════════════');
console.log('  DIAGNÓSTICO CONCLUÍDO');
console.log('═══════════════════════════════════════════════════════════\n');

console.log('💡 PRÓXIMOS PASSOS:\n');
console.log('   1. Se AUTO_REVIEW_ENABLED=false, habilite no .env');
console.log('   2. Verifique se o webhook está configurado no GitLab:');
console.log('      Project → Settings → Webhooks → URL do seu servidor');
console.log('   3. Teste manualmente enviando um webhook de teste');
console.log('   4. Monitore os logs com: docker logs -f <container-name>\n');
