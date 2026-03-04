import { spawn } from 'child_process';
import type { MergeRequest, FileChange, ClaudeAnalysis, ProjectType } from './types';

export type AIProvider = 'claude' | 'gemini';

const PROVIDERS: Record<AIProvider, { cmd: string; args: string[] }> = {
  claude: { cmd: 'claude', args: ['--print'] },
  gemini: { cmd: 'gemini', args: ['--yolo'] },
};

// ─── Utilitários ─────────────────────────────────────────────────────────────

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[\d;]*[A-Za-z]/g, '').replace(/\x1B[@-Z\\-_]/g, '');
}

/** Extrai o primeiro objeto JSON encontrado no texto */
function extractJSON(text: string): string {
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) return text.slice(first, last + 1);
  return text.trim();
}

// ─── Runner ───────────────────────────────────────────────────────────────────

async function runCLI(provider: AIProvider, prompt: string): Promise<string> {
  const { cmd, args } = PROVIDERS[provider];

  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });

    proc.on('close', (code) => {
      const clean = stripAnsi(stdout).trim();
      if (clean) {
        resolve(clean);
      } else {
        reject(new Error(
          `'${cmd}' encerrou sem saída (código ${code ?? '?'}).\n` +
          `Stderr: ${stripAnsi(stderr).slice(0, 400)}`,
        ));
      }
    });

    proc.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        reject(new Error(`Comando '${cmd}' não encontrado no PATH. Verifique a instalação.`));
      } else {
        reject(err);
      }
    });

    // Escreve o prompt no stdin e fecha — ambos CLIs lêem stdin em modo não-interativo
    proc.stdin.end(prompt, 'utf8');
  });
}

// ─── Construção do diff ───────────────────────────────────────────────────────

const MAX_LINES_PER_FILE = 150;
const MAX_TOTAL_LINES    = 700;

function buildDiffContent(changes: FileChange[]): string {
  let totalLines = 0;
  const parts: string[] = [];

  for (const change of changes) {
    if (totalLines >= MAX_TOTAL_LINES) {
      parts.push(`\n> ⚠️ ${changes.length - parts.length} arquivo(s) omitido(s) por limite de tamanho.`);
      break;
    }

    const status = change.new_file      ? ' **(novo arquivo)**'
                 : change.deleted_file  ? ' **(removido)**'
                 : change.renamed_file  ? ` **(renomeado de \`${change.old_path}\`)**`
                 : '';

    const lines     = change.diff.split('\n');
    const truncated = lines.length > MAX_LINES_PER_FILE
      ? lines.slice(0, MAX_LINES_PER_FILE).join('\n') +
        `\n... (${lines.length - MAX_LINES_PER_FILE} linhas omitidas)`
      : change.diff;

    totalLines += truncated.split('\n').length;
    parts.push(`### \`${change.new_path}\`${status}\n\`\`\`diff\n${truncated}\n\`\`\``);
  }

  return parts.join('\n\n');
}

// ─── Prompt Frontend Angular ──────────────────────────────────────────────────

function buildPromptFront(mr: MergeRequest, changes: FileChange[]): string {
  return `Você é um revisor de código sênior especializado em Angular e TypeScript.
Analise o Merge Request abaixo e responda com uma análise detalhada em português.

## Informações do MR
- **Título**: ${mr.title}
- **Autor**: ${mr.author.name} (@${mr.author.username})
- **Branch**: \`${mr.source_branch}\` → \`${mr.target_branch}\`
- **Descrição**: ${mr.description?.trim() || '(sem descrição)'}
- **Arquivos alterados**: ${changes.length}

## Alterações
${buildDiffContent(changes)}

## Regras de Boas Práticas Angular

Verifique especificamente as seguintes regras e sinalize cada violação como uma sugestão:

### Gerenciamento de Tempo e Assincronia
- ❌ PROIBIDO: \`setTimeout\` e \`setInterval\` em componentes — use \`RxJS timer()\`, \`interval()\` ou \`delay()\` combinados com \`takeUntilDestroyed()\`
- ❌ PROIBIDO: Subscriptions aninhadas (\`.subscribe()\` dentro de \`.subscribe()\`) — use operadores RxJS como \`switchMap\`, \`mergeMap\`, \`concatMap\`
- ❌ PROIBIDO: Subscriptions sem cancelamento — use \`takeUntilDestroyed()\`, \`AsyncPipe\` ou \`DestroyRef\`
- ⚠️ OBRIGATÓRIO: Tratar erros em observables com \`catchError\`

### Performance e Change Detection
- ⚠️ RECOMENDADO: \`ChangeDetectionStrategy.OnPush\` em todos os componentes
- ❌ PROIBIDO: Ausência de \`trackBy\` em \`*ngFor\` — sempre forneça uma função \`trackBy\`
- ❌ PROIBIDO: Chamadas de método diretamente em templates (ex: \`{{ getValor() }}\`) — use pipes puros ou propriedades computadas

### Arquitetura e Padrões Angular
- ⚠️ RECOMENDADO: Componentes standalone em vez de NgModule para código novo
- ⚠️ RECOMENDADO: \`inject()\` em vez de injeção via construtor em componentes standalone
- ⚠️ RECOMENDADO: Signals (\`signal()\`, \`computed()\`, \`effect()\`) para estado local reativo (Angular 16+)
- ⚠️ RECOMENDADO: \`input()\` e \`output()\` em vez de \`@Input()\` e \`@Output()\` (Angular 17+)
- ❌ PROIBIDO: Manipulação direta do DOM com \`document.querySelector\` ou acesso a \`ElementRef.nativeElement\` para estilos/classes — use \`Renderer2\` ou bindings Angular
- ❌ PROIBIDO: Lógica de negócio em templates — condições complexas e transformações devem estar no componente ou em pipes

### Qualidade de Código TypeScript
- ❌ PROIBIDO: Uso explícito de \`any\` — use tipagem adequada ou \`unknown\`
- ❌ PROIBIDO: \`console.log\` em código de produção
- ❌ PROIBIDO: Importações declaradas e não utilizadas
- ⚠️ RECOMENDADO: Tratamento centralizado de erros HTTP via interceptors em vez de \`catchError\` por chamada

## Instruções de Avaliação
Avalie criteriosamente:
1. **Corretude**: lógica e comportamento esperado
2. **Boas práticas**: todas as regras listadas acima
3. **Bugs potenciais**: null/undefined, race conditions, memory leaks
4. **Segurança**: XSS, injeção, dados sensíveis expostos
5. **Performance**: chamadas desnecessárias, renderizações excessivas
6. **Manutenibilidade**: legibilidade, responsabilidade única

${JSON_INSTRUCTIONS}`;
}

// ─── Prompt API .NET ──────────────────────────────────────────────────────────

function buildPromptDotNet(mr: MergeRequest, changes: FileChange[]): string {
  return `Você é um revisor de código sênior especializado em .NET (C#) e desenvolvimento de APIs REST.
Analise o Merge Request abaixo e responda com uma análise detalhada em português.

## Informações do MR
- **Título**: ${mr.title}
- **Autor**: ${mr.author.name} (@${mr.author.username})
- **Branch**: \`${mr.source_branch}\` → \`${mr.target_branch}\`
- **Descrição**: ${mr.description?.trim() || '(sem descrição)'}
- **Arquivos alterados**: ${changes.length}

## Alterações
${buildDiffContent(changes)}

## Regras de Boas Práticas .NET / C#

Verifique especificamente as seguintes regras e sinalize cada violação como uma sugestão:

### Assincronismo e Threading
- ❌ PROIBIDO: \`.Result\` ou \`.Wait()\` em Tasks — sempre use \`await\`
- ❌ PROIBIDO: \`async void\` exceto em event handlers — use \`async Task\`
- ❌ PROIBIDO: \`Task.Run()\` desnecessário em código já assíncrono
- ⚠️ RECOMENDADO: Passar \`CancellationToken\` por toda a cadeia de chamadas assíncronas
- ⚠️ RECOMENDADO: \`ConfigureAwait(false)\` em bibliotecas (não necessário em ASP.NET Core)

### API REST e Controllers
- ❌ PROIBIDO: Lógica de negócio diretamente em Controllers — delegue para Services
- ❌ PROIBIDO: Retornar tipos concretos de domínio diretamente — use DTOs/ViewModels
- ⚠️ OBRIGATÓRIO: Usar \`[ProducesResponseType]\` ou Minimal API equivalente para documentar respostas
- ⚠️ RECOMENDADO: Validação com \`FluentValidation\` ou \`DataAnnotations\` — nunca validar manualmente em controller
- ⚠️ RECOMENDADO: Usar \`IActionResult\` ou \`ActionResult<T>\` como retorno de actions
- ❌ PROIBIDO: Expor stack traces ou detalhes de exceção em respostas de produção

### Acesso a Dados e EF Core
- ❌ PROIBIDO: \`ToList()\` antes de filtros — sempre filtre no banco com \`Where()\` antes de materializar
- ❌ PROIBIDO: N+1 queries — use \`Include()\` ou projections adequadas
- ⚠️ RECOMENDADO: Usar \`AsNoTracking()\` em queries somente-leitura
- ⚠️ RECOMENDADO: Projetar com \`Select()\` para buscar apenas as colunas necessárias
- ❌ PROIBIDO: Transações manuais sem tratamento de rollback

### Injeção de Dependência e Arquitetura
- ❌ PROIBIDO: \`new\` em dependências que deveriam ser injetadas
- ❌ PROIBIDO: Singleton com estado mutável não thread-safe
- ⚠️ RECOMENDADO: Usar interfaces para serviços (facilita testes e DI)
- ⚠️ RECOMENDADO: Separar responsabilidades (SRP): um serviço por domínio

### Qualidade de Código C#
- ❌ PROIBIDO: Catching genérico \`catch (Exception)\` sem logar ou relançar adequadamente
- ❌ PROIBIDO: \`string\` para representar IDs, datas, enums — use tipos adequados
- ❌ PROIBIDO: \`Console.WriteLine\` ou \`Debug.WriteLine\` em produção — use \`ILogger\`
- ⚠️ RECOMENDADO: Usar \`record\` para DTOs imutáveis (C# 9+)
- ⚠️ RECOMENDADO: Nullable reference types habilitado — evitar \`!.\` desnecessários
- ⚠️ RECOMENDADO: \`sealed\` em classes que não devem ser herdadas

### Segurança
- ❌ PROIBIDO: SQL concatenado — use sempre parâmetros ou LINQ
- ❌ PROIBIDO: Dados sensíveis (senhas, tokens) em logs
- ⚠️ OBRIGATÓRIO: Autorização explícita em todos os endpoints (\`[Authorize]\` ou política)
- ⚠️ RECOMENDADO: Validar e sanitizar toda entrada do usuário

## Instruções de Avaliação
Avalie criteriosamente:
1. **Corretude**: lógica e comportamento esperado
2. **Boas práticas**: todas as regras listadas acima
3. **Bugs potenciais**: null reference, race conditions, deadlocks
4. **Segurança**: injeção SQL, exposição de dados, autorização
5. **Performance**: N+1, queries sem filtro, alocações desnecessárias
6. **Manutenibilidade**: legibilidade, responsabilidade única, testabilidade

${JSON_INSTRUCTIONS}`;
}

// ─── Instruções JSON (compartilhadas) ────────────────────────────────────────

const JSON_INSTRUCTIONS = `Responda SOMENTE com JSON válido (sem markdown ao redor), nesta estrutura exata:
{
  "resumo": "resumo objetivo das mudanças em 2-3 frases claras",
  "aprovacao_recomendada": true,
  "riscos": [
    "descrição de risco identificado"
  ],
  "sugestoes": [
    {
      "arquivo": "caminho/relativo/do/arquivo.cs",
      "comentario": "descrição clara e objetiva do problema ou melhoria",
      "severidade": "critico"
    }
  ],
  "comentario_geral": "## 🤖 Revisão Automática\\n\\n### 📋 Resumo\\n...\\n\\n### ⚠️ Riscos\\n...\\n\\n### 🏗️ Violações de Boas Práticas\\n...\\n\\n### 💡 Sugestões\\n...\\n\\n### Conclusão\\n...\\n\\n---\\n*Análise gerada automaticamente via CLI local.*"
}

Valores aceitos em \`severidade\`: "critico", "aviso", "sugestao".
Use arrays vazios se não houver riscos ou sugestões.
O campo \`comentario_geral\` deve ser markdown completo para postar no GitLab, incluindo uma seção "🏗️ Violações de Boas Práticas" quando houver violações das regras acima.`;

// ─── Export principal ─────────────────────────────────────────────────────────

export async function analyzeMergeRequest(
  provider: AIProvider,
  projectType: ProjectType,
  mr: MergeRequest,
  changes: FileChange[],
): Promise<ClaudeAnalysis> {
  const prompt    = projectType === 'api'
    ? buildPromptDotNet(mr, changes)
    : buildPromptFront(mr, changes);
  const rawOutput = await runCLI(provider, prompt);
  const jsonText  = extractJSON(rawOutput);

  try {
    return JSON.parse(jsonText) as ClaudeAnalysis;
  } catch {
    throw new Error(
      `Não foi possível interpretar a resposta como JSON.\n` +
      `Trecho recebido:\n${jsonText.slice(0, 400)}`,
    );
  }
}
