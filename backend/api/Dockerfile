FROM node:24-bookworm-slim AS dependencies

WORKDIR /app/backend/api
COPY backend/api/package.json backend/api/package-lock.json backend/api/.npmrc ./
RUN npm ci --omit=dev

FROM node:24-bookworm-slim AS runtime

ARG VCS_REF=unknown
LABEL org.opencontainers.image.source="https://github.com/erenntokgoz/kasam360" \
      org.opencontainers.image.revision="$VCS_REF"

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000

WORKDIR /app/backend/api
COPY --from=dependencies --chown=node:node /app/backend/api/node_modules ./node_modules
COPY --chown=node:node backend/api/package.json backend/api/package-lock.json ./
COPY --chown=node:node backend/api/src ./src
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "start"]
