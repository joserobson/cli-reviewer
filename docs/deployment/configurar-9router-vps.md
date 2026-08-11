# Configurar o 9router na VPS do Agent Hub e CLI Reviewer

> **Fase posterior:** não comece por este guia. Primeiro conclua o
> [piloto isolado do 9router](testar-9router-isolado-vps.md), executado em um
> Compose próprio e sem alterar Agent Hub, Reviewer, OpenClaw ou Nginx Proxy
> Manager. Use este documento somente depois que o gate do piloto for aprovado.

> A ordem aprovada é: manter o Compose isolado, conectar esse mesmo Compose à
> rede do Nginx Proxy Manager, expor a API em HTTPS e testar o OpenClaw. Migrar
> o serviço para `docker-compose.vps.yml` ou integrar Reviewer/Agent Hub é uma
> decisão posterior, não um requisito do teste com OpenClaw. A seção 2 abaixo
> descreve a arquitetura consolidada futura e não deve ser executada durante o
> piloto.

## Objetivo

Este guia descreve como executar o 9router como um gateway compartilhado na
mesma VPS do `agent-hub-api` e do `cli-reviewer`, publicado com HTTPS pelo
Nginx Proxy Manager.

A topologia esperada é:

```text
Internet
   |
   +--> https://ai.example.com
             |
             v
      Nginx Proxy Manager
             |
             v
        9router:20128
             |
             +--> providers e combos configurados no 9router

Agent Hub API
   |
   +--> cli-reviewer:3333
   |
   +--> 9router:20128/v1

Administrador
   |
   +--> https://ai.example.com/dashboard
   |
   +--> túnel SSH de emergência --> 127.0.0.1:20128
```

O 9router não deve substituir o Agent Hub nem o CLI Reviewer. Ele funciona como
gateway opcional para modelos de IA.

Um dos objetivos deste deploy é permitir que o runtime OpenClaw use esse
gateway sem depender do OpenRouter. Isso não significa que toda assinatura de
produto possa ser convertida em API: cada provider possui regras próprias de
autenticação e uso por aplicações de terceiros.

## Estado da integração

Existem duas formas de integração, com níveis diferentes de suporte:

1. **Integração transitória disponível hoje:** configurar o Codex CLI executado
   pelo Reviewer para usar o endpoint do 9router.
2. **Integração nativa planejada:** o Reviewer chamará diretamente um endpoint
   OpenAI-compatible e terá fallback e métricas por tentativa. Essa capacidade
   ainda depende da implementação da
   [spec de evolução dos providers](../specifications/2026-07-25-evolucao-providers-fallback-observabilidade.md).

Não adicione as variáveis `OPENAI_COMPATIBLE_*` ao ambiente atual esperando que
o Reviewer já as interprete. Elas fazem parte da proposta, não do código
implantado neste momento.

## Pré-requisitos

- acesso SSH à VPS;
- Docker Engine e Docker Compose v2;
- acesso ao diretório que contém `docker-compose.vps.yml`;
- `agent-hub-api` e `cli-reviewer` já executando pelo mesmo Compose;
- Nginx Proxy Manager funcionando na VPS;
- domínio ou subdomínio apontando para o IP público da VPS;
- portas públicas `80` e `443` chegando ao Nginx Proxy Manager;
- porta `20128` livre no host;
- capacidade de atualizar os secrets usados pelo deploy;
- um provider ou combo a ser configurado no dashboard do 9router;
- acesso ao arquivo de configuração do runtime OpenClaw, caso ele vá consumir o
  gateway;
- uma credencial suportada por cada provider usado pelo OpenClaw.

## Decisões de segurança

Para este ambiente:

- o tráfego público deve entrar somente pelo Nginx Proxy Manager em HTTPS;
- a porta de origem `20128` deve continuar vinculada a `127.0.0.1`;
- a API deve exigir uma chave criada no 9router;
- o dashboard deve exigir login e cookie seguro;
- cada aplicação ou pessoa deve receber uma API key independente;
- request logs devem permanecer desabilitados por padrão, pois podem conter
  código-fonte e prompts;
- a imagem deve ser fixada em uma versão validada antes de produção;
- os dados devem ficar em volume persistente;
- cada consumidor deve usar uma API key própria;
- RTK, Headroom ou outra compressão deve permanecer desabilitada para reviews
  até existir validação de qualidade.

Não publique diretamente a porta `20128` em `0.0.0.0`. O fato de a aplicação
ser acessível por domínio não elimina a necessidade das API keys.

## 1. Preparar os secrets

No diretório do Compose, adicione estas variáveis ao mecanismo de secrets do
deploy ou ao `.env` da VPS:

```env
# Fixe a tag ou digest que foi validado no ambiente.
# Use :latest somente no primeiro teste controlado.
NINE_ROUTER_IMAGE=decolua/9router:<VERSAO_VALIDADA>
NINE_ROUTER_PUBLIC_URL=https://ai.example.com

NINE_ROUTER_JWT_SECRET=<SEGREDO_ALEATORIO_FORTE>
NINE_ROUTER_INITIAL_PASSWORD=<SENHA_INICIAL_FORTE>
NINE_ROUTER_API_KEY_SECRET=<SEGREDO_ALEATORIO_FORTE>
NINE_ROUTER_MACHINE_ID_SALT=<SEGREDO_ALEATORIO_FORTE>
```

Para gerar valores independentes:

```bash
openssl rand -hex 32
```

Execute o comando novamente para cada secret. Não reutilize o
`REVIEW_WEBHOOK_SECRET`, tokens do GitLab/GitHub ou secrets do Agent Hub.

O `NINE_ROUTER_INITIAL_PASSWORD` serve para o primeiro acesso ao dashboard.
Depois de confirmar o login, altere a senha no próprio 9router.

## 2. Adicionar o serviço ao Compose

O `docker-compose.vps.yml` que já orquestra o Agent Hub e o Reviewer é a fonte
de verdade deste deploy. Adicione o serviço abaixo em `services`:

```yaml
services:
  # Serviços agent-hub-api e cli-reviewer já existentes...

  9router:
    image: ${NINE_ROUTER_IMAGE}
    restart: unless-stopped
    ports:
      - "127.0.0.1:20128:20128"
    environment:
      DATA_DIR: /app/data
      PORT: "20128"
      HOSTNAME: "0.0.0.0"
      NODE_ENV: production

      JWT_SECRET: ${NINE_ROUTER_JWT_SECRET}
      INITIAL_PASSWORD: ${NINE_ROUTER_INITIAL_PASSWORD}
      API_KEY_SECRET: ${NINE_ROUTER_API_KEY_SECRET}
      MACHINE_ID_SALT: ${NINE_ROUTER_MACHINE_ID_SALT}

      REQUIRE_API_KEY: "true"
      ENABLE_REQUEST_LOGS: "false"
      OBSERVABILITY_ENABLED: "true"
      AUTH_COOKIE_SECURE: "true"

      BASE_URL: http://127.0.0.1:20128
      NEXT_PUBLIC_BASE_URL: ${NINE_ROUTER_PUBLIC_URL}
    volumes:
      - 9router-data:/app/data
    healthcheck:
      test:
        - CMD
        - node
        - -e
        - >-
          fetch('http://127.0.0.1:20128/api/health')
          .then(r => { if (!r.ok) process.exit(1) })
          .catch(() => process.exit(1))
      interval: 30s
      timeout: 10s
      retries: 5
      start_period: 30s
    networks:
      - default
      - npm-proxy

volumes:
  # Volumes já existentes...
  9router-data:
    name: 9router-data

networks:
  default:
  npm-proxy:
    external: true
```

### Rede Docker

O `9router` precisa participar de duas redes:

- a rede do Agent Hub/Reviewer, chamada `default` no exemplo;
- a rede externa compartilhada com o Nginx Proxy Manager, chamada `npm-proxy`.

Se a rede principal do Agent Hub tiver outro nome, substitua `default` pelo nome
declarado no Compose.

Dentro dos containers, o endereço será:

```text
http://9router:20128
```

Não use `localhost` ou `127.0.0.1` de dentro do `cli-reviewer` ou
`agent-hub-api`: esses endereços apontariam para o próprio container consumidor.

### Rede compartilhada com o Nginx Proxy Manager

Crie a rede externa uma única vez:

```bash
docker network create npm-proxy
```

No Compose do Nginx Proxy Manager, conecte o serviço principal, normalmente
chamado `app`, à mesma rede:

```yaml
services:
  app:
    # Configuração atual do Nginx Proxy Manager...
    networks:
      - default
      - npm-proxy

networks:
  default:
  npm-proxy:
    external: true
```

Recrie o Nginx Proxy Manager somente depois de validar o Compose dele. Não use
`docker network connect` como configuração permanente, pois a ligação manual
pode se perder quando o container for recriado.

### Sobre `AUTH_COOKIE_SECURE`

Como o dashboard será publicado por HTTPS, mantenha
`AUTH_COOKIE_SECURE=true`.

Use:

- `BASE_URL=http://127.0.0.1:20128` para callbacks internos do próprio serviço;
- `NEXT_PUBLIC_BASE_URL=https://ai.example.com` para a URL vista pelo navegador.

Nenhuma das duas URLs deve terminar em `/v1`.

Se o certificado ou o proxy ainda não estiverem prontos, faça o primeiro acesso
por túnel SSH antes de ativar o domínio. Não reduza permanentemente a proteção
do cookie para contornar um proxy configurado incorretamente.

## 3. Validar e subir somente o 9router

Antes de alterar containers em execução:

```bash
docker compose -f docker-compose.vps.yml config --quiet
```

Baixe e inicie o serviço:

```bash
docker compose -f docker-compose.vps.yml pull 9router
docker compose -f docker-compose.vps.yml up -d 9router
```

Confira o estado:

```bash
docker compose -f docker-compose.vps.yml ps 9router
docker compose -f docker-compose.vps.yml logs --tail=100 9router
```

Valide pelo host da VPS:

```bash
curl --fail http://127.0.0.1:20128/api/health
```

Resposta atual esperada:

```json
{"ok":true}
```

O endpoint correto da versão atual é `/api/health`. Algumas páginas antigas da
documentação upstream ainda mostram `/health`.

## 4. Validar a rede a partir do Reviewer

O container do Reviewer inclui Node.js. Use-o para confirmar DNS e acesso pela
rede interna:

```bash
docker compose -f docker-compose.vps.yml exec cli-reviewer \
  node -e "fetch('http://9router:20128/api/health').then(async r => { console.log(r.status, await r.text()); if (!r.ok) process.exit(1) }).catch(e => { console.error(e); process.exit(1) })"
```

O resultado deve conter status `200` e `{"ok":true}`.

Se o DNS `9router` não resolver, confirme se os três serviços pertencem à mesma
rede:

```bash
docker compose -f docker-compose.vps.yml ps
docker inspect \
  "$(docker compose -f docker-compose.vps.yml ps -q 9router)" \
  --format '{{json .NetworkSettings.Networks}}'
```

O uso de `docker compose ... ps -q` resolve o ID correto mesmo quando o Compose
adiciona um prefixo ao nome físico do container.

## 5. Criar o Proxy Host no Nginx Proxy Manager

No painel do Nginx Proxy Manager, abra **Hosts > Proxy Hosts > Add Proxy Host**.

### Details

Preencha:

| Campo | Valor |
|---|---|
| Domain Names | `ai.example.com` |
| Scheme | `http` |
| Forward Hostname / IP | `9router` |
| Forward Port | `20128` |
| Cache Assets | desabilitado |
| Block Common Exploits | habilitado |
| Websockets Support | habilitado |
| Access List | `Publicly Accessible` |

Substitua `ai.example.com` pelo domínio definido em
`NINE_ROUTER_PUBLIC_URL`.

O Proxy Host deve encaminhar para o nome DNS Docker `9router`, não para
`127.0.0.1`. Isso exige que Nginx Proxy Manager e 9router participem da rede
`npm-proxy`.

### Por que não usar Access List no mesmo domínio

O endpoint `/v1` já autentica por `Authorization: Bearer <API_KEY>`. Uma Access
List do Nginx Proxy Manager adicionaria Basic Auth antes da API e pode quebrar
Codex, SDKs e outros clientes OpenAI-compatible.

Neste domínio compartilhado:

- o dashboard é protegido pelo login do 9router;
- a API é protegida pelas API keys do 9router;
- o Nginx Proxy Manager faz TLS e encaminhamento;
- limites de custo e quotas são configurados no 9router/provider.

**Block Common Exploits** não transforma o proxy em WAF nem substitui rate
limiting. Se o domínio receber tráfego não confiável em escala, adicione uma
camada de proteção compatível com clientes de API e mantenha limites financeiros
nos providers.

Se futuramente for necessário SSO, allowlist de IP ou autenticação adicional,
desenhe uma entrada administrativa separada. Não aplique Basic Auth
silenciosamente ao hostname usado pelas aplicações.

### SSL

Na aba **SSL**:

1. selecione **Request a new SSL Certificate**;
2. habilite **Force SSL**;
3. habilite **HTTP/2 Support**;
4. aceite os termos do Let's Encrypt;
5. salve e valide o acesso HTTPS;
6. habilite HSTS somente depois de confirmar que o domínio funciona
   permanentemente em HTTPS.

Use **HSTS Subdomains** apenas se todos os subdomínios do domínio pai também
forem exclusivamente HTTPS.

### Advanced

Adicione:

```nginx
proxy_buffering off;
proxy_request_buffering off;
proxy_cache off;
proxy_read_timeout 3600s;
proxy_send_timeout 3600s;
client_max_body_size 50m;
```

Essas opções evitam buffering de respostas streaming/SSE e aumentam o timeout
para respostas longas de modelos. O toggle **Websockets Support** já adiciona
os headers de upgrade; não duplique manualmente `Upgrade` e `Connection`.

Não adicione `proxy_hide_header Upgrade`.

## 6. Validar o acesso público

Teste o health check:

```bash
curl --fail https://ai.example.com/api/health
```

Teste se a API rejeita uma chamada sem chave:

```bash
curl -i https://ai.example.com/v1/models
```

O resultado esperado é HTTP `401`.

Teste com uma chave criada no dashboard:

```bash
curl --fail https://ai.example.com/v1/models \
  -H "Authorization: Bearer <API_KEY_DO_CONSUMIDOR>"
```

Teste streaming pelo proxy:

```bash
curl --no-buffer --fail https://ai.example.com/v1/chat/completions \
  -H "Authorization: Bearer <API_KEY_DO_CONSUMIDOR>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "review-quality",
    "messages": [
      {
        "role": "user",
        "content": "Responda somente com: ok"
      }
    ],
    "stream": true
  }'
```

Confirme:

- certificado válido para o domínio;
- redirecionamento HTTP para HTTPS;
- ausência de HTTP 502/504;
- resposta streaming chegando progressivamente;
- uso registrado no dashboard;
- chave inválida retornando HTTP 401;
- porta `20128` indisponível pelo IP público da VPS.

Na VPS, confira o bind da porta:

```bash
ss -lntp | grep 20128
```

O listener publicado pelo Docker deve aparecer em `127.0.0.1:20128`, não em
`0.0.0.0:20128` ou `[::]:20128`.

## 7. Acessar o dashboard

O acesso normal será:

```text
https://ai.example.com/dashboard
```

O dashboard deve continuar exigindo a senha do 9router, mesmo estando atrás do
Nginx Proxy Manager.

### Túnel SSH de emergência

Na sua máquina local:

```bash
ssh -L 20128:127.0.0.1:20128 <USUARIO>@<HOST_DA_VPS>
```

Enquanto a sessão SSH estiver aberta, acesse:

```text
http://127.0.0.1:20128/dashboard
```

No primeiro acesso:

1. entre com `NINE_ROUTER_INITIAL_PASSWORD`;
2. altere a senha;
3. confirme que login continua obrigatório;
4. conecte somente os providers aprovados para uso;
5. crie uma API key exclusiva para o `cli-reviewer`;
6. se o Agent Hub também consumir a API, crie outra chave para ele;
7. não ative logs completos de request/response.

## 8. Configurar provider e combo

No dashboard:

1. abra **Providers**;
2. conecte a assinatura ou API aprovada;
3. valide um modelo individual;
4. abra **Combos**;
5. crie um combo, por exemplo `review-quality`;
6. coloque modelos de qualidade adequada para code review;
7. configure limites de custo antes de incluir providers pagos;
8. mantenha compressão de prompt/diff desabilitada nesta etapa.

Não trate modelos gratuitos ou preços publicados como garantias permanentes.
Quotas, disponibilidade e custos pertencem aos providers e mudam com o tempo.

### Organizar outros casos de uso

Crie uma API key e, quando necessário, um combo diferente para cada consumidor:

| Consumidor | API key sugerida | Modelo/combo sugerido |
|---|---|---|
| CLI Reviewer | `cli-reviewer-vps` | `review-quality` |
| Agent Hub | `agent-hub-vps` | conforme o fluxo |
| OpenClaw | `openclaw-vps` | conforme o agente |
| Estação de desenvolvimento | `dev-<nome>` | `interactive-balanced` |
| Integração externa | `<sistema>-prod` | combo dedicado |

As chaves não devem ser compartilhadas entre aplicações. Isso permite revogar
um consumidor sem interromper os demais e facilita identificar uso anormal.

Para consumidores:

- dentro da mesma rede Docker, prefira `http://9router:20128/v1`;
- no host da VPS, prefira `http://127.0.0.1:20128/v1`;
- fora da VPS, use `https://ai.example.com/v1`;
- nunca envie a API key na query string;
- mantenha limites de custo compatíveis com cada finalidade;
- não use um combo econômico para review crítica sem avaliar a qualidade;
- revogue imediatamente chaves expostas ou de consumidores desativados.

### OpenClaw sem OpenRouter: o que pode ser reaproveitado

O objetivo final é:

```text
OpenClaw
  -> 9router
       -> Codex
       -> Gemini por API key ou Vertex AI

OpenRouter
  -> removido depois da validação
```

Há uma diferença importante entre as duas assinaturas:

| Origem | Uso direto no OpenClaw via 9router | Orientação |
|---|---|---|
| Assinatura ChatGPT com Codex | O 9router oferece uma conexão OAuth própria, mas a OpenAI documenta a assinatura para clientes Codex oficiais e não confirma o 9router como cliente suportado | Tratar como experimental, revisar a autorização exibida e validar os termos antes de habilitar |
| Assinatura Google AI Pro/Ultra no Gemini CLI | **Não usar** o OAuth do Gemini CLI no 9router/OpenClaw | O Google orienta aplicações de terceiros a usar Google AI Studio API key ou Vertex AI |
| Gemini API no Google AI Studio | Sim, como provider de API key, sujeito às quotas e à cobrança da API | Criar uma chave dedicada e aplicar limites |
| Vertex AI | Sim, com projeto e credencial próprios, sujeito às quotas e à cobrança do Google Cloud | Preferível para operação de servidor e controle por projeto |

A assinatura do aplicativo Gemini e a franquia do Gemini CLI não são uma
franquia genérica de API. Portanto, não configure o provider `Gemini CLI OAuth`
no 9router para atender o OpenClaw, mesmo que a interface do 9router permita
essa conexão.

Para o Codex, antes de autorizar:

1. confira se a tela de autorização pertence à OpenAI;
2. leia os escopos solicitados;
3. use somente uma conta pessoal explicitamente aprovada para o piloto;
4. não copie tokens OAuth para `.env`, Compose, logs ou documentação;
5. mantenha a imagem do 9router fixada em uma versão revisada;
6. confirme os termos aplicáveis à conta e ao plano;
7. interrompa o piloto se a OpenAI rejeitar, limitar ou não reconhecer o fluxo.

Se essa validação não for aprovada, use no 9router uma API key oficial da OpenAI
em vez da assinatura do Codex. Essa alternativa possui cobrança de API
independente da assinatura do ChatGPT.

### Configurar os providers para o OpenClaw

No dashboard do 9router:

1. conecte o provider Codex somente após aceitar a condição experimental acima;
2. para Gemini, adicione uma API key do Google AI Studio **ou** configure
   Vertex AI;
3. teste cada provider separadamente;
4. consulte `/v1/models` e anote os IDs realmente retornados pela versão
   instalada;
5. crie o combo `openclaw-primary`;
6. use Codex como primeira opção e o provider Gemini suportado como fallback,
   ou inverta a ordem conforme custo e qualidade observados;
7. não inclua OpenRouter nesse combo;
8. crie a API key `openclaw-vps`, exclusiva para esse runtime.

Não copie IDs de modelos deste guia para produção. Os nomes disponíveis mudam
com a versão do 9router e com a disponibilidade de cada provider.

### Configurar o OpenClaw

Antes de editar, faça backup do arquivo existente e preserve canais, tools,
memória, políticas e demais providers. Altere somente a seleção de modelo e o
bloco do provider `9router`.

Exemplo para um OpenClaw em container na mesma rede Docker:

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "9router/openclaw-primary"
      }
    }
  },
  "models": {
    "providers": {
      "9router": {
        "baseUrl": "http://9router:20128/v1",
        "apiKey": "<API_KEY_OPENCLAW_VPS>",
        "api": "openai-completions",
        "models": [
          {
            "id": "openclaw-primary",
            "name": "OpenClaw via 9router"
          }
        ]
      }
    }
  }
}
```

Se o OpenClaw executar diretamente no host da VPS, use:

```json
"baseUrl": "http://127.0.0.1:20128/v1"
```

Se executar em outra máquina, use:

```json
"baseUrl": "https://ai.example.com/v1"
```

Não use `localhost` dentro do container: ele aponta para o próprio container,
não para o 9router.

O exemplo mostra apenas o fragmento relevante. Não substitua o
`openclaw.json` completo por ele.

### Migrar do OpenRouter sem interrupção

Faça a retirada em etapas:

1. registre os modelos, aliases, fallback e chave OpenRouter usados atualmente;
2. faça backup da configuração do OpenClaw;
3. adicione o provider `9router` sem remover o OpenRouter;
4. teste `/api/health`, `/v1/models`, uma completion simples e uma resposta
   streaming;
5. execute pelo OpenClaw um fluxo real que use tools;
6. torne `9router/openclaw-primary` o modelo primário;
7. mantenha o OpenRouter apenas como rollback durante a janela de observação;
8. confirme no dashboard do 9router qual provider atendeu cada tentativa;
9. confirme que o OpenRouter não recebeu novas requisições;
10. remova o provider OpenRouter do OpenClaw;
11. remova o secret do ambiente e revogue a chave no OpenRouter.

Não revogue a chave antes da validação ponta a ponta. Ao final, a chave deve ser
revogada, e não apenas retirada do arquivo de configuração.

Critérios de aceite específicos:

- o OpenClaw completa um fluxo real por meio do 9router;
- uma resposta streaming não é interrompida pelo proxy;
- tools e respostas estruturadas continuam funcionando;
- o dashboard identifica o provider usado e o fallback;
- o combo não contém OpenRouter;
- não há novas chamadas no painel do OpenRouter após a virada;
- o secret do OpenRouter foi removido e a chave foi revogada;
- nenhuma credencial OAuth foi copiada para arquivos ou logs.

## 9. Testar a API diretamente

Copie uma API key criada para o consumidor e teste a listagem de modelos pelo
domínio público:

```bash
curl --fail https://ai.example.com/v1/models \
  -H "Authorization: Bearer <API_KEY_DO_CONSUMIDOR>"
```

Teste uma completion pequena antes de enviar um diff:

```bash
curl --fail https://ai.example.com/v1/chat/completions \
  -H "Authorization: Bearer <API_KEY_DO_CONSUMIDOR>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "review-quality",
    "messages": [
      {
        "role": "user",
        "content": "Responda somente com: ok"
      }
    ],
    "stream": false
  }'
```

Confirme no dashboard:

- provider/modelo efetivamente utilizado;
- tokens consumidos;
- ausência de erro de autenticação;
- ausência de request body nos logs persistidos.

## 10. Integração transitória com o Reviewer atual

O Reviewer atual executa o Codex CLI por subprocesso. É possível apontar esse
Codex para o 9router sem esperar o adapter nativo.

Primeiro, armazene a API key criada no secret do deploy:

```env
NINE_ROUTER_REVIEWER_API_KEY=<API_KEY_CRIADA_NO_DASHBOARD>
```

Depois, no serviço `cli-reviewer` do Compose, acrescente:

```yaml
services:
  cli-reviewer:
    environment:
      OPENAI_BASE_URL: http://9router:20128/v1
      OPENAI_API_KEY: ${NINE_ROUTER_REVIEWER_API_KEY}
      CODEX_ENABLED: "true"
      CODEX_ARGS: "exec --model review-quality -"
```

Recrie somente o Reviewer:

```bash
docker compose -f docker-compose.vps.yml up -d --no-deps cli-reviewer
docker compose -f docker-compose.vps.yml logs --tail=100 cli-reviewer
```

### Limitações da integração transitória

- o Reviewer continuará registrando o provider como `codex`;
- fallback interno e modelo final aparecerão no 9router, não no dashboard do
  Reviewer;
- tokens continuarão estimados pelo Reviewer;
- uma falha do processo Codex não acionará outro adapter do Reviewer;
- a compatibilidade depende da versão do Codex CLI presente na imagem;
- `CODEX_ARGS` substitui completamente os argumentos padrão.

Faça primeiro uma review manual ou de um repositório de teste. Não habilite
aprovação ou merge automáticos durante a validação:

```env
AUTO_REVIEW_APPROVE_ON_SUCCESS=false
AUTO_REVIEW_MERGE_ON_SUCCESS=false
```

Se o Codex CLI da imagem não aceitar o combo como `--model`, use um modelo
individual retornado por `/v1/models` e registre a incompatibilidade antes de
alterar produção.

## 11. Integração nativa futura do Reviewer

Depois que a
[spec de evolução](../specifications/2026-07-25-evolucao-providers-fallback-observabilidade.md)
for aprovada e implementada, a configuração prevista será:

```env
AI_PROVIDER_CHAIN=codex,openai-compatible,gemini,code
AI_PROVIDER_TIMEOUT_MS=180000

OPENAI_COMPATIBLE_ENABLED=true
OPENAI_COMPATIBLE_LABEL=9router
OPENAI_COMPATIBLE_BASE_URL=http://9router:20128/v1
OPENAI_COMPATIBLE_API_KEY=<API_KEY_DO_REVIEWER>
OPENAI_COMPATIBLE_MODEL=review-quality
```

Essa seção é referência futura. Antes de usar as variáveis, confirme que elas
existem em `.env.example` e que `npm run doctor` reconhece o adapter.

## 12. Integração com o Agent Hub

Não invente uma variável de ambiente do Agent Hub apenas para armazenar a URL.
Primeiro identifique qual componente fará a chamada:

- se o próprio `agent-hub-api` suportar endpoint OpenAI-compatible, use
  `http://9router:20128/v1`;
- se o Agent Hub apenas encaminhar a tarefa ao Reviewer, mantenha a integração
  somente no `cli-reviewer`;
- se um runtime OpenClaw dentro da mesma rede usar o gateway, configure nele a
  URL interna e uma API key exclusiva;
- se o consumidor rodar diretamente no host da VPS, use
  `http://127.0.0.1:20128/v1`.
- se o consumidor estiver fora da VPS, use `https://ai.example.com/v1` e uma
  API key exclusiva.

O fluxo existente do Agent Hub para o Reviewer continua:

```text
agent-hub-api
  -> http://cli-reviewer:3333/webhooks/gitlab
  -> callback autenticado ao Agent Hub
```

Adicionar o 9router não altera `REVIEW_WEBHOOK_SECRET`,
`AGENT_HUB_CALLBACK_SECRET` nem os endpoints de webhook.

## 13. Checklist de aceite

- [ ] `docker compose ... config --quiet` termina sem erro.
- [ ] O serviço `9router` está `healthy`.
- [ ] `curl http://127.0.0.1:20128/api/health` retorna `{"ok":true}`.
- [ ] O Reviewer acessa `http://9router:20128/api/health`.
- [ ] A porta `20128` não está publicada em `0.0.0.0`.
- [ ] O domínio público possui certificado TLS válido.
- [ ] HTTP redireciona para HTTPS.
- [ ] Nginx Proxy Manager acessa `9router:20128` pela rede Docker.
- [ ] O dashboard exige login.
- [ ] A senha inicial foi alterada.
- [ ] Existe uma API key exclusiva por consumidor.
- [ ] Uma chamada pública sem API key retorna HTTP 401.
- [ ] `/v1/models` exige e aceita a API key.
- [ ] Uma completion de teste funciona.
- [ ] Uma completion streaming funciona sem buffering ou timeout prematuro.
- [ ] Request logs permanecem desabilitados.
- [ ] O volume `9router-data` existe.
- [ ] Aprovação e merge automáticos continuam desabilitados durante o piloto.
- [ ] O Reviewer continua reportando resultado ao Agent Hub.
- [ ] O OpenClaw completa um fluxo real com tools pelo 9router.
- [ ] O combo do OpenClaw não contém OpenRouter.
- [ ] O painel do OpenRouter não recebe chamadas depois da virada.
- [ ] A chave do OpenRouter foi revogada depois da janela de observação.
- [ ] O OAuth do Gemini CLI não foi reutilizado no OpenClaw.
- [ ] O procedimento de rollback foi testado.

## 14. Backup

Antes de atualizar a imagem, faça backup do volume:

```bash
docker run --rm \
  -v 9router-data:/data:ro \
  -v "$PWD":/backup \
  alpine \
  tar -czf /backup/9router-data-backup.tgz -C /data .
```

O exemplo do Compose fixa o nome como `9router-data`. Se essa opção tiver sido
removida ou alterada, descubra o nome real com:

```bash
docker volume ls | grep 9router
```

Proteja o arquivo de backup: ele pode conter tokens, contas e configurações dos
providers.

## 15. Atualização

1. leia o changelog da versão;
2. faça backup do volume;
3. atualize `NINE_ROUTER_IMAGE` para uma tag ou digest específico;
4. valide o Compose;
5. atualize somente o serviço;
6. valide health, modelos e uma completion;
7. só depois reative o tráfego normal.

```bash
docker compose -f docker-compose.vps.yml config --quiet
docker compose -f docker-compose.vps.yml pull 9router
docker compose -f docker-compose.vps.yml up -d --no-deps 9router
docker compose -f docker-compose.vps.yml ps 9router
docker compose -f docker-compose.vps.yml logs --tail=100 9router
```

## 16. Rollback

### Reverter somente o Reviewer

Remova do `cli-reviewer`:

```env
OPENAI_BASE_URL
OPENAI_API_KEY
CODEX_ARGS
```

Restaure a configuração anterior do Codex e recrie somente o Reviewer:

```bash
docker compose -f docker-compose.vps.yml up -d --no-deps cli-reviewer
```

### Reverter somente o OpenClaw

Durante a janela de observação:

1. restaure o backup do bloco de modelo/provider do OpenClaw;
2. volte o modelo primário ao provider anterior;
3. reinicie somente o runtime OpenClaw;
4. execute um fluxo curto de validação.

Depois que a chave do OpenRouter tiver sido revogada, esse rollback deixa de
funcionar até uma nova credencial ser criada. Preserve o backup apenas como
referência e não mantenha uma chave revogada nele.

### Reverter o 9router

1. altere `NINE_ROUTER_IMAGE` para a versão anterior;
2. execute `pull` e `up -d --no-deps 9router`;
3. valide `/api/health` e `/v1/models`.

Para retirar o serviço sem apagar seus dados:

```bash
docker compose -f docker-compose.vps.yml stop 9router
```

Não remova `9router-data` durante um rollback comum.

## 17. Diagnóstico rápido

### `Connection refused`

```bash
docker compose -f docker-compose.vps.yml ps 9router
docker compose -f docker-compose.vps.yml logs --tail=200 9router
```

Confirme `PORT=20128`, `HOSTNAME=0.0.0.0` e o health check.

### `ENOTFOUND 9router`

Os serviços não estão na mesma rede Docker ou o nome do serviço diverge.

### HTTP 401 em `/v1/models`

- confirme a API key do consumidor;
- confirme o header `Authorization: Bearer ...`;
- gere outra chave no dashboard se necessário;
- não desabilite a exigência de API key para contornar o problema.

### Modelo ou combo não encontrado

- consulte `/v1/models`;
- confirme o nome exato do combo;
- valide se os providers internos estão conectados;
- teste primeiro um modelo individual.

### Codex recebe 404 ou tenta `/v1/v1`

As versões do Codex CLI e os exemplos upstream do 9router podem divergir sobre
se `OPENAI_BASE_URL` deve terminar em `/v1`. O padrão inicial deste guia é:

```env
OPENAI_BASE_URL=http://9router:20128/v1
```

Se os logs mostrarem uma URL duplicada ou HTTP 404, teste:

```env
OPENAI_BASE_URL=http://9router:20128
```

Altere somente depois de confirmar a URL efetivamente chamada pela versão do
Codex presente na imagem do Reviewer.

### Dashboard funciona, mas o Reviewer falha

- valide o acesso a partir do container do Reviewer;
- confira `OPENAI_BASE_URL`;
- confira `CODEX_ARGS`;
- confirme se o Codex CLI da imagem aceita o modelo informado;
- mantenha aprovação e merge automáticos desligados até resolver.

## Referências upstream

Documentação consultada em 2026-07-29:

- [Docker do 9router](https://github.com/decolua/9router/blob/master/DOCKER.md)
- [Compose oficial](https://github.com/decolua/9router/blob/master/docker-compose.yml)
- [Contrato de ambiente](https://github.com/decolua/9router/blob/master/.env.example)
- [README e integração OpenAI-compatible](https://github.com/decolua/9router/blob/master/README.md)
- [Health check atual](https://github.com/decolua/9router/blob/master/src/app/api/health/route.js)
- [Nginx Proxy Manager](https://github.com/NginxProxyManager/nginx-proxy-manager)
- [Codex incluído nos planos ChatGPT](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan)
- [Autenticação oficial do Gemini CLI](https://github.com/google-gemini/gemini-cli/blob/main/docs/get-started/authentication.mdx)
- [Política do Gemini CLI para aplicações de terceiros](https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/faq.md#why-cant-i-use-third-party-software-like-claude-code-openclaw-or-opencode-with-gemini-cli)

Como o projeto muda rapidamente, confira essas referências antes de atualizar a
imagem ou adicionar novas variáveis.
