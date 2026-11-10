FROM node:24-bookworm-slim AS dependencies

WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci

FROM node:24-bookworm-slim AS builder

ARG API_ORIGIN=http://api:4000
ARG VCS_REF=unknown
ARG GIT_SHA=unknown
ARG BUILD_TIME=unknown
ENV API_ORIGIN=$API_ORIGIN \
    NEXT_TELEMETRY_DISABLED=1

WORKDIR /app/web
COPY --from=dependencies /app/web/node_modules ./node_modules
COPY web/ ./
RUN printf '{"commit":"%s","builtAt":"%s"}' "$GIT_SHA" "$BUILD_TIME" > public/version.json && npm run build

FROM node:24-bookworm-slim AS runtime

ARG API_ORIGIN=http://api:4000
ARG VCS_REF=unknown
LABEL org.opencontainers.image.source="https://github.com/erenntokgoz/kasam360" \
      org.opencontainers.image.revision="$VCS_REF"

# API_ORIGIN çalışma anında da gerekli; builder aşamasındaki ENV yalnız build'de kalır.
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    NEXT_TELEMETRY_DISABLED=1 \
    API_ORIGIN=$API_ORIGIN

WORKDIR /app
COPY --from=builder --chown=node:node /app/web/public ./public
COPY --from=builder --chown=node:node /app/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/web/.next/static ./.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
