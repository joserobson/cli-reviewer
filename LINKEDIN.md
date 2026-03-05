# LinkedIn Article — MR Reviewer

> Suggested hashtags:
> #opensource #developer #ai #gitlab #codereview #productivity #typescript #dotnet #angular #devtools

---

## 🇧🇷 Versão em Português

**Construí uma ferramenta open source que revisa Merge Requests automaticamente — sem pagar nada de API.**

Como desenvolvedor, eu passava uma parte considerável do meu tempo revisando Merge Requests manualmente: verificando padrões de código, procurando subscriptions sem cancelamento em Angular, queries N+1 em .NET, uso indevido de `async void`... uma lista longa.

A ideia foi simples: e se eu automatizasse isso usando as IAs que já tenho instaladas na minha máquina?

**O resultado é o MR Reviewer** — uma CLI em TypeScript que:

🔍 **Conecta ao GitLab** e lista os MRs abertos dos seus projetos (Angular e .NET no meu caso)

🤖 **Envia o diff para Claude ou Gemini CLI localmente** — sem passar por nenhuma API em nuvem, sem custo adicional além da assinatura que já tenho

📋 **Devolve uma revisão estruturada** com resumo, riscos, sugestões classificadas por severidade (crítico / aviso / sugestão) e um comentário completo pronto para o GitLab

✅ **Permite aprovar, comentar e fazer merge** diretamente do terminal

---

O que mais gostei de construir foi o **modo Watcher**: ele roda em segundo plano, faz polling no GitLab a cada N minutos, e quando detecta um MR novo — notificação no Windows, análise automática e comentário postado. Zero interação manual.

E para não desperdiçar tokens, implementei um **seletor inteligente de LLM**: ele rastreia o uso estimado de tokens por mês de cada provider e direciona automaticamente para o que tem mais capacidade restante. Se um atingir o limite, faz fallback para o outro.

---

**Stack:** TypeScript + tsx (sem build), GitLab API v4, Claude CLI, Gemini CLI

**Disponível no GitHub:** [github.com/seu-usuario/mr-reviewer](#)

Se você também usa GitLab com Claude ou Gemini localmente, pode ser útil. Contribuições são bem-vindas!

---

## 🇺🇸 English Version

**I built an open source tool that automatically reviews Merge Requests — without spending anything on APIs.**

As a developer, I was spending a good chunk of time on manual code reviews: checking Angular subscription leaks, .NET N+1 queries, improper `async void` usage... a long checklist that's easy to miss when you're in a hurry.

The idea was simple: what if I automated this using the AI tools already running on my machine?

**The result is MR Reviewer** — a TypeScript CLI that:

🔍 **Connects to GitLab** and lists open MRs from your projects (Angular and .NET in my case)

🤖 **Sends the diff to Claude or Gemini CLI locally** — no cloud API calls, no extra cost beyond the subscription I already have

📋 **Returns a structured review** with a summary, risks, severity-ranked suggestions (critical / warning / suggestion), and a fully formatted GitLab comment

✅ **Lets you approve, comment, and merge** directly from the terminal

---

The part I enjoyed building most was the **Watcher mode**: it runs in the background, polls GitLab every N minutes, and when it detects a new MR — Windows notification, automatic analysis, comment posted. Zero manual interaction.

To avoid wasting tokens, I built a **smart LLM selector**: it tracks estimated monthly token usage per provider and automatically routes to the one with the most remaining capacity. If one hits the limit, it falls back to the other.

---

**Stack:** TypeScript + tsx (no build step), GitLab API v4, Claude CLI, Gemini CLI

**Available on GitHub:** [github.com/your-username/mr-reviewer](#)

If you also use GitLab with Claude or Gemini locally, this might be useful. Contributions welcome!
