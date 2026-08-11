# Troubleshooting - CLI Reviewer

Guia para diagnosticar problemas comuns com o webhook server.

## 🔍 Sintomas: Container rodando mas não gera reviews

### Diagnóstico Rápido

**1. Execute o script de diagnóstico dentro do container:**

```bash
# Local
npm run diagnostic

# Dentro do container Docker
docker exec -it <container-name> npm run diagnostic
```

**2. Verifique os logs em tempo real:**

```bash
docker logs -f <container-name>
```

**3. Teste o health check:**

```bash
curl http://localhost:3333/health
```

---

## 🐛 Problemas Comuns

### 1. Webhooks não estão chegando

**Sintomas:**
- Container rodando sem erros
- Logs mostram apenas "Aguardando webhooks..."
- Nenhum log de requisição ao criar/atualizar MRs

**Causas possíveis:**

#### a) Webhook não configurado no GitLab

Verifique em `Project → Settings → Webhooks`:

- **URL**: Deve apontar para `https://seu-dominio/webhooks/gitlab`
- **Secret Token**: Deve corresponder ao `WEBHOOK_SECRET` no .env
- **Trigger events**: Marque "Merge request events"
- **SSL verification**: Habilitado (se usar HTTPS válido)

**Teste:** Clique em "Test" → "Merge request events" no GitLab

#### b) Firewall ou proxy bloqueando

- O GitLab consegue alcançar a URL do webhook?
- Verifique logs do Nginx/proxy reverso
- Teste com `curl` de fora da rede

#### c) URL do webhook errada

Verifique se a URL está acessível:
```bash
curl -X POST https://seu-dominio/webhooks/gitlab \
  -H "X-Gitlab-Token: seu-secret" \
  -H "Content-Type: application/json" \
  -d '{"object_kind":"ping"}'
```

### 2. AUTO_REVIEW_ENABLED=false

**Sintomas:**
- Logs mostram "AUTO_REVIEW_ENABLED=false - análise desabilitada"

**Solução:**
```env
AUTO_REVIEW_ENABLED=true
```

Reinicie o container após alterar:
```bash
docker restart <container-name>
```

### 3. WEBHOOK_SECRET incorreto

**Sintomas:**
- Logs mostram "token invalido"
- GitLab webhook mostra erro 401

**Solução:**
1. Verifique se o `WEBHOOK_SECRET` no .env corresponde ao configurado no GitLab
2. Não use aspas no .env: `WEBHOOK_SECRET=meu-segredo` (não `"meu-segredo"`)

### 4. Projeto não configurado

**Sintomas:**
- Logs mostram "projeto ou MR nao configurado"
- Webhook recebido mas ignorado

**Causa:** O ID do projeto no webhook não corresponde aos configurados em `GITLAB_PROJECTS`

**Solução:**

1. Verifique o ID do projeto no GitLab: `Project → Settings → General`
2. Configure no .env:

```env
# Usando ID numérico
GITLAB_PROJECTS=123:front:Frontend

# OU usando path (recomendado)
GITLAB_PROJECTS=grupo/projeto:front:Frontend
```

3. O diagnóstico mostra quais projetos estão configurados

### 5. Evento duplicado ou já processado

**Sintomas:**
- Logs mostram "evento ja processado" ou "evento em processamento"

**Causa:** Sistema de deduplicação evitando reprocessar mesmo evento

**Solução:**

Normal - o sistema está funcionando corretamente. Para forçar reprocessamento:

```bash
# Dentro do container, remova o state file
docker exec <container-name> rm /var/lib/cli-reviewer/webhook-state.json
docker restart <container-name>
```

### 6. Erro ao executar CLI (codex/gemini/claude)

**Sintomas:**
- Logs mostram erro durante análise
- "command not found" ou timeout

**Diagnóstico:**

```bash
docker exec <container-name> npm run diagnostic
```

Verifique seção "COMANDOS CLI DISPONÍVEIS"

**Solução:**

Se CLI não está disponível, reconstrua a imagem:
```bash
docker-compose build --no-cache
```

### 7. Erro de autenticação GitLab

**Sintomas:**
- "401 Unauthorized" ao buscar diff
- Erro ao postar comentário

**Solução:**

Verifique o token do GitLab:

```env
# Token deve ter scopes: api, read_api, write_repository
GITLAB_TOKEN=glpat-xxxxxxxxxxxxxxxxxxxx
```

Teste manualmente:
```bash
curl -H "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  https://seu-gitlab.com/api/v4/user
```

---

## 📊 Logs Detalhados

Com as melhorias de logging, você verá:

### Startup
```
┌──────────────────────────────────────────┐
│  CLI Reviewer — Webhook Server           │
└──────────────────────────────────────────┘

📋 Configuração carregada:
   AUTO_REVIEW_ENABLED: true
   AUTO_REVIEW_MODE: webhook
   ...

📂 Projetos monitorados (1):
   [gitlab/front] Frontend (id: 123)

✓ Webhook server iniciado em http://localhost:3333
⏳ Aguardando webhooks...
```

### Webhook recebido
```
[2024-08-10T15:30:45.123Z] 📥 Requisição #1: POST /webhooks/gitlab
   Headers: {"user-agent":"GitLab/...","x-gitlab-token":"***"}
   → Processando webhook GitLab...
   → GitLab webhook: verificando autenticação...
   ✓ Autenticação OK
   → Payload recebido (1234 bytes)
   → Tipo de evento: merge_request
   → Ação do MR: open
   → Projeto: grupo/projeto
   → MR: !123 - "feat: nova feature"
   ✓ Projeto encontrado: Frontend (gitlab:123)
   → Event key: gitlab:123:123:abc123
   → Estado do evento: started
   ✓ Webhook aceito, iniciando análise...

[webhook] 🔍 Analisando MR !123: "feat: nova feature" [Frontend]
   -> Buscando diff do MR !123...
   ✓ Diff obtido com sucesso
   → 3 arquivo(s) alterado(s)
   -> ~5000 tokens estimados; enviando para CODEX...
   -> Executando análise com codex (tipo projeto: front)...
   ✓ Análise concluída: APROVADO
      Riscos: 0 | Sugestões: 2
   -> Postando comentario no gitlab...
   ✓ Comentário postado com sucesso
   OK Aprovado | 2 sugestao(oes) | MR !123
[webhook] ✅ Análise concluída para MR !123
```

### Heartbeat (a cada 5 minutos)
```
[2024-08-10T15:35:00.000Z] 💓 Heartbeat: servidor ativo há 5 minutos, 3 requisições processadas
```

---

## 🔧 Comandos Úteis

**Ver logs em tempo real:**
```bash
docker logs -f cli-reviewer --tail=100
```

**Verificar health:**
```bash
curl http://localhost:3333/health
# Ou de fora (se exposto)
curl https://seu-dominio/health
```

**Testar webhook manualmente:**
```bash
# Criar arquivo test-webhook.json com payload do GitLab
curl -X POST http://localhost:3333/webhooks/gitlab \
  -H "X-Gitlab-Token: seu-secret" \
  -H "Content-Type: application/json" \
  -d @test-webhook.json
```

**Reiniciar container:**
```bash
docker restart cli-reviewer
```

**Executar diagnóstico:**
```bash
docker exec cli-reviewer npm run diagnostic
```

**Verificar variáveis de ambiente:**
```bash
docker exec cli-reviewer env | grep -E 'AUTO_|GITLAB_|WEBHOOK_'
```

---

## 📞 Suporte

Se o problema persistir após seguir este guia:

1. Execute `npm run diagnostic` e salve a saída
2. Capture os logs com `docker logs cli-reviewer > logs.txt`
3. Abra uma issue com essas informações

---

**Última atualização:** 2024-08-10
