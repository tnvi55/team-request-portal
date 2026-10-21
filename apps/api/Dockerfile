# Production image for the NestJS API. Build context: repository root.
FROM node:24.21.0-alpine AS base
RUN npm install --global pnpm@12.13.0
WORKDIR /repo

FROM base AS build
# Manifests first so the dependency layer is cached until the lockfile changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/contracts/package.json packages/contracts/
COPY packages/database/package.json packages/database/
RUN pnpm install --frozen-lockfile --filter "@trp/api..."
COPY packages/contracts packages/contracts
COPY packages/database packages/database
COPY apps/api apps/api
# The database build runs prisma generate, then compiles the generated clients into dist/.
RUN pnpm --filter @trp/contracts build && pnpm --filter @trp/database build && pnpm --filter @trp/api build
# Self-contained folder with production dependencies only.
RUN pnpm --filter @trp/api deploy --prod --legacy /out

FROM node:24.21.0-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3001
CMD ["node", "dist/main.js"]
