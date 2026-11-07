FROM node:22.23.4-bookworm-slim AS validate
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run lint && npm run build && npm prune --omit=dev

FROM node:22.23.4-bookworm-slim
WORKDIR /app
COPY --from=validate --chown=node:node /app .
RUN mkdir -p /data/photos /data/documents && chown -R node:node /data && chmod 700 /data/photos /data/documents
ENV NODE_ENV=production PORT=8080 UPLOAD_DIR=/data/photos AUTHORIZATION_DIR=/data/documents
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=20s --start-period=120s CMD node -e "fetch('http://127.0.0.1:8080/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "app.js"]
