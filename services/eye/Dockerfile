FROM node:20-alpine AS build
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build
RUN pnpm prune --prod

FROM node:20-alpine
RUN addgroup -S decree && adduser -S decree -G decree
WORKDIR /app
COPY --from=build --chown=decree:decree /app/build ./build
COPY --from=build --chown=decree:decree /app/node_modules ./node_modules
COPY --from=build --chown=decree:decree /app/package.json ./
USER decree
EXPOSE 3400
ENV PORT=3400 HOST=0.0.0.0
HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3400/healthz || exit 1
CMD ["node", "build"]
