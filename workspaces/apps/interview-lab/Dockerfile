FROM node:24-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /workspace

# Build context is the repository root, narrowed by Dockerfile.dockerignore.
# Fetch from the lockfile alone so source edits reuse the cached dependency layer.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY . .
RUN pnpm install --offline --frozen-lockfile --filter interview-lab...
RUN pnpm --filter interview-lab build
RUN pnpm --filter interview-lab deploy --prod --legacy /out

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
# Listen on all container interfaces so a published port can reach the app.
ENV HOST=0.0.0.0
ENV PORT=3000
WORKDIR /app
# Root-owned files: the non-root runtime user can read the app but not modify it.
COPY --from=build /out ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/main.js"]
