# Backlog de Publicacao e Setup

## Objetivo

Deixar o MR Reviewer pronto para ser publicado no GitHub e configurado por outros desenvolvedores com um fluxo guiado de primeira execucao.

## Etapa 1: Criar e conectar o repositorio GitHub

### 1.1 Criar o repositorio remoto

- Criar um repositorio no GitHub, por exemplo `mr-reviewer`.
- Definir visibilidade: privado inicialmente, publico quando a documentacao estiver revisada.
- Confirmar que o repositorio nao foi criado com README, `.gitignore` ou licenca para evitar conflitos com o historico local.

### 1.2 Configurar o remote local

```bash
git remote add origin git@github.com:<owner>/mr-reviewer.git
git remote -v
```

### 1.3 Enviar o primeiro push

```bash
git push -u origin master
```

Se o repositorio usar `main`, renomear a branch antes:

```bash
git branch -M main
git push -u origin main
```

**Concluido quando:** o repositorio GitHub exibir o codigo, README, licenca, templates e workflow de CI.

## Etapa 2: Criar comando de setup inicial

### 2.1 Definir script principal

Adicionar um comando:

```bash
npm run setup
```

Esse comando deve executar um script TypeScript, por exemplo `src/setup.ts`, usando `tsx`.

### 2.2 Detectar requisitos locais

O setup deve verificar:

- versao do Node.js (`>=18`);
- existencia de `.env`;
- instalacao do Codex CLI;
- instalacao do Gemini CLI;
- instalacao do Claude Code/Claude CLI;
- disponibilidade de comandos configurados em `CODEX_CMD`, `GEMINI_CMD` e `CODE_CMD`, quando existirem.

### 2.3 Exibir resultado claro

Exemplo de saida esperada:

```text
Node.js: OK v20.11.0
Codex CLI: encontrado
Gemini CLI: nao encontrado
Claude Code: encontrado
.env: nao encontrado
```

**Concluido quando:** `npm run setup` mostra quais dependencias existem, quais faltam e como corrigir.

## Etapa 3: Gerar `.env` assistido

### 3.1 Perguntar onde o projeto vai rodar

O setup deve comecar perguntando o ambiente de uso:

```text
Onde voce pretende rodar o MR Reviewer?

1. Localmente na minha maquina
   Melhor para uso individual. O app roda quando voce abrir o terminal.
   Pode usar o modo interativo ou o watcher por polling.

2. Em um servidor/VPS
   Melhor para automacao continua. O app fica ligado e pode receber eventos do GitLab por webhook.
   Recomendado para times ou uso automatico em segundo plano.
```

Com base na resposta, o setup deve sugerir o caminho:

- **Local:** configurar `npm run review` e opcionalmente `npm run watch`.
- **Servidor/VPS:** configurar modo automatico, porta HTTP, segredo de webhook e instrucoes para registrar o webhook no GitLab.

### 3.2 Criar `.env` a partir do exemplo

Se `.env` nao existir, oferecer criar a partir de `.env.example`.

### 3.3 Guiar configuracao obrigatoria

Perguntar ou orientar o usuario sobre:

- `GITLAB_URL`;
- `GITLAB_TOKEN`;
- `GITLAB_PROJECTS`;
- providers habilitados: `CODEX_ENABLED`, `GEMINI_ENABLED`, `CODE_ENABLED`;
- limites mensais de tokens, se desejar usar controle de uso.

### 3.4 Configurar modo automatico quando fizer sentido

Se o usuario escolher servidor/VPS, sugerir:

```env
AUTO_REVIEW_ENABLED=true
AUTO_REVIEW_MODE=webhook
WEBHOOK_PORT=3333
WEBHOOK_SECRET=change-me
AUTO_REVIEW_POST_COMMENT=true
AUTO_REVIEW_NOTIFY_DESKTOP=false
AUTO_REVIEW_SKIP_DRAFT=true
AUTO_REVIEW_APPROVE_ON_SUCCESS=false
AUTO_REVIEW_MERGE_ON_SUCCESS=false
```

Se o usuario escolher local, sugerir:

```env
AUTO_REVIEW_ENABLED=false
AUTO_REVIEW_MODE=polling
WATCH_INTERVAL_MINUTES=2
AUTO_REVIEW_NOTIFY_DESKTOP=true
```

Explicacao simples para o setup mostrar:

- **Modo manual:** voce escolhe os MRs e decide se aprova, comenta ou faz merge.
- **Modo polling:** o app verifica o GitLab a cada intervalo configurado e analisa MRs novos.
- **Modo webhook:** o GitLab chama o app quando um MR muda; e mais rapido e indicado para servidor/VPS.

### 3.5 Evitar sobrescrever configuracao existente

Se `.env` ja existir, o setup deve:

- nao sobrescrever automaticamente;
- mostrar variaveis ausentes;
- sugerir ajustes sem revelar tokens no terminal.

**Concluido quando:** um novo desenvolvedor consegue criar uma configuracao inicial sem editar tudo manualmente.

## Etapa 4: Validar configuracao antes de rodar

### 4.1 Criar comando de diagnostico

Adicionar:

```bash
npm run doctor
```

O comando deve validar:

- `.env` existe;
- `GITLAB_URL` e `GITLAB_TOKEN` existem;
- `GITLAB_PROJECTS` possui ao menos um projeto valido;
- ao menos um provider de IA esta habilitado;
- comandos dos providers habilitados existem no PATH.
- se `AUTO_REVIEW_MODE=webhook`, `WEBHOOK_SECRET` e `WEBHOOK_PORT` estao configurados;
- se `AUTO_REVIEW_MODE=polling`, `WATCH_INTERVAL_MINUTES` e valido.

### 4.2 Separar setup de diagnostico

- `npm run setup`: fluxo guiado para primeira configuracao.
- `npm run doctor`: validacao rapida para descobrir problemas.

**Concluido quando:** problemas comuns aparecem como mensagens acionaveis antes do usuario executar `npm run review` ou `npm run watch`.

## Etapa 5: Melhorar documentacao do fluxo inicial

### 5.1 Atualizar READMEs

Adicionar uma secao "First-time setup" explicando os dois caminhos:

**Uso local:**

```bash
npm install
npm run setup
npm run doctor
npm run review
```

**Servidor/VPS:**

```bash
npm install
npm run setup
npm run doctor
npm run webhook
```

Tambem explicar quando usar cada modo:

- local/manual para revisoes sob demanda;
- local/polling para uso individual com automacao simples;
- servidor/webhook para automacao continua e resposta quase em tempo real.

### 5.2 Atualizar documentacao de troubleshooting

Incluir correcoes para:

- comando de IA nao encontrado;
- token GitLab invalido;
- projeto GitLab sem permissao;
- `.env` ausente;
- provider habilitado mas nao instalado.

**Concluido quando:** README em ingles e portugues descrevem o mesmo fluxo de primeira execucao.

## Etapa 6: Testar o fluxo completo em uma maquina limpa

### 6.1 Simular instalacao nova

Executar em uma copia limpa do repositorio:

```bash
npm ci
npm run setup
npm run doctor
npm test
npm run typecheck
```

### 6.2 Validar comportamento com providers ausentes

Testar cenarios:

- nenhum provider instalado;
- apenas Codex instalado;
- apenas Gemini instalado;
- apenas Claude Code instalado;
- provider habilitado no `.env`, mas comando ausente no PATH.

**Concluido quando:** o projeto orienta o usuario corretamente em todos os cenarios principais.

## Etapa 7: Publicar e revisar CI no GitHub

### 7.1 Conferir GitHub Actions

- Confirmar que o workflow `CI` executa no primeiro push.
- Corrigir eventuais falhas de `npm ci`, testes ou typecheck.

### 7.2 Revisar pagina inicial do repositorio

- Conferir renderizacao do README no GitHub.
- Confirmar que links para `CONTRIBUTING.md`, `SECURITY.md` e `LICENSE` funcionam.
- Definir descricao e topicos do repositorio.

**Concluido quando:** o repositorio esta publicado, CI verde e pronto para receber outro desenvolvedor.

## Etapa 8: Formalizar modo automatico por polling

### 8.1 Adicionar configuracoes explicitas

```env
AUTO_REVIEW_ENABLED=false
AUTO_REVIEW_MODE=polling
AUTO_REVIEW_POST_COMMENT=true
AUTO_REVIEW_NOTIFY_DESKTOP=true
AUTO_REVIEW_SKIP_DRAFT=true
AUTO_REVIEW_APPROVE_ON_SUCCESS=false
AUTO_REVIEW_MERGE_ON_SUCCESS=false
```

### 8.2 Aplicar comportamento seguro por padrao

- Nao aprovar automaticamente por padrao.
- Nao fazer merge automaticamente por padrao.
- Ignorar Draft MRs por padrao.
- Evitar comentarios duplicados usando estado local.

**Concluido quando:** `npm run watch` respeita as configuracoes de modo automatico e documenta claramente o que sera executado.

## Etapa 9: Adicionar modo automatico via GitLab Webhook

### 9.1 Criar servidor HTTP para webhooks

Adicionar comando:

```bash
npm run webhook
```

Esse comando deve iniciar um servidor local, por exemplo `src/webhook-server.ts`.

### 9.2 Receber eventos de Merge Request

Endpoint:

```text
POST /webhooks/gitlab
```

Processar eventos de MR:

- `open`;
- `reopen`;
- `update`.

Ignorar eventos de fechamento/merge e Draft MRs conforme configuracao.

### 9.3 Validar seguranca do webhook

Validar o header:

```text
X-Gitlab-Token
```

Comparar com `WEBHOOK_SECRET`. Se invalido, retornar `401` e nao executar analise.

### 9.4 Evitar reviews duplicados

Registrar eventos processados por:

- project id;
- MR iid;
- commit SHA ou `updated_at`.

### 9.5 Reutilizar logica existente

Extrair uma funcao compartilhada para analise e comentario, usada por:

- `watcher.ts`;
- `webhook-server.ts`.

### 9.6 Documentar configuracao no GitLab

Explicar no README:

1. Acessar `Settings > Webhooks` no projeto GitLab.
2. Informar a URL `https://seu-dominio.com/webhooks/gitlab`.
3. Informar o secret token.
4. Marcar eventos de Merge Request.
5. Salvar e testar.

### 9.7 Suporte local com tunel

Para teste local:

```bash
npm run webhook
cloudflared tunnel --url http://localhost:3333
```

Ou:

```bash
ngrok http 3333
```

**Concluido quando:** um evento real do GitLab dispara review automatico via webhook, valida o segredo e nao duplica comentarios.

## Etapa 10: Suportar GitHub Pull Requests alem de GitLab Merge Requests

### 10.1 Configurar repositorios GitHub

Adicionar suporte a:

```env
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
GITHUB_REPOSITORIES=owner/repo:generic:CLI Reviewer,org/api:api:Backend
```

`GITHUB_TOKEN` deve ser opcional para leitura de Pull Requests publicos, mas obrigatorio para comentar, aprovar ou fazer merge.

### 10.2 Criar camada comum de plataforma

Extrair as operacoes usadas pelo revisor para uma camada comum:

- listar reviews abertos;
- buscar arquivos/diff;
- postar comentario;
- aprovar;
- fazer merge.

GitLab e GitHub devem implementar essa camada sem duplicar a logica de IA.

### 10.3 Adaptar CLI interativo e watcher

O modo manual e o watcher devem aceitar projetos GitLab e GitHub na mesma configuracao, exibindo MR ou PR conforme a plataforma.

### 10.4 Adicionar webhook GitHub

Adicionar endpoint:

```text
POST /webhooks/github
```

Processar eventos `pull_request` nas acoes:

- `opened`;
- `reopened`;
- `synchronize`;
- `ready_for_review`.

Validar `X-Hub-Signature-256` quando `GITHUB_WEBHOOK_SECRET` estiver configurado e deduplicar por repositorio, numero do PR e `head.sha`.

### 10.5 Atualizar setup, doctor e documentacao

O setup deve perguntar quais plataformas configurar. O doctor deve validar repositorios GitHub, token e webhook secret sem revelar segredos. READMEs e `.env.example` devem documentar GitLab e GitHub.

**Concluido quando:** a ferramenta revisa GitLab Merge Requests e GitHub Pull Requests no modo manual, watcher e webhook, mantendo defaults seguros.

## Prioridade Recomendada

1. Criar repositorio GitHub e configurar `origin`.
2. Implementar `npm run doctor`.
3. Implementar `npm run setup`.
4. Adicionar pergunta local vs servidor/VPS no setup.
5. Formalizar modo automatico por polling.
6. Adicionar modo webhook para servidor/VPS.
7. Adicionar suporte GitHub Pull Requests.
8. Atualizar READMEs com o fluxo novo.
9. Testar em ambiente limpo.
10. Fazer push e validar CI.
