# Production image for the Next.js web app (standalone output). Build context: repository root.
FROM node:24.21.0-alpine AS base
RUN npm install --global pnpm@12.13.0
WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
RUN pnpm install --frozen-lockfile --filter "@trp/web..."
COPY packages/contracts packages/contracts
COPY apps/web apps/web
RUN pnpm --filter @trp/contracts build && pnpm --filter @trp/web build

FROM node:24.21.0-alpine AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
