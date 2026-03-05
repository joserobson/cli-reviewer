# MR Reviewer

> Revisor de Merge Requests do GitLab com IA — roda completamente na sua máquina, sem custos de API em nuvem.

**[Read in English](README.md)**

---

## O que faz

O MR Reviewer conecta ao seu GitLab, busca os Merge Requests abertos, envia o diff para uma CLI de IA local (Claude ou Gemini) e devolve uma revisão de código estruturada em segundos. Funciona em dois modos:

- **CLI interativo** — você escolhe os MRs manualmente, revisa os resultados e aprova/comenta/faz merge direto do terminal.
- **Watcher** — roda em segundo plano, detecta novos MRs automaticamente, posta a revisão como comentário no GitLab e envia uma notificação no desktop Windows.

Como executa `claude --print` ou `gemini --yolo` localmente, você não paga nada além da sua assinatura existente.

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
| [Claude CLI](https://claude.ai/download) | Deve estar autenticado (`claude --print` funciona) |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | Deve estar autenticado (`gemini --yolo` funciona) |
| Personal Access Token do GitLab | Escopo: `api` |
| Notificações desktop (só Watcher) | Windows nativo · macOS nativo · Linux: `sudo apt install libnotify-bin` |

Você precisa de apenas uma das CLIs de IA; ter as duas ativa o seletor inteligente.

---

## Instalação

```bash
git clone https://github.com/seu-usuario/mr-reviewer.git
cd mr-reviewer
npm install
cp .env.example .env
# Edite o .env com suas credenciais do GitLab
```

---

## Configuração

Edite o `.env`:

```env
GITLAB_URL=https://seu-gitlab.exemplo.com
GITLAB_TOKEN=glpat-xxxxxxxxxxxxxxxxxxxx

# Um ou mais projetos — formato: id:tipo:label (separados por vírgula)
# Tipos suportados: front (Angular), api (.NET C#), generic (qualquer linguagem)
GITLAB_PROJECTS=133:front:Frontend Angular,134:api:API .NET

# Opcional: personalizar comandos CLI (padrões mostrados)
# CLAUDE_CMD=claude
# CLAUDE_ARGS=--print
# GEMINI_CMD=gemini
# GEMINI_ARGS=--yolo

# Configurações do watcher
WATCH_INTERVAL_MINUTES=2
WATCH_CLAUDE_MONTHLY_TOKENS=7000000
WATCH_GEMINI_MONTHLY_TOKENS=1500000
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
2. Seleciona o provider de IA (Claude ou Gemini)
3. Escolhe um ou mais MRs abertos
4. Revisa a análise no terminal
5. Escolhe uma ação: aprovar / postar comentário / fazer merge / pular

### Watcher (monitor em segundo plano)

```bash
npm run watch
```

O watcher faz polling no GitLab a cada `WATCH_INTERVAL_MINUTES` minutos. Quando um novo MR é aberto:

1. Envia uma notificação no desktop Windows
2. Busca o diff e executa a análise automaticamente
3. Posta a revisão como comentário no MR
4. Registra estatísticas de uso no terminal

Na primeira execução, os MRs já abertos são marcados como "já vistos" e não são re-analisados.

---

## Seleção Inteligente de LLM

O uso é rastreado em `.llm-usage.json` (no gitignore, reset automático mensal).

| Cenário | Comportamento |
|---|---|
| Ambos os limites configurados | Escolhe o provider com maior **% de capacidade restante** |
| Um provider esgotado | Faz fallback automático para o outro |
| Sem limites configurados | Round-robin por contagem de requisições |

Estimativa de tokens: `caracteres / 4` — aproximação padrão da indústria, suficiente para controle de orçamento.

---

## Arquitetura

```
src/
├── index.ts          # CLI interativo — prompts, controle de fluxo, ações
├── watcher.ts        # Monitor em background — polling, notificações, auto-post
├── ai.ts             # Spawna claude/gemini, constrói prompts, parseia JSON
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
npx tsc --noEmit
```

Nenhum passo de build necessário — o `tsx` executa TypeScript diretamente.

---

## Licença

MIT
