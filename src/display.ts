import chalk from 'chalk';
import type { MergeRequest, ClaudeAnalysis, Suggestion } from './types';
import type { AIProvider } from './ai';

const DIVIDER = chalk.dim('─'.repeat(62));

function severityLabel(s: Suggestion['severidade']): string {
  switch (s) {
    case 'critico':  return chalk.bgRed.white.bold(' CRÍTICO ');
    case 'aviso':    return chalk.bgYellow.black.bold(' AVISO   ');
    case 'sugestao': return chalk.bgBlue.white.bold(' SUGESTÃO');
  }
}

const PROVIDER_LABEL: Record<AIProvider, string> = {
  claude: 'Claude CLI ',
  gemini: 'Gemini CLI',
};

export function displayBanner(provider?: AIProvider): void {
  console.clear();
  const label = provider ? PROVIDER_LABEL[provider] : '          ';
  console.log(chalk.bold.cyan('\n  ╔══════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan(`  ║   🤖  MR Reviewer  —  ${label}          ║`));
  console.log(chalk.bold.cyan('  ╚══════════════════════════════════════════╝\n'));
}

export function displayAnalysis(mr: MergeRequest, analysis: ClaudeAnalysis): void {
  console.log('\n' + DIVIDER);
  console.log(
    chalk.bold(`  MR #${mr.iid}  `) +
    chalk.white(mr.title.length > 48 ? mr.title.slice(0, 45) + '…' : mr.title),
  );
  console.log(
    chalk.dim(`  ${mr.source_branch} → ${mr.target_branch}`) +
    chalk.dim(`   por @${mr.author.username}`),
  );
  console.log(DIVIDER + '\n');

  // Recomendação em destaque
  if (analysis.aprovacao_recomendada) {
    console.log(chalk.bold.green('  ✅  APROVAÇÃO RECOMENDADA'));
  } else {
    console.log(chalk.bold.red('  ❌  NÃO RECOMENDADO PARA APROVAÇÃO'));
  }

  // Resumo
  console.log(`\n${chalk.bold.yellow('  📋 RESUMO')}`);
  console.log(DIVIDER);
  console.log(`  ${analysis.resumo}\n`);

  // Riscos
  if (analysis.riscos.length > 0) {
    console.log(chalk.bold.red('  ⚠️  RISCOS'));
    console.log(DIVIDER);
    for (const risco of analysis.riscos) {
      console.log(`  ${chalk.red('▸')} ${risco}`);
    }
    console.log();
  }

  // Sugestões agrupadas por severidade
  if (analysis.sugestoes.length > 0) {
    const order: Suggestion['severidade'][] = ['critico', 'aviso', 'sugestao'];
    const sorted = [...analysis.sugestoes].sort(
      (a, b) => order.indexOf(a.severidade) - order.indexOf(b.severidade),
    );

    console.log(chalk.bold.yellow('  💡 SUGESTÕES'));
    console.log(DIVIDER);
    for (const s of sorted) {
      console.log(`\n  ${severityLabel(s.severidade)}  ${chalk.bold(s.arquivo)}`);
      console.log(`  ${chalk.dim('└─')} ${s.comentario}`);
    }
    console.log();
  }

  if (analysis.riscos.length === 0 && analysis.sugestoes.length === 0) {
    console.log(chalk.green('  🎉 Nenhum problema identificado!\n'));
  }

  console.log(DIVIDER);
  console.log(chalk.dim(`  🔗 ${mr.web_url}\n`));
}

export function createParallelProgressDisplay(labels: string[]): {
  update(index: number, state: 'running' | 'done' | 'error', detail?: string): void;
  stop(): void;
} {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  const states: Array<{ state: 'running' | 'done' | 'error'; detail: string }> =
    labels.map(() => ({ state: 'running', detail: 'aguardando...' }));

  let tick = 0;
  let firstRender = true;

  function render() {
    if (!firstRender) {
      process.stdout.write(`\x1B[${labels.length}A`);
    }
    firstRender = false;

    for (let i = 0; i < labels.length; i++) {
      const { state, detail } = states[i];
      const frame = frames[(tick + i) % frames.length];
      const spinner =
        state === 'running' ? chalk.cyan(frame)
        : state === 'done'  ? chalk.green('✓')
        :                     chalk.red('✗');
      const badge =
        state === 'running' ? chalk.dim(detail)
        : state === 'done'  ? chalk.green(detail)
        :                     chalk.red(detail);
      const label = labels[i].length > 40 ? labels[i].slice(0, 37) + '…' : labels[i].padEnd(40);
      process.stdout.write(`  ${spinner} ${label}  ${badge}\n`);
    }
    tick++;
  }

  render();
  const id = setInterval(render, 80);

  return {
    update(index, state, detail = '') {
      states[index] = { state, detail };
    },
    stop() {
      clearInterval(id);
      render();
    },
  };
}

// Spinner simples sem dependências extras
export function createSpinner(text: string) {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  const id = setInterval(() => {
    process.stdout.write(`\r  ${chalk.cyan(frames[i++ % frames.length])} ${text} `);
  }, 80);

  return {
    stop(msg?: string) {
      clearInterval(id);
      process.stdout.write(`\r${' '.repeat(text.length + 10)}\r`);
      if (msg) console.log(msg);
    },
  };
}
