# Especificação: evolução da camada de IA, fallback e observabilidade

## Metadados

- **Status:** proposta — aguardando aprovação
- **Data:** 2026-07-25
- **Versão:** 1.0
- **Produto:** CLI Reviewer
- **Inspiração:** capacidades de roteamento e observabilidade do 9router
- **Natureza:** evolução incremental, sem dependência obrigatória do 9router

## 1. Resumo executivo

O CLI Reviewer já executa o ciclo completo de revisão de Merge Requests e Pull
Requests: recebe eventos ou faz polling, busca o diff, seleciona uma CLI de IA,
produz uma análise estruturada e pode comentar, aprovar ou iniciar o merge no
GitLab/GitHub.

A camada de IA, porém, ainda está acoplada às CLIs Codex, Gemini e Claude Code.
Ela escolhe apenas um provider antes de cada análise, estima o consumo por
caracteres e encerra a revisão caso o provider escolhido falhe. O histórico
operacional também não registra as tentativas individuais, o modelo efetivo,
a latência e o motivo de um fallback.

Esta especificação propõe:

1. criar uma interface comum para providers de IA;
2. adicionar um adapter HTTP compatível com a API OpenAI;
3. permitir cadeias explícitas de fallback;
4. registrar consumo e tentativas com dados reais quando disponíveis;
5. ampliar o dashboard com indicadores de confiabilidade e custo;
6. preparar uma evolução posterior da persistência JSON para SQLite.

O 9router poderá ser usado por meio do adapter OpenAI-compatible, mas o mesmo
contrato deverá aceitar outros gateways ou APIs compatíveis. O CLI Reviewer
continuará responsável pelo domínio de revisão; autenticação OAuth, catálogo de
modelos, tradução de protocolos e balanceamento entre contas continuarão fora
do seu escopo.

## 2. Contexto atual

### 2.1 Capacidades existentes

- providers locais fixos: `codex`, `gemini` e `code`;
- execução das CLIs por subprocesso;
- prompts específicos para projetos `front`, `api` e `generic`;
- seleção por porcentagem estimada de capacidade mensal;
- round-robin por quantidade de requisições quando não há limites;
- modos interativo, polling e webhook;
- suporte a GitLab e GitHub;
- comentário, aprovação e merge controlados por flags independentes;
- idempotência de eventos de webhook;
- callback de resultado para o Agent Hub;
- histórico de reviews e uso armazenado em arquivos JSON;
- dashboard local com resultados das reviews e tokens estimados.

### 2.2 Limitações observadas

1. `AIProvider` é uma união fixa e cada nova integração exige alterar o núcleo.
2. O provider é escolhido uma única vez; não existe fallback após falha real.
3. Não há timeout central padronizado para todas as execuções.
4. Falhas de autenticação, quota, rede, processo, parsing e modelo não possuem
   categorias comuns.
5. O consumo considera `caracteres / 4` e não separa entrada e saída.
6. O histórico registra somente o provider final e não a sequência de tentativas.
7. Os arquivos JSON não oferecem boa concorrência, consultas ou retenção para
   um volume maior de reviews.
8. O dashboard não mostra taxa de sucesso por provider, latência, fallback ou
   incidência de respostas inválidas.

## 3. Objetivos

### 3.1 Objetivos funcionais

- Desacoplar a análise de MR/PR da forma como cada IA é executada.
- Manter as CLIs atuais funcionando sem alteração obrigatória de configuração.
- Permitir um endpoint OpenAI-compatible configurável.
- Permitir uma cadeia ordenada de providers por ambiente.
- Continuar a revisão automaticamente quando um provider estiver indisponível.
- Expor qual provider e modelo produziram o resultado final.
- Registrar cada tentativa e seu resultado operacional.
- Usar tokens reais retornados pelo provider quando disponíveis.
- Preservar os controles atuais de comentário, aprovação e merge.

### 3.2 Objetivos não funcionais

- Compatibilidade retroativa com a configuração atual.
- Ausência de dependência direta do pacote ou código-fonte do 9router.
- Falhas isoladas: indisponibilidade de um provider não deve derrubar o servidor.
- Segredos nunca devem aparecer em logs, callbacks, dashboard ou histórico.
- Testes determinísticos sem chamar APIs ou CLIs reais.
- Extensibilidade para novos adapters sem alterar a automação de revisão.
- Observabilidade suficiente para comparar confiabilidade, latência e consumo.

## 4. Fora de escopo

Esta evolução não deverá:

- implementar OAuth de providers;
- manter catálogo próprio de dezenas de modelos;
- traduzir protocolos Anthropic, Gemini, Cursor ou outros;
- gerenciar múltiplas contas do mesmo provider;
- duplicar combos, quotas e circuit breakers que já pertençam a um gateway;
- transformar o CLI Reviewer em proxy público de IA;
- substituir os prompts especializados de code review por prompts genéricos;
- habilitar compressão de diffs ou resultados por padrão;
- fazer comentário, aprovação ou merge com regras diferentes das atuais;
- expor o dashboard sem autenticação diretamente na internet;
- remover a execução local por Codex, Gemini ou Claude Code.

## 5. Princípios de produto e arquitetura

1. **Revisão primeiro:** qualidade e rastreabilidade da review têm precedência
   sobre economia de tokens.
2. **Gateway opcional:** 9router é uma alternativa de infraestrutura, não um
   requisito para executar o CLI Reviewer.
3. **Configuração explícita:** a ordem de fallback não pode ser inferida a partir
   de marketing, preço ou suposta gratuidade de modelos.
4. **Compatibilidade:** sem uma cadeia nova configurada, o seletor atual continua
   determinando o provider.
5. **Responsabilidade única:** o gateway escolhe conta/modelo interno; o reviewer
   escolhe quando tentar outro adapter.
6. **Fail closed para ações SCM:** uma falha de IA nunca pode ser interpretada
   como aprovação recomendada.
7. **Fail open controlado para providers:** uma tentativa pode seguir para o
   próximo provider, mas todas as falhas devem permanecer auditáveis.
8. **Sem nova chamada após análise válida:** se a análise foi concluída e apenas
   o comentário no GitLab/GitHub falhou, não se executa outro modelo.

## 6. Arquitetura proposta

### 6.1 Fluxo

```text
GitLab/GitHub
    |
    v
Watcher / Webhook / CLI interativo
    |
    v
Review Orchestrator
    |
    +--> Provider Router
            |
            +--> CLI Adapter: Codex
            +--> CLI Adapter: Gemini
            +--> CLI Adapter: Claude Code
            +--> HTTP Adapter: OpenAI-compatible
                         |
                         +--> 9router ou outro endpoint compatível
    |
    v
Análise estruturada e validada
    |
    +--> comentário / aprovação / merge
    +--> histórico / dashboard
    +--> callback Agent Hub
```

### 6.2 Contratos conceituais

Os nomes finais podem ser ajustados na implementação, mas as responsabilidades
devem permanecer equivalentes:

```ts
interface AIProviderAdapter {
  id: string;
  label: string;
  isEnabled(): boolean;
  analyze(request: AIAnalysisRequest): Promise<AIAnalysisResult>;
}

interface AIAnalysisRequest {
  projectType: ProjectType;
  mergeRequest: MergeRequest;
  changes: FileChange[];
  prompt: string;
  timeoutMs: number;
}

interface AIAnalysisResult {
  analysis: ClaudeAnalysis;
  providerId: string;
  model?: string;
  usage: TokenUsage;
  durationMs: number;
  rawRequestId?: string;
}

interface TokenUsage {
  source: 'provider' | 'cli' | 'estimated';
  inputTokens?: number;
  outputTokens?: number;
  totalTokens: number;
}
```

O tipo `ClaudeAnalysis` deverá ser renomeado para um nome neutro, por exemplo
`CodeReviewAnalysis`, mantendo a mesma estrutura JSON e compatibilidade interna
durante a migração.

### 6.3 Responsabilidades do Provider Router

- receber a cadeia configurada ou usar o seletor legado;
- ignorar adapters desabilitados;
- consultar limites locais conhecidos antes da tentativa;
- aplicar timeout;
- executar uma tentativa por provider, salvo retry técnico explicitamente
  configurado;
- classificar erros;
- registrar cada tentativa;
- retornar a primeira análise válida;
- lançar um erro agregado quando todos falharem;
- nunca executar ações no GitLab/GitHub.

## 7. Configuração proposta

### 7.1 Compatibilidade

As variáveis existentes continuarão válidas:

```env
CODEX_ENABLED=true
GEMINI_ENABLED=true
CODE_ENABLED=false
WATCH_CODEX_MONTHLY_TOKENS=0
WATCH_GEMINI_MONTHLY_TOKENS=0
WATCH_CODE_MONTHLY_TOKENS=0
```

### 7.2 Novas variáveis

```env
# Vazio = usa o seletor atual.
# Configurado = tenta os adapters na ordem declarada.
AI_PROVIDER_CHAIN=

# Timeout comum de cada tentativa.
AI_PROVIDER_TIMEOUT_MS=180000

# Endpoint genérico compatível com OpenAI.
OPENAI_COMPATIBLE_ENABLED=false
OPENAI_COMPATIBLE_LABEL=9router
OPENAI_COMPATIBLE_BASE_URL=http://9router:20128/v1
OPENAI_COMPATIBLE_API_KEY=
OPENAI_COMPATIBLE_MODEL=review-quality

# Retry do mesmo adapter. MVP permanece 0 para evitar custo duplicado.
AI_PROVIDER_RETRY_COUNT=0
```

Exemplos:

```env
# Mantém as CLIs como primeira opção e usa o gateway como contingência.
AI_PROVIDER_CHAIN=codex,openai-compatible,gemini,code

# Centraliza todo o roteamento de modelos no gateway.
AI_PROVIDER_CHAIN=openai-compatible
```

### 7.3 Regras de validação

O `npm run doctor` deverá:

- rejeitar IDs desconhecidos na cadeia;
- informar adapters configurados na cadeia, porém desabilitados;
- validar URL absoluta e modelo do adapter HTTP;
- exigir API key quando o endpoint estiver configurado para usá-la;
- fazer apenas uma verificação segura de conectividade, sem enviar diff;
- ocultar tokens e chaves em todas as mensagens;
- alertar sobre HTTP sem TLS quando o host não for local ou rede privada;
- informar claramente se o seletor legado ou a cadeia explícita está ativa.

O `npm run setup` poderá oferecer o adapter OpenAI-compatible, mas deverá
permanecer opcional.

## 8. Regras de fallback

### 8.1 Categorias de falha

| Categoria | Exemplos | Tentar próximo provider |
|---|---|---:|
| `unavailable` | processo não encontrado, conexão recusada | sim |
| `timeout` | CLI ou HTTP excedeu o limite | sim |
| `rate_limit` | HTTP 429 ou quota identificada | sim |
| `provider_server` | HTTP 5xx | sim |
| `authentication` | HTTP 401/403 | sim, sem retry no mesmo provider |
| `invalid_response` | JSON ausente ou schema inválido | sim |
| `context_limit` | diff excede contexto do modelo | sim |
| `configuration` | URL/modelo/argumento inválido | sim, registrando erro permanente |
| `cancelled` | encerramento solicitado pelo processo | não |
| `scm` | falha ao buscar diff ou postar comentário | não se aplica ao router |

### 8.2 Regras adicionais

- A cadeia é percorrida no máximo uma vez no MVP.
- Um provider não pode aparecer duas vezes na cadeia.
- O erro final deve resumir todas as tentativas sem incluir payloads sensíveis.
- Uma resposta só é considerada válida após parsing e validação do schema.
- Resposta parcial ou texto que não forme a análise esperada é falha.
- Quota local esgotada permite pular a tentativa, mas deve gerar registro.
- O provider final deve ser usado no histórico e callback.
- Aprovação automática só pode ocorrer após análise válida e com
  `aprovacao_recomendada=true`.

### 8.3 Relação com combos do gateway

Quando o adapter OpenAI-compatible apontar para o 9router, o valor de
`OPENAI_COMPATIBLE_MODEL` poderá ser um modelo ou combo configurado no gateway.
O CLI Reviewer deverá tratar esse valor como opaco.

Exemplo:

```text
AI_PROVIDER_CHAIN=codex,openai-compatible
OPENAI_COMPATIBLE_MODEL=review-quality

review-quality no gateway:
  Claude -> modelo econômico -> modelo gratuito
```

O reviewer enxerga duas tentativas possíveis (`codex` e
`openai-compatible`). As tentativas internas do combo pertencem ao gateway e
somente serão exibidas se o gateway devolvê-las como metadados seguros.

## 9. Adapter OpenAI-compatible

### 9.1 Requisitos do MVP

- usar `POST {baseUrl}/chat/completions`;
- enviar requisição não streaming;
- enviar o prompt especializado já produzido pelo reviewer;
- solicitar o modelo configurado;
- aceitar conteúdo textual contendo o JSON da análise;
- aproveitar `usage.prompt_tokens`, `usage.completion_tokens` e
  `usage.total_tokens` quando retornados;
- capturar o ID da resposta quando disponível;
- respeitar `AbortSignal` e timeout;
- limitar o tamanho do corpo de erro armazenado;
- não persistir headers, API key, prompt completo ou resposta bruta por padrão.

### 9.2 Compatibilidade e tolerância

- `response_format` poderá ser usado apenas quando explicitamente suportado.
- A ausência de `usage` não deverá invalidar uma resposta correta.
- Sem `usage`, o reviewer continuará usando estimativa e marcará a origem.
- Campos extras retornados pelo gateway serão ignorados.
- A URL base deve aceitar configuração com ou sem `/v1`, normalizada de forma
  determinística e coberta por testes.

## 10. Uso, histórico e observabilidade

### 10.1 Modelo de tentativa

Cada review deverá poder registrar:

```ts
interface ProviderAttempt {
  providerId: string;
  providerLabel: string;
  model?: string;
  startedAt: string;
  durationMs: number;
  outcome: 'success' | 'failed' | 'skipped';
  errorCategory?: ProviderErrorCategory;
  errorMessage?: string;
  usage?: TokenUsage;
}
```

### 10.2 Campos da review

O evento final deverá incluir, de forma retrocompatível:

- provider final;
- modelo final, quando conhecido;
- tokens de entrada, saída e total;
- origem da medição;
- duração total;
- quantidade de tentativas;
- indicador de fallback;
- lista resumida de tentativas;
- status e ações SCM já existentes.

### 10.3 Ordem de confiança para tokens

1. dados retornados pela API;
2. dados estruturados retornados pela CLI, quando disponíveis;
3. estimativa atual por caracteres.

Estimativas e valores reais não podem ser somados como se tivessem a mesma
precisão sem indicar a origem.

### 10.4 Dashboard

O dashboard deverá acrescentar:

- taxa de sucesso por provider;
- quantidade e percentual de reviews com fallback;
- latência média e percentil 95 por provider;
- falhas por categoria;
- tokens reais versus estimados;
- consumo de entrada e saída;
- modelos mais utilizados;
- provider/modelo final de cada review;
- sequência de tentativas ao abrir o detalhe de uma review.

O dashboard continuará local e sem exposição pública por padrão. Autenticação
do dashboard é uma iniciativa separada e obrigatória antes de qualquer
exposição externa.

## 11. Persistência

### 11.1 Fase inicial

Na primeira entrega, os arquivos JSON poderão ser mantidos para reduzir o risco
da refatoração. O schema deverá ser versionado e continuar lendo registros
antigos que não possuam os novos campos.

### 11.2 Evolução para SQLite

SQLite será uma segunda iniciativa, executada após a camada de providers estar
estável. A migração deverá contemplar:

- tabelas separadas para reviews, tentativas e uso;
- transações para escrita concorrente;
- índices por data, projeto, plataforma, provider, modelo e status;
- retenção configurável;
- backup antes da primeira migração;
- importação idempotente dos JSON existentes;
- rollback documentado;
- dashboard lendo de uma interface de repositório, não diretamente do banco.

### 11.3 Gatilhos para priorizar SQLite

SQLite deverá subir de prioridade se ocorrer um dos seguintes:

- corrupção ou perda recorrente de JSON;
- execução concorrente de dashboard, watcher e webhook causando disputa;
- necessidade de filtros e relatórios que exijam carregar todo o histórico;
- volume de eventos que torne perceptível o custo de leitura e regravação;
- necessidade de retenção e auditoria operacional no VPS.

## 12. Segurança e privacidade

- API keys somente por variável de ambiente ou secret de deploy.
- Nenhum segredo poderá ser incluído em imagem Docker.
- Logs devem mascarar headers `Authorization` e valores semelhantes.
- Prompt completo e resposta bruta ficam desabilitados por padrão.
- Diffs não podem ser enviados a endpoints não configurados explicitamente.
- O `doctor` deve alertar que um gateway externo receberá o código do MR/PR.
- O adapter deve seguir redirects apenas de forma segura e limitada.
- Mensagens de erro persistidas devem ter limite de tamanho.
- Callbacks ao Agent Hub devem receber metadados resumidos, não o diff.
- A configuração deve permitir desabilitar o adapter HTTP imediatamente.

## 13. Compressão de contexto

Compressão inspirada no RTK/Headroom não integra o MVP.

Antes de qualquer adoção, deverá existir uma avaliação separada que:

- compare reviews com e sem compressão usando os mesmos diffs;
- meça perda de linhas, contexto e referências de arquivo;
- avalie falsos negativos de segurança e regressão;
- preserve o diff original para auditoria;
- mantenha a compressão desligada por padrão;
- permita opt-out por review;
- impeça compressão quando o resultado for maior ou houver erro.

Sem evidência de equivalência da análise, a economia de tokens não justifica
alterar o conteúdo do diff enviado ao modelo.

## 14. Compatibilidade com o Agent Hub

O callback atual deverá permanecer aceito. Novos campos serão opcionais:

```ts
interface AgentHubReviewResult {
  // campos atuais...
  provider?: string;
  model?: string;
  fallbackUsed?: boolean;
  attemptsCount?: number;
  durationMs?: number;
  tokenUsage?: TokenUsage;
}
```

Regras:

- a ausência de suporte do Agent Hub aos campos novos não bloqueia a review;
- contratos devem ser evoluídos de forma aditiva;
- `running`, `completed`, `failed` e `skipped` mantêm a semântica atual;
- falha de todos os providers resulta em `failed`, nunca `skipped`;
- erro agregado enviado ao Agent Hub deve ser sanitizado.

## 15. Plano de entrega

### Entrega 1 — fundação e compatibilidade

- extrair construção de prompt da execução do provider;
- introduzir `AIProviderAdapter`;
- adaptar Codex, Gemini e Claude Code;
- renomear gradualmente `ClaudeAnalysis`;
- manter seletor e comportamento atuais;
- criar erros normalizados e timeout comum;
- adicionar testes unitários dos adapters CLI.

### Entrega 2 — endpoint OpenAI-compatible

- implementar adapter HTTP;
- adicionar configuração, setup e doctor;
- suportar tokens reais da resposta;
- documentar exemplo com 9router sem torná-lo obrigatório;
- criar servidor HTTP falso nos testes;
- atualizar README em inglês e português.

### Entrega 3 — cadeia de fallback

- implementar `AI_PROVIDER_CHAIN`;
- classificar falhas;
- produzir erro agregado;
- preservar ações SCM fora do retry;
- registrar tentativas;
- ampliar callback do Agent Hub de forma aditiva.

### Entrega 4 — observabilidade

- versionar schema do histórico;
- exibir métricas e tentativas no dashboard;
- diferenciar tokens reais e estimados;
- adicionar métricas de latência, falha e fallback;
- definir retenção mínima dos dados sensíveis.

### Entrega 5 — decisão e migração de persistência

- medir necessidade real de SQLite;
- aprovar desenho de dados e migração;
- implementar repositório abstrato;
- importar JSON;
- validar concorrência, backup e rollback.

### Entrega futura — avaliação de compressão

- criar corpus de diffs;
- executar comparação de qualidade;
- decidir se a compressão será descartada, experimental ou suportada.

Cada entrega deverá ser revisável e implantável isoladamente. A aprovação desta
spec não implica executar todas as entregas em um único PR.

## 16. Critérios de aceite

### 16.1 Compatibilidade

- [ ] Configuração atual continua funcionando sem novas variáveis.
- [ ] Codex, Gemini e Claude Code mantêm o mesmo resultado estruturado.
- [ ] Os modos interativo, polling e webhook usam a mesma camada de providers.
- [ ] Comentário, aprovação, merge, idempotência e callback não regredem.

### 16.2 Adapter HTTP

- [ ] Um endpoint OpenAI-compatible pode executar uma review completa.
- [ ] O modelo é configurável.
- [ ] Timeout e cancelamento encerram a tentativa.
- [ ] HTTP 401, 403, 429 e 5xx são classificados corretamente.
- [ ] Tokens reais são registrados quando retornados.
- [ ] Sem campo `usage`, a review usa estimativa identificada como tal.
- [ ] Nenhuma API key aparece em logs, erros ou arquivos de histórico.

### 16.3 Fallback

- [ ] A ordem configurada é respeitada.
- [ ] Provider desabilitado ou sem capacidade é ignorado com registro.
- [ ] Falha transitória tenta o próximo provider.
- [ ] JSON inválido tenta o próximo provider.
- [ ] A primeira análise válida encerra a cadeia.
- [ ] Todos os providers falhando produzem um erro agregado sanitizado.
- [ ] Falha ao postar comentário não dispara nova análise.
- [ ] Aprovação automática nunca ocorre sem análise válida.

### 16.4 Observabilidade

- [ ] Cada tentativa registra provider, duração, resultado e categoria de erro.
- [ ] Histórico informa provider e modelo finais.
- [ ] Dashboard diferencia tokens reais e estimados.
- [ ] Dashboard mostra fallback, taxa de sucesso e latência por provider.
- [ ] Registros antigos continuam legíveis.

### 16.5 Qualidade

- [ ] `npm test` passa.
- [ ] `npm run typecheck` passa.
- [ ] Novos testes não chamam serviços externos.
- [ ] `.env.example`, `README.md` e `README.pt-BR.md` permanecem sincronizados.
- [ ] `npm run doctor` valida a nova configuração sem revelar segredos.

## 17. Estratégia de testes

### Testes unitários

- registro e resolução de adapters;
- parser de cadeia;
- seleção legada versus cadeia explícita;
- classificação de erros;
- timeout e cancelamento;
- normalização da URL OpenAI-compatible;
- parsing de resposta e validação da análise;
- prioridade entre usage real, usage da CLI e estimativa;
- sanitização de erros e segredos;
- leitura de histórico antigo.

### Testes de integração local

- servidor HTTP falso retornando sucesso;
- respostas 401, 403, 429, 500 e timeout;
- resposta válida sem `usage`;
- resposta com JSON inválido;
- primeiro provider falha e segundo conclui;
- todos os providers falham;
- análise conclui e postagem SCM falha sem nova tentativa;
- callback do Agent Hub com e sem os campos novos.

### Testes de regressão

- provider único pelo seletor atual;
- prompts `front`, `api` e `generic`;
- webhook GitLab e GitHub;
- deduplicação e retry de evento falho;
- defaults seguros de aprovação e merge;
- dashboard com histórico legado.

## 18. Riscos e mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| Custo duplicado por fallback | alto | sem retry no mesmo provider no MVP; registrar tentativas |
| Dois modelos produzirem análises diferentes | médio | primeira análise válida vence; manter auditoria |
| Endpoint externo receber código sensível | alto | opt-in, alerta no doctor e segredo por ambiente |
| Fallback mascarar configuração inválida | médio | registrar categoria permanente e doctor falhar |
| JSON crescer com tentativas | médio | schema versionado e futura migração SQLite |
| Acoplamento ao 9router | médio | contrato OpenAI-compatible genérico |
| Compressão omitir evidência do diff | alto | fora do MVP e desligada por padrão |
| Mudança quebrar Agent Hub | alto | campos apenas aditivos |
| Timeout longo bloquear webhook | médio | timeout por tentativa e limite de cadeia |

## 19. Decisões propostas para aprovação

1. **Manter o seletor atual como padrão.** A cadeia explícita só entra em ação
   quando `AI_PROVIDER_CHAIN` estiver configurada.
2. **Adapter genérico.** Usar o nome `openai-compatible`, evitando criar um
   adapter exclusivo chamado `9router`.
3. **Sem retry do mesmo provider no MVP.** O fallback percorre a cadeia uma vez.
4. **Sem compressão no MVP.** Qualquer token saver exige estudo de qualidade.
5. **JSON na primeira fase.** SQLite será avaliado depois da estabilização do
   roteamento e da observabilidade.
6. **Combo pertence ao gateway.** O reviewer envia um nome de modelo/combo opaco
   e não replica a cadeia interna do 9router.
7. **Sem exposição pública do dashboard.** Autenticação será especificada antes
   de qualquer publicação externa.
8. **Entregas separadas.** Fundação, adapter HTTP, fallback, observabilidade e
   persistência devem ser PRs independentes.

## 20. Pendências de aprovação

Antes da implementação, confirmar:

- [ ] aprovação do escopo e dos itens fora de escopo;
- [ ] aprovação das oito decisões da seção anterior;
- [ ] nome final das variáveis de ambiente;
- [ ] ordem desejada para o primeiro ambiente que usará a cadeia;
- [ ] modelo ou combo inicial configurado no gateway;
- [ ] se a Entrega 1 poderá começar após a aprovação desta versão;
- [ ] se cada entrega exigirá uma spec complementar de implementação.

Enquanto o status deste documento for **proposta — aguardando aprovação**, não
deverá haver alteração no código de produção com base nesta especificação.
