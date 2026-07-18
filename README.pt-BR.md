# CLI Reviewer

> Revisor de Merge Requests do GitLab e Pull Requests do GitHub com IA — roda completamente na sua máquina usando CLIs locais de IA.

**[Read in English](README.md)**

---

## O que faz

O CLI Reviewer conecta ao GitLab e ao GitHub, busca Merge Requests ou Pull Requests abertos, envia o diff para uma CLI de IA local (Codex, Gemini ou Claude Code) e devolve uma revisão de código estruturada em segundos. Funciona em três modos:

- **CLI interativo** — você escolhe os MRs manualmente, revisa os resultados e aprova/comenta/faz merge direto do terminal.
- **Watcher** — faz polling em segundo plano, detecta novos MRs/PRs automaticamente, posta a revisão como comentário na plataforma e envia uma notificação no desktop.
- **Servidor de webhook** — recebe eventos de Merge Request do GitLab e Pull Request do GitHub para automação quase em tempo real em servidor/VPS.

Como executa a CLI local configurada, os dados da revisão ficam na sua máquina, exceto pelas chamadas necessárias às APIs do GitLab/GitHub para buscar diffs e postar comentários.

---

## Funcionalidades

- Analisa projetos Angular/TypeScript, .NET C# ou qualquer stack (modo genérico) com regras específicas por tecnologia
- Detecta padrões problemáticos: `setTimeout` em componentes, queries N+1, `async void`, manipulação direta do DOM e muito mais
- Sugestões classificadas por severidade: **crítico / aviso / sugestão**
- Análise paralela de múltiplos MRs simultaneamente
- Posta automaticamente a revisão completa como comentário formatado no GitLab/GitHub
- Seletor inteligente de LLM: rastreia o uso estimado de tokens por mês e roteia automaticamente para o provider com maior capacidade restante
- Reset mensal automático; limites configuráveis por provider
- Dashboard web local com histórico de revisões, contagens por status e consumo estimado de tokens

---

## Pré-requisitos

| Requisito | Observação |
|---|---|
| Node.js ≥ 18 | `node --version` |
| Codex CLI | Provider opcional; deve estar instalado e autenticado se habilitado |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | Provider opcional; deve estar instalado e autenticado se habilitado |
| Claude Code / Claude CLI | Provider opcional; deve estar instalado e autenticado se habilitado |
| Personal Access Token do GitLab | Escopo: `api` |
| Token do GitHub | Opcional para ler PRs públicos; necessário para comentar, aprovar ou fazer merge |
| Notificações desktop (só Watcher) | Windows nativo · macOS nativo · Linux: `sudo apt install libnotify-bin` |

Você precisa de apenas uma CLI de IA habilitada. Ter múltiplos providers ativa o seletor inteligente.

---

## Instalação

```bash
git clone https://github.com/seu-usuario/mr-reviewer.git
cd mr-reviewer
npm install
cp .env.example .env
# Edite o .env com suas credenciais do GitLab/GitHub
npm run doctor
npm test
npm run typecheck
```

No PowerShell, use `Copy-Item .env.example .env` no lugar de `cp`, se necessario.

---

## Setup inicial

Para configuração guiada, rode:

```bash
npm run setup
npm run doctor
```

Escolha **local** para revisões sob demanda ou automação simples por polling na sua máquina. Escolha **servidor/VPS** para automação contínua com webhooks do GitLab/GitHub.

`npm run doctor` valida Node.js, `.env`, configuração do GitLab/GitHub, projetos configurados, providers habilitados, comandos das CLIs e as opções específicas de polling/webhook.

---

## Configuração

Edite o `.env`:

```env
GITLAB_URL=https://seu-gitlab.exemplo.com
GITLAB_TOKEN=glpat-xxxxxxxxxxxxxxxxxxxx
GITHUB_TOKEN=github_pat_xxxxxxxxxxxxxxxxxxxx
GITHUB_API_URL=https://api.github.com

# Um ou mais projetos/repositórios — formato: id:tipo:label (separados por vírgula)
# Tipos suportados: front (Angular), api (.NET C#), generic (qualquer linguagem)
GITLAB_PROJECTS=133:front:Frontend Angular,134:api:API .NET
GITHUB_REPOSITORIES=owner/repo:generic:CLI Reviewer

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

# Configurações de revisão automática
AUTO_REVIEW_ENABLED=false
AUTO_REVIEW_MODE=polling
AUTO_REVIEW_POST_COMMENT=true
AUTO_REVIEW_NOTIFY_DESKTOP=true
AUTO_REVIEW_SKIP_DRAFT=true
AUTO_REVIEW_APPROVE_ON_SUCCESS=false
AUTO_REVIEW_MERGE_ON_SUCCESS=false
WATCH_INTERVAL_MINUTES=2
DASHBOARD_PORT=3334
WEBHOOK_PORT=3333
WEBHOOK_SECRET=change-me
GITHUB_WEBHOOK_SECRET=change-me
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

O watcher faz polling no GitLab/GitHub a cada `WATCH_INTERVAL_MINUTES` minutos. Quando um novo MR/PR é aberto:

1. Envia uma notificação no desktop
2. Busca o diff e executa a análise automaticamente
3. Posta a revisão como comentário no MR
4. Registra estatísticas de uso no terminal

Na primeira execução, os MRs já abertos são marcados como "já vistos" e não são re-analisados.

O watcher respeita as flags `AUTO_REVIEW_*`. Por padrão ele ignora Draft MRs, posta comentários, envia notificações desktop e **não** aprova nem faz merge automaticamente.
Defina `AUTO_REVIEW_ENABLED=true` para permitir que `npm run watch` analise e poste automaticamente; quando estiver `false`, novos MRs são detectados e registrados sem revisão automática.

### Servidor de webhook

```bash
npm run webhook
```

Configure `AUTO_REVIEW_ENABLED=true`, `AUTO_REVIEW_MODE=webhook`, `WEBHOOK_PORT` e `WEBHOOK_SECRET`. No GitLab, acesse `Settings > Webhooks`, informe `https://seu-dominio.com/webhooks/gitlab`, use o mesmo secret token e marque os eventos de Merge Request. No GitHub, informe `https://seu-dominio.com/webhooks/github`, configure `GITHUB_WEBHOOK_SECRET` e marque eventos de Pull request.

Para testar localmente, exponha a porta com um túnel:

```bash
cloudflared tunnel --url http://localhost:3333
# ou
ngrok http 3333
```

### Imagem do container

Pushes em `main` e tags de versão publicam `ghcr.io/joserobson/cli-reviewer`. A imagem contém as dependências Node e o Codex CLI, executa a aplicação com o usuário sem privilégios `reviewer` e expõe o webhook na porta `3333`.

Execute-a fornecendo a configuração GitLab em tempo de execução:

```bash
docker run --rm -p 3333:3333 \
  -e GITLAB_URL=https://gitlab.exemplo.com \
  -e GITLAB_PROJECTS=grupo/projeto:generic:Projeto \
  -e GITLAB_TOKEN \
  -e WEBHOOK_SECRET \
  -e AGENT_HUB_CALLBACK_URL=http://agent-hub-api:8080/api/webhooks/reviews \
  -e AGENT_HUB_CALLBACK_SECRET \
  -e AUTO_REVIEW_MODE=webhook \
  -e AUTO_REVIEW_ENABLED=true \
  -e AUTO_REVIEW_POST_COMMENT=true \
  -e AUTO_REVIEW_APPROVE_ON_SUCCESS=false \
  -e AUTO_REVIEW_MERGE_ON_SUCCESS=false \
  -v cli-reviewer-codex:/home/reviewer/.codex \
  -v cli-reviewer-state:/var/lib/cli-reviewer \
  ghcr.io/joserobson/cli-reviewer:latest
```

Em servidor sem interface grafica, autentique uma vez o volume dedicado do Codex com `codex login --device-auth`. `CODEX_HOME` aponta para `/home/reviewer/.codex`; nunca inclua `auth.json`, tokens GitLab ou segredos de webhook na imagem.

Quando o Agent Hub encaminha o webhook, ele envia `X-AgentHub-Review-Task-Id`. O reviewer reporta `running`, `completed`, `failed` ou `skipped` para `AGENT_HUB_CALLBACK_URL/{taskId}/result`, autenticado por `AGENT_HUB_CALLBACK_SECRET`. O volume `cli-reviewer-state` preserva idempotencia, historico de revisoes e uso entre recriacoes do container. Revisoes com falha ficam liberadas para retry, enquanto processamentos com mais de 30 minutos sao considerados abandonados.

### Dashboard

```bash
npm run dashboard
```

Abra `http://localhost:3334/dashboard` para acompanhar histórico de revisões, contagens de aprovado/revisão necessária, comentários/ações executadas e uso estimado de tokens por provider. O painel lê o estado local de `.review-dashboard.json` e `.llm-usage.json`; ambos ficam fora do Git.

No deploy da VPS pelo Compose do Agent Hub, o dashboard roda como serviço separado, compartilha o estado das revisões em modo somente leitura e escuta apenas em `127.0.0.1:3334`. Acesse-o por túnel SSH; não exponha esse endpoint sem autenticação diretamente na internet.

---

## Seleção Inteligente de LLM

O uso é rastreado em `.llm-usage.json` (no gitignore, reset automático mensal).
O histórico de revisões usado pelo dashboard é rastreado em `.review-dashboard.json` (também no gitignore).

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
├── webhook-server.ts # Servidor HTTP para webhooks do GitLab/GitHub
├── dashboard.ts      # Dashboard web local para revisões e uso de tokens
├── setup.ts          # Criação guiada do .env inicial
├── doctor.ts         # Diagnóstico local antes de rodar o revisor
├── automation.ts     # Comportamento compartilhado de revisão automática
├── ai.ts             # Spawna CLIs de IA habilitadas, constrói prompts, parseia JSON
├── gitlab.ts         # Wrapper da GitLab API v4
├── github.ts         # Wrapper da REST API do GitHub
├── scm.ts            # Roteador de plataforma para operacoes GitLab/GitHub
├── projects.ts       # Loader de configuração de projetos
├── usage-tracker.ts  # Rastreamento de tokens + seleção inteligente de provider
├── review-store.ts   # Historico local de revisões para métricas do dashboard
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
Poll GitLab/GitHub → Novo MR/PR detectado → Estima tokens → Seleciona provider
    → Busca diff → Spawna CLI de IA → Parseia JSON → Posta comentário → Notifica
```

---

## Endpoints de plataforma utilizados

| Método | Endpoint | Finalidade |
|---|---|---|
| GET | GitLab `/merge_requests?state=opened` / GitHub `/pulls?state=open` | Listar reviews abertas |
| GET | GitLab `/merge_requests/:iid/changes` / GitHub `/pulls/:number/files` | Buscar diff |
| POST | GitLab `/merge_requests/:iid/approve` / GitHub `/pulls/:number/reviews` | Aprovar |
| POST | GitLab `/merge_requests/:iid/notes` / GitHub `/issues/:number/comments` | Postar comentário |
| PUT | GitLab `/merge_requests/:iid/merge` / GitHub `/pulls/:number/merge` | Fazer merge |

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
| Configuração do GitHub ausente | Defina `GITHUB_REPOSITORIES`; defina `GITHUB_TOKEN` para comentários, aprovações ou merge |
| Nenhum provider de IA disponível | Habilite pelo menos um entre `CODEX_ENABLED`, `GEMINI_ENABLED` ou `CODE_ENABLED` |
| Comando da IA não encontrado | Instale/autentique a CLI ou sobrescreva `*_CMD` e `*_ARGS` no `.env` |
| Provider habilitado mas não instalado | Rode `npm run doctor` e instale a CLI ou desative `CODEX_ENABLED`, `GEMINI_ENABLED` ou `CODE_ENABLED` |
| Token GitLab inválido | Confirme que o token tem escopo `api` e não expirou |
| Projeto GitLab sem permissão | Confirme que o usuário do token pode ler MRs e postar notas em cada entrada de `GITLAB_PROJECTS` |
| Repositório GitHub sem permissão | Confirme que o token pode ler PRs e escrever reviews/comentários |
| Watcher não posta comentários | Confirme escopo `api` do token, IDs de projeto e permissões no GitLab |
| Webhook retorna 401 | Confirme que o token do GitLab é igual ao `WEBHOOK_SECRET` ou que a assinatura GitHub usa `GITHUB_WEBHOOK_SECRET` |

---

## Licença

MIT
