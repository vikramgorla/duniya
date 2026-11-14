FROM node:22-slim
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PANEL_HOST=0.0.0.0 \
    PANEL_PORT=8080 \
    DUNIYA_INSTALL=docker
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY src ./src
COPY templates ./templates
COPY plugins ./plugins
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--max-old-space-size=384", "--disable-warning=ExperimentalWarning", "src/index.js"]
