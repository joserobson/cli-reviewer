FROM node:22-bookworm-slim

ENV CODEX_HOME=/home/reviewer/.codex
ENV CLI_REVIEWER_STATE_DIR=/var/lib/cli-reviewer
ENV WEBHOOK_STATE_PATH=/var/lib/cli-reviewer/webhook-state.json
ENV REVIEW_STORE_PATH=/var/lib/cli-reviewer/review-dashboard.json
ENV LLM_USAGE_STORE_PATH=/var/lib/cli-reviewer/llm-usage.json
ENV CLAUDE_CONFIG_DIR=/var/lib/cli-reviewer/claude
ENV PATH=/home/reviewer/.local/bin:${PATH}
ENV DISABLE_AUTOUPDATER=1

# Timezone padrão (pode ser sobrescrito via docker-compose ou runtime)
ENV TZ=America/Sao_Paulo

# Gemini CLI: signal non-interactive / headless mode
ENV GEMINI_NON_INTERACTIVE=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends bash ca-certificates curl gosu tzdata \
    && npm install --global @openai/codex @google/gemini-cli \
    && useradd --create-home --uid 10001 --shell /usr/sbin/nologin reviewer \
    && mkdir -p /home/reviewer/.codex \
    && mkdir -p /var/lib/cli-reviewer/claude \
    && chown -R reviewer:reviewer /home/reviewer \
    && chown -R reviewer:reviewer /var/lib/cli-reviewer \
    && gosu reviewer bash -c 'curl -fsSL https://claude.ai/install.sh | bash' \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY --chown=reviewer:reviewer . .
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 0755 /usr/local/bin/docker-entrypoint.sh \
    && chown reviewer:reviewer /app

EXPOSE 3333 3334

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3333/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["npm", "run", "webhook"]
