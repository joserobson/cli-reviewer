import { existsSync, readFileSync, writeFileSync } from 'fs';
import { config } from 'dotenv';
import prompts, { type PromptObject } from 'prompts';

config();

const REQUIRED_ENV = ['GITLAB_PROJECTS', 'GITHUB_REPOSITORIES'];

function mergeEnvContent(base: string, updates: Record<string, string>): string {
  const lines = base.split(/\r?\n/);
  const seen = new Set<string>();
  const next = lines.map(line => {
    const match = line.match(/^([A-Z0-9_]+)=/);
    if (!match) return line;

    const key = match[1];
    if (!(key in updates)) return line;

    seen.add(key);
    return `${key}=${updates[key]}`;
  });

  const missing = Object.entries(updates).filter(([key]) => !seen.has(key));
  if (missing.length > 0) {
    next.push('', '# Added by npm run setup');
    for (const [key, value] of missing) next.push(`${key}=${value}`);
  }

  return next.join('\n');
}

async function main(): Promise<void> {
  console.log('\nCLI Reviewer setup\n');

  const { environment } = await prompts(
    {
      type: 'select',
      name: 'environment',
      message: 'Onde voce pretende rodar o CLI Reviewer?',
      choices: [
        {
          title: 'Localmente na minha maquina',
          description: 'Uso individual com modo interativo ou watcher por polling.',
          value: 'local',
        },
        {
          title: 'Em um servidor/VPS',
          description: 'Automacao continua com webhooks do GitLab e/ou GitHub.',
          value: 'server',
        },
      ],
    },
    { onCancel: () => process.exit(0) },
  ) as { environment: 'local' | 'server' };

  const envExists = existsSync('.env');
  if (envExists) {
    const hasProjectConfig = REQUIRED_ENV.some(key => Boolean(process.env[key]));
    console.log('.env encontrado; nao vou sobrescrever automaticamente.');
    if (!hasProjectConfig) {
      console.log('Nenhum projeto configurado. Defina GITLAB_PROJECTS ou GITHUB_REPOSITORIES.');
    } else {
      console.log('Configuracao de projetos encontrada.');
    }
    console.log(environment === 'server'
      ? 'Para servidor, confirme AUTO_REVIEW_MODE=webhook, WEBHOOK_PORT e WEBHOOK_SECRET.'
      : 'Para uso local, confirme AUTO_REVIEW_MODE=polling e WATCH_INTERVAL_MINUTES.');
    return;
  }

  const { createEnv } = await prompts(
    {
      type: 'confirm',
      name: 'createEnv',
      message: 'Criar .env a partir de .env.example?',
      initial: true,
    },
    { onCancel: () => process.exit(0) },
  ) as { createEnv: boolean };

  if (!createEnv) {
    console.log('Setup encerrado sem criar .env.');
    return;
  }

  const { platforms } = await prompts(
    {
      type: 'multiselect',
      name: 'platforms',
      message: 'Quais plataformas deseja configurar?',
      choices: [
        { title: 'GitLab Merge Requests', value: 'gitlab', selected: true },
        { title: 'GitHub Pull Requests', value: 'github', selected: false },
      ],
      min: 1,
    },
    { onCancel: () => process.exit(0) },
  ) as { platforms: Array<'gitlab' | 'github'> };

  const wantsGitLab = platforms.includes('gitlab');
  const wantsGitHub = platforms.includes('github');

  const platformPrompts: PromptObject[] = [];
  if (wantsGitLab) {
    platformPrompts.push(
      {
        type: 'text',
        name: 'gitlabUrl',
        message: 'GITLAB_URL',
        initial: process.env.GITLAB_URL ?? 'https://your-gitlab.example.com',
      },
      {
        type: 'password',
        name: 'gitlabToken',
        message: 'GITLAB_TOKEN',
      },
      {
        type: 'text',
        name: 'gitlabProjects',
        message: 'GITLAB_PROJECTS (ex: 133:front:Frontend,134:api:API)',
        initial: process.env.GITLAB_PROJECTS ?? '133:front:Frontend Angular',
      },
    );
  }

  if (wantsGitHub) {
    platformPrompts.push(
      {
        type: 'password',
        name: 'githubToken',
        message: 'GITHUB_TOKEN (opcional para leitura de repos publicos; necessario para comentar/aprovar/merge)',
      },
      {
        type: 'text',
        name: 'githubRepositories',
        message: 'GITHUB_REPOSITORIES (ex: owner/repo:generic:CLI Reviewer)',
        initial: process.env.GITHUB_REPOSITORIES ?? 'owner/repo:generic:CLI Reviewer',
      },
    );
  }

  const answers = await prompts(
    [
      ...platformPrompts,
      {
        type: 'confirm',
        name: 'codexEnabled',
        message: 'Habilitar Codex CLI?',
        initial: true,
      },
      {
        type: 'confirm',
        name: 'geminiEnabled',
        message: 'Habilitar Gemini CLI?',
        initial: true,
      },
      {
        type: 'confirm',
        name: 'codeEnabled',
        message: 'Habilitar Claude Code?',
        initial: false,
      },
    ],
    { onCancel: () => process.exit(0) },
  ) as {
    gitlabUrl?: string;
    gitlabToken?: string;
    gitlabProjects?: string;
    githubToken?: string;
    githubRepositories?: string;
    codexEnabled: boolean;
    geminiEnabled: boolean;
    codeEnabled: boolean;
  };

  const updates: Record<string, string> = {
    CODEX_ENABLED: String(answers.codexEnabled),
    GEMINI_ENABLED: String(answers.geminiEnabled),
    CODE_ENABLED: String(answers.codeEnabled),
  };

  if (wantsGitLab) {
    updates.GITLAB_URL = answers.gitlabUrl?.trim() ?? '';
    updates.GITLAB_TOKEN = answers.gitlabToken?.trim() ?? '';
    updates.GITLAB_PROJECTS = answers.gitlabProjects?.trim() ?? '';
  }

  if (wantsGitHub) {
    updates.GITHUB_TOKEN = answers.githubToken?.trim() ?? '';
    updates.GITHUB_REPOSITORIES = answers.githubRepositories?.trim() ?? '';
  }

  if (environment === 'server') {
    Object.assign(updates, {
      AUTO_REVIEW_ENABLED: 'true',
      AUTO_REVIEW_MODE: 'webhook',
      WEBHOOK_PORT: '3333',
      WEBHOOK_SECRET: 'change-me',
      AUTO_REVIEW_POST_COMMENT: 'true',
      AUTO_REVIEW_NOTIFY_DESKTOP: 'false',
      AUTO_REVIEW_SKIP_DRAFT: 'true',
      AUTO_REVIEW_APPROVE_ON_SUCCESS: 'false',
      AUTO_REVIEW_MERGE_ON_SUCCESS: 'false',
    });
  } else {
    Object.assign(updates, {
      AUTO_REVIEW_ENABLED: 'false',
      AUTO_REVIEW_MODE: 'polling',
      WATCH_INTERVAL_MINUTES: '2',
      AUTO_REVIEW_NOTIFY_DESKTOP: 'true',
      AUTO_REVIEW_POST_COMMENT: 'true',
      AUTO_REVIEW_SKIP_DRAFT: 'true',
      AUTO_REVIEW_APPROVE_ON_SUCCESS: 'false',
      AUTO_REVIEW_MERGE_ON_SUCCESS: 'false',
    });
  }

  const example = existsSync('.env.example') ? readFileSync('.env.example', 'utf8') : '';
  writeFileSync('.env', mergeEnvContent(example, updates), 'utf8');

  console.log('\n.env criado.');
  console.log('Proximos passos: npm run doctor e depois npm run review, npm run watch ou npm run webhook.');
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
