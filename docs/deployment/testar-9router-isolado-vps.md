# Piloto isolado do 9router na VPS

## Objetivo

Este é o primeiro passo da adoção do 9router. O piloto sobe o serviço em um
Docker Compose próprio, sem alterar o Compose, as redes ou as variáveis do
Agent Hub, do CLI Reviewer e do OpenClaw. Para facilitar o teste, ele já será
publicado em HTTPS pelo Nginx Proxy Manager.

Nesta fase, o tráfego público entra somente pelo Nginx Proxy Manager:

```text
Internet
  -> https://ai.example.com
    -> Nginx Proxy Manager
      -> rede Docker compartilhada
        -> Compose nine-router-pilot
          -> 9router:20128
            -> provider testado

Administrador
  -> túnel SSH de emergência
    -> 127.0.0.1:20128 na VPS
```

O OpenClaw continua fora desta primeira mudança. Ele só será apontado para o
domínio depois que health check, HTTPS, login, persistência e pelo menos um
provider funcionarem.

## Limites do piloto

O piloto:

- não modifica `docker-compose.vps.yml` do Agent Hub;
- não conecta o 9router às redes do Agent Hub ou Reviewer;
- conecta o 9router somente à rede externa do Nginx Proxy Manager;
- não publica a porta `20128` no IP público;
- não troca o provider atual do OpenClaw;
- não remove nem revoga a chave do OpenRouter;
- não habilita aprovação ou merge automático no Reviewer.

## 1. Criar o diretório isolado

Na VPS:

```bash
sudo install -d -m 750 /opt/9router-pilot
cd /opt/9router-pilot
```

Crie dois arquivos nesse diretório:

```text
/opt/9router-pilot/
  compose.yml
  .env
```

Os arquivos-base estão versionados em
[`docs/deployment/9router-pilot`](9router-pilot/). Copie `compose.yml` e copie
`.env.example` como `.env`; nunca use os valores de exemplo em uma VPS.

Proteja o `.env`:

```bash
sudo touch /opt/9router-pilot/.env
sudo chmod 600 /opt/9router-pilot/.env
```

O arquivo não deve ser adicionado a um repositório Git.

## 2. Preparar os secrets

Gere quatro valores diferentes:

```bash
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
```

Preencha `/opt/9router-pilot/.env`:

```env
# Para o primeiro teste controlado. Fixe uma tag ou digest antes da exposição.
NINE_ROUTER_IMAGE=decolua/9router:latest
NINE_ROUTER_PUBLIC_URL=https://ai.example.com
NPM_NETWORK_NAME=npm-proxy

JWT_SECRET=<SEGREDO_1>
INITIAL_PASSWORD=<SENHA_INICIAL_FORTE>
API_KEY_SECRET=<SEGREDO_2>
MACHINE_ID_SALT=<SEGREDO_3>
```

Não reutilize tokens do GitLab, GitHub, Agent Hub, OpenRouter ou secrets de
webhook.

## 3. Criar o Compose exclusivo

Crie `/opt/9router-pilot/compose.yml`:

```yaml
name: nine-router-pilot

services:
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

      JWT_SECRET: ${JWT_SECRET}
      INITIAL_PASSWORD: ${INITIAL_PASSWORD}
      API_KEY_SECRET: ${API_KEY_SECRET}
      MACHINE_ID_SALT: ${MACHINE_ID_SALT}

      REQUIRE_API_KEY: "true"
      ENABLE_REQUEST_LOGS: "false"
      OBSERVABILITY_ENABLED: "true"
      AUTH_COOKIE_SECURE: "true"

      BASE_URL: http://127.0.0.1:20128
      NEXT_PUBLIC_BASE_URL: ${NINE_ROUTER_PUBLIC_URL}
    volumes:
      - 9router-pilot-data:/app/data
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
  9router-pilot-data:
    name: nine-router-pilot-data

networks:
  npm-proxy:
    external: true
    name: ${NPM_NETWORK_NAME}
```

`AUTH_COOKIE_SECURE=true` é obrigatório porque o dashboard será publicado em
HTTPS. A rede `default` continua exclusiva deste Compose; somente `npm-proxy` é
compartilhada.

## 4. Validar e iniciar

No diretório do piloto:

```bash
cd /opt/9router-pilot
docker network inspect "$(grep '^NPM_NETWORK_NAME=' .env | cut -d= -f2-)" >/dev/null
docker compose config --quiet
docker compose pull
docker compose up -d
docker compose ps
docker compose logs --tail=100 9router
```

Valide o health check no host da VPS:

```bash
curl --fail http://127.0.0.1:20128/api/health
```

Resposta esperada na versão consultada:

```json
{"ok":true}
```

Confirme que a porta não está exposta publicamente:

```bash
ss -lntp | grep 20128
```

O listener deve aparecer em `127.0.0.1:20128`, nunca em `0.0.0.0:20128` ou
`[::]:20128`.

Registre a imagem realmente executada:

```bash
docker compose images
docker image inspect "$(docker compose images -q 9router)" \
  --format '{{index .RepoDigests 0}}'
```

Depois do primeiro teste, substitua `latest` pela tag ou pelo digest validado.

## 5. Configurar o Nginx Proxy Manager

Antes de subir o serviço, confirme o nome da rede usada pelo container do Nginx
Proxy Manager:

```bash
docker network ls
docker inspect <CONTAINER_DO_NPM> --format '{{json .NetworkSettings.Networks}}'
```

Coloque o nome real em `NPM_NETWORK_NAME`. Não crie outra rede com o mesmo
propósito se o Nginx Proxy Manager já possui uma rede externa apropriada.

No painel do Nginx Proxy Manager, crie um **Proxy Host**:

| Campo | Valor |
|---|---|
| Domain Names | domínio definido em `NINE_ROUTER_PUBLIC_URL` |
| Scheme | `http` |
| Forward Hostname / IP | `9router` |
| Forward Port | `20128` |
| Cache Assets | desabilitado |
| Block Common Exploits | habilitado |
| Websockets Support | habilitado |
| Access List | `Publicly Accessible` |

Na aba **SSL**:

1. solicite um certificado Let's Encrypt;
2. habilite **Force SSL**;
3. habilite **HTTP/2 Support**;
4. deixe HSTS para depois da primeira validação bem-sucedida.

Na aba **Advanced**, adicione:

```nginx
proxy_buffering off;
proxy_request_buffering off;
proxy_cache off;
proxy_read_timeout 3600s;
proxy_send_timeout 3600s;
client_max_body_size 50m;
```

Não use Basic Auth no mesmo hostname da API: o endpoint `/v1` usa Bearer API
key e clientes como OpenClaw podem não lidar com uma segunda autenticação.

Valide:

```bash
curl --fail https://ai.example.com/api/health
```

Substitua `ai.example.com` pelo domínio real.

### Túnel SSH de emergência

Na máquina do administrador:

```bash
ssh -L 20128:127.0.0.1:20128 <USUARIO>@<HOST_DA_VPS>
```

Com a sessão aberta, o acesso local de emergência é:

```text
http://127.0.0.1:20128/dashboard
```

O acesso normal ao dashboard será:

```text
https://ai.example.com/dashboard
```

No primeiro acesso pelo domínio HTTPS:

1. entre com `INITIAL_PASSWORD`;
2. altere a senha;
3. confirme que uma nova sessão exige login;
4. mantenha request/response logs desabilitados;
5. crie uma API key exclusiva chamada `openclaw-pilot`;
6. confirme que o dashboard continua exigindo login.

## 6. Testar os providers separadamente

Não crie um combo Codex/Gemini antes de testar cada provider isoladamente.

### Codex

O 9router oferece conexão OAuth para Codex. A OpenAI documenta o uso da
assinatura do ChatGPT nos clientes Codex oficiais, mas não confirma o 9router
como cliente suportado. Portanto, esse teste é experimental.

Antes de autorizar:

1. confirme que a tela de login e autorização pertence à OpenAI;
2. leia os escopos solicitados;
3. não copie tokens OAuth para `.env`, Compose ou logs;
4. use somente uma conta aprovada para o piloto;
5. interrompa o teste se houver alerta, bloqueio ou fluxo não reconhecido.

No dashboard, conecte Codex, teste a conexão e copie o ID exato de um modelo
retornado pelo 9router.

### Gemini

Não use o OAuth do Gemini CLI para atender OpenClaw. O próprio Google orienta
que aplicações de terceiros usem uma API key do Google AI Studio ou Vertex AI.
Reaproveitar o OAuth do Gemini CLI pode resultar em suspensão da conta.

Para o piloto, escolha um caminho suportado:

- Gemini API key dedicada do Google AI Studio; ou
- projeto e credencial próprios do Vertex AI.

A assinatura Google AI Pro/Ultra não deve ser tratada como uma franquia
genérica de API. API e Vertex podem ter quotas e cobrança independentes.

Teste Gemini separadamente e anote o ID exato retornado por `/v1/models`.

## 7. Testar a API pelo domínio HTTPS

Teste primeiro a autenticação. Sem chave:

```bash
curl -i https://ai.example.com/v1/models
```

O resultado esperado é HTTP `401`.

Com a chave `openclaw-pilot`:

```bash
export NINE_ROUTER_PILOT_KEY='<API_KEY_OPENCLAW_PILOT>'

curl --fail https://ai.example.com/v1/models \
  -H "Authorization: Bearer $NINE_ROUTER_PILOT_KEY"
```

Teste Codex e Gemini em chamadas independentes, substituindo os IDs:

```bash
curl --fail https://ai.example.com/v1/chat/completions \
  -H "Authorization: Bearer $NINE_ROUTER_PILOT_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "<ID_EXATO_DO_MODELO>",
    "messages": [
      {"role": "user", "content": "Responda somente com: ok"}
    ],
    "stream": false
  }'
```

Depois teste streaming:

```bash
curl --no-buffer --fail https://ai.example.com/v1/chat/completions \
  -H "Authorization: Bearer $NINE_ROUTER_PILOT_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "<ID_EXATO_DO_MODELO>",
    "messages": [
      {"role": "user", "content": "Conte de 1 a 5, um número por linha."}
    ],
    "stream": true
  }'
```

Remova a variável da sessão ao terminar:

```bash
unset NINE_ROUTER_PILOT_KEY
```

## 8. Gate para testar o OpenClaw

Somente aponte o OpenClaw para o domínio quando todos os itens aplicáveis
estiverem concluídos:

- [ ] O Compose isolado valida sem erro.
- [ ] O container permanece `healthy` após reinício.
- [ ] O volume `nine-router-pilot-data` preserva a configuração após reinício.
- [ ] A porta está vinculada apenas a `127.0.0.1`.
- [ ] O Nginx Proxy Manager acessa `9router:20128` pela rede compartilhada.
- [ ] O domínio possui certificado TLS válido e força HTTPS.
- [ ] O dashboard exige login e a senha inicial foi alterada.
- [ ] Chamadas sem API key retornam HTTP 401.
- [ ] `/v1/models` funciona com a API key do piloto.
- [ ] Codex foi testado isoladamente ou formalmente descartado.
- [ ] Gemini por API key/Vertex foi testado isoladamente ou formalmente
  descartado.
- [ ] Completion comum e streaming funcionam.
- [ ] O dashboard identifica provider, modelo e consumo.
- [ ] Nenhuma credencial apareceu em logs ou arquivos versionados.
- [ ] OpenClaw e OpenRouter ainda não foram alterados.

Depois desse gate, configure o OpenClaw com
`https://ai.example.com/v1`, a API key exclusiva e um modelo individual já
validado. Não migre o serviço para o Compose do Agent Hub nesse momento. Use o
[guia de exposição e integração](configurar-9router-vps.md) para o fragmento do
`openclaw.json` e para a migração gradual. O OpenRouter só deve ser retirado
depois do teste ponta a ponta.

## 9. Parar ou remover o piloto

Parar sem apagar dados:

```bash
cd /opt/9router-pilot
docker compose stop
```

Remover o container e a rede do Compose, preservando o volume:

```bash
docker compose down
```

Não use `docker compose down -v` durante o piloto. O volume contém contas,
tokens e configurações e deve ser removido apenas após decisão explícita e
backup, se necessário.

## Referências

Consultadas em 2026-08-05:

- [Docker do 9router](https://github.com/decolua/9router/blob/master/DOCKER.md)
- [Contrato de ambiente do 9router](https://github.com/decolua/9router/blob/master/.env.example)
- [API e integração OpenClaw do 9router](https://github.com/decolua/9router/blob/master/README.md)
- [Codex nos planos ChatGPT](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan)
- [Política oficial do Gemini CLI para aplicações de terceiros](https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/faq.md#why-cant-i-use-third-party-software-like-claude-code-openclaw-or-opencode-with-gemini-cli)
