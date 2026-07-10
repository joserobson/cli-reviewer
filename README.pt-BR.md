# MR Reviewer

> Revisor de Merge Requests do GitLab com IA — roda completamente na sua máquina usando CLIs locais de IA.

**[Read in English](README.md)**

---

## O que faz

O MR Reviewer conecta ao seu GitLab, busca os Merge Requests abertos, envia o diff para uma CLI de IA local (Codex, Gemini ou Claude Code) e devolve uma revisão de código estruturada em segundos. Funciona em dois modos:

- **CLI interativo** — você escolhe os MRs manualmente, revisa os resultados e aprova/comenta/faz merge direto do terminal.
- **Watcher** — roda em segundo plano, detecta novos MRs automaticamente, posta a revisão como comentário no GitLab e envia uma notificação no desktop.

Como executa a CLI local configurada, os dados da revisão ficam na sua máquina, exceto pelas chamadas necessárias à API do GitLab para buscar diffs e postar comentários.

---

## Funcionalidades

- Analisa projetos Angular/TypeScript, .NET C# ou qualquer stack (modo genérico) com regras específicas por tecnologia
- Detecta padrões problemáticos: `setTimeout` em componentes, queries N+1, `async void`, manipulação direta do DOM e muito mais
- Sugestões classificadas por severidade: **crítico / aviso / sugestão**
- Análise paralela de múltiplos MRs simultaneamente
- Posta automaticamente a revisão completa como comentário formatado no GitLab
- Seletor inteligente de LLM: rastreia o uso estimado de tokens por mês e roteia automaticamente para o provider com maior capacidade restante
- Reset mensal automático; limites configuráveis por provider

---

## Pré-requisitos

| Requisito | Observação |
|---|---|
| Node.js ≥ 18 | `node --version` |
| Codex CLI | Provider opcional; deve estar instalado e autenticado se habilitado |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | Provider opcional; deve estar instalado e autenticado se habilitado |
| Claude Code / Claude CLI | Provider opcional; deve estar instalado e autenticado se habilitado |
| Personal Access Token do GitLab | Escopo: `api` |
| Notificações desktop (só Watcher) | Windows nativo · macOS nativo · Linux: `sudo apt install libnotify-bin` |

Você precisa de apenas uma CLI de IA habilitada. Ter múltiplos providers ativa o seletor inteligente.

---

## Instalação

```bash
git clone https://github.com/seu-usuario/mr-reviewer.git
cd mr-reviewer
npm install
cp .env.example .env
# Edite o .env com suas credenciais do GitLab
npm test
npm run typecheck
```

No PowerShell, use `Copy-Item .env.example .env` no lugar de `cp`, se necessario.

---

## Configuração

Edite o `.env`:

```env
GITLAB_URL=https://seu-gitlab.exemplo.com
GITLAB_TOKEN=glpat-xxxxxxxxxxxxxxxxxxxx

# Um ou mais projetos — formato: id:tipo:label (separados por vírgula)
# Tipos suportados: front (Angular), api (.NET C#), generic (qualquer linguagem)
GITLAB_PROJECTS=133:front:Frontend Angular,134:api:API .NET

# Habilite uma ou mais CLIs locais de IA
CODEX_ENABLED=true
GEMINI_ENABLED=true
CODE_ENABLED=false

# Opcional: personalizar comandos CLI
# CODEX_CMD=codex
# CODEX_ARGS=exec -
# GEMINI_CMD=gemini
# GEMINI_ARGS=--yolo
# CODE_CMD=claude
# CODE_ARGS=--print

# Configurações do watcher
WATCH_INTERVAL_MINUTES=2
WATCH_CODEX_MONTHLY_TOKENS=0
WATCH_GEMINI_MONTHLY_TOKENS=0
WATCH_CODE_MONTHLY_TOKENS=0
```

IDs de projeto aceitam formatos numérico (`133`) e baseado em caminho (`grupo/projeto`).

---

## Como usar

### CLI Interativo

```bash
npm run review
```

Fluxo:
1. Seleciona o projeto (Angular ou API .NET)
2. Seleciona o provider de IA (Codex, Gemini ou Claude Code)
3. Escolhe um ou mais MRs abertos
4. Revisa a análise no terminal
5. Escolhe uma ação: aprovar / postar comentário / fazer merge / pular

### Watcher (monitor em segundo plano)

```bash
npm run watch
```

O watcher faz polling no GitLab a cada `WATCH_INTERVAL_MINUTES` minutos. Quando um novo MR é aberto:

1. Envia uma notificação no desktop
2. Busca o diff e executa a análise automaticamente
3. Posta a revisão como comentário no MR
4. Registra estatísticas de uso no terminal

Na primeira execução, os MRs já abertos são marcados como "já vistos" e não são re-analisados.

---

## Seleção Inteligente de LLM

O uso é rastreado em `.llm-usage.json` (no gitignore, reset automático mensal).

| Cenário | Comportamento |
|---|---|
| Um ou mais limites configurados | Escolhe o provider habilitado com maior **% de capacidade restante** |
| Um provider esgotado | Faz fallback automático para outro provider habilitado |
| Sem limites configurados | Round-robin por contagem de requisições |

Estimativa de tokens: `caracteres / 4` — aproximação padrão da indústria, suficiente para controle de orçamento.

---

## Arquitetura

```
src/
├── index.ts          # CLI interativo — prompts, controle de fluxo, ações
├── watcher.ts        # Monitor em background — polling, notificações, auto-post
├── ai.ts             # Spawna CLIs de IA habilitadas, constrói prompts, parseia JSON
├── gitlab.ts         # Wrapper da GitLab API v4
├── projects.ts       # Loader de configuração de projetos (lê GITLAB_PROJECTS)
├── usage-tracker.ts  # Rastreamento de tokens + seleção inteligente de provider
├── display.ts        # Saída no terminal — banner, spinners, formatação da análise
└── types.ts          # Interfaces TypeScript compartilhadas
```

**Fluxo de dados (CLI):**
```
Validação de env → Seleção de projeto/provider → Lista MRs → Seleciona MRs
    → Busca diffs (paralelo) → Spawna CLI de IA → Parseia JSON → Exibe
    → Executa ação (aprovar / comentar / merge)
```

**Fluxo de dados (Watcher):**
```
Poll GitLab → Novo MR detectado → Estima tokens → Seleciona provider
    → Busca diff → Spawna CLI de IA → Parseia JSON → Posta comentário → Notifica
```

---

## Endpoints GitLab utilizados

| Método | Endpoint | Finalidade |
|---|---|---|
| GET | `/merge_requests?state=opened` | Listar MRs abertos |
| GET | `/merge_requests/:iid/changes` | Buscar diff |
| POST | `/merge_requests/:iid/approve` | Aprovar |
| POST | `/merge_requests/:iid/notes` | Postar comentário |
| PUT | `/merge_requests/:iid/merge` | Fazer merge |

---

## Verificação de tipos

```bash
npm run typecheck
```

Nenhum passo de build necessário — o `tsx` executa TypeScript diretamente.

## Desenvolvimento e contribuição

Antes de abrir um Pull Request, rode:

```bash
npm test
npm run typecheck
```

Veja `CONTRIBUTING.md` para o fluxo de contribuição e `SECURITY.md` para tratamento de segredos e reporte de vulnerabilidades. O GitHub Actions executa a mesma validação nos Pull Requests.

## Solução de problemas

| Problema | Verifique |
|---|---|
| Configuração do GitLab ausente | Copie `.env.example` para `.env` e defina `GITLAB_URL`, `GITLAB_TOKEN` e `GITLAB_PROJECTS` |
| Nenhum provider de IA disponível | Habilite pelo menos um entre `CODEX_ENABLED`, `GEMINI_ENABLED` ou `CODE_ENABLED` |
| Comando da IA não encontrado | Instale/autentique a CLI ou sobrescreva `*_CMD` e `*_ARGS` no `.env` |
| Watcher não posta comentários | Confirme escopo `api` do token, IDs de projeto e permissões no GitLab |

---

## Licença

MIT
