FROM node:22-slim
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PANEL_HOST=0.0.0.0 \
    PANEL_PORT=8080 \
    DUNIYA_INSTALL=docker
# git: local tool services can be installed from GitHub (github:owner/repo#ref)
# ffmpeg + bzip2 (043): WhatsApp voice notes (Ogg/Opus) and the optional on-server speech models
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates ffmpeg bzip2 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY src ./src
COPY templates ./templates
COPY releases.json LICENSE ./
COPY bin ./bin
COPY deploy/ops/webconfig.mjs ./deploy/ops/webconfig.mjs
# Command line tool (029): docker compose exec app duniya <command>
RUN printf '#!/bin/sh\nexec node --disable-warning=ExperimentalWarning /app/bin/duniya.js "$@"\n' > /usr/local/bin/duniya && chmod 755 /usr/local/bin/duniya
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--max-old-space-size=384", "--disable-warning=ExperimentalWarning", "src/index.js"]
