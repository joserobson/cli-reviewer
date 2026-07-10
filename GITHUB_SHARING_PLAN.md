# Plano para Compartilhamento no GitHub

## Objetivo

Preparar o `mr-reviewer` para ser compartilhado no GitHub com onboarding claro, configuracao segura, validacao automatizada e documentacao suficiente para outros desenvolvedores clonarem, configurarem e rodarem o projeto sem depender de contexto externo.

## Plano Recomendado

### 1. Limpar e proteger arquivos sensiveis

- Garantir que `.env`, `.llm-usage.json`, `.watcher-state.json` e estados locais estejam no `.gitignore`.
- Revisar se nenhum token, URL interna, ID sensivel ou credencial ficou em documentacao, testes ou exemplos.
- Manter apenas `.env.example` com valores ficticios e seguros.

### 2. Melhorar onboarding

- Atualizar `README.md` com visao geral, requisitos, instalacao, configuracao, comandos principais e troubleshooting.
- Manter `README.pt-BR.md` sincronizado com a versao em ingles.
- Preservar `AGENTS.md` como guia para contribuidores e agentes.

### 3. Padronizar configuracao

- Revisar `.env.example` para cobrir todas as variaveis usadas pelo codigo.
- Adicionar comentarios curtos explicando cada variavel.
- Melhorar mensagens de erro quando configuracoes obrigatorias estiverem ausentes.

### 4. Adicionar qualidade automatizada

- Garantir os scripts principais no `package.json`:
  - `npm test`: executa a suite de testes.
  - `npm run typecheck`: executa `tsc --noEmit`.
  - Opcional: `npm run lint`.
- Manter o fluxo minimo funcionando: `npm install`, configurar `.env` e rodar `npm test`.

### 5. Preparar contribuicao externa

- Criar `CONTRIBUTING.md` com instalacao, configuracao, testes, padrao de commit e fluxo de Pull Request.
- Criar `SECURITY.md` explicando como reportar vulnerabilidades e reforcando que tokens nao devem ser commitados.
- Adicionar uma licenca, como `MIT`, se a intencao for permitir uso e contribuicao ampla.

### 6. Adicionar templates do GitHub

- Criar `.github/pull_request_template.md`.
- Criar `.github/ISSUE_TEMPLATE/bug_report.md`.
- Criar `.github/ISSUE_TEMPLATE/feature_request.md`.
- Adicionar `.github/workflows/ci.yml` rodando `npm ci`, `npm test` e `npm run typecheck`.

### 7. Melhorar experiencia de desenvolvimento

- Documentar erros comuns:
  - Claude ou Gemini CLI nao instalado/autenticado.
  - Token do GitLab invalido.
  - `GITLAB_PROJECTS` mal configurado.
  - Watcher sem notificacoes.
- Garantir que o projeto falhe com mensagens acionaveis quando configuracoes essenciais estiverem faltando.

## Opcoes de Implementacao

### Opcao A: Preparacao minima

Boa para compartilhar rapidamente.

Inclui:

- Revisar `.gitignore`.
- Ajustar `.env.example`.
- Melhorar `README.md` e `README.pt-BR.md`.
- Adicionar `CONTRIBUTING.md`.
- Adicionar licenca.

### Opcao B: Preparacao profissional recomendada

Melhor equilibrio entre qualidade e esforco.

Inclui tudo da Opcao A, mais:

- `SECURITY.md`.
- Templates de Pull Request e issues.
- Script `typecheck`.
- GitHub Actions CI.
- Revisao das mensagens de erro de configuracao.

### Opcao C: Open source mais completo

Indicada se o projeto for divulgado para uso publico mais amplo.

Inclui tudo da Opcao B, mais:

- ESLint e Prettier.
- `CHANGELOG.md`.
- Badges no README.
- Versionamento semantico.
- Documentacao mais detalhada de arquitetura.
- Exemplos avancados de configuracao.
- Possivel publicacao futura como pacote CLI no npm.

## Recomendacao

Seguir a **Opcao B**. Ela melhora bastante a experiencia de novos desenvolvedores sem adicionar burocracia excessiva. Depois que o projeto tiver uso externo real, a Opcao C pode ser implementada de forma incremental.
