# Stage 1: Build the management UI SPA
FROM node:24-slim AS spa-build
ARG APP_VERSION=dev
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/ui/package.json packages/ui/
COPY packages/app/package.json packages/app/
RUN npm install -g pnpm@10.0.0 && pnpm install --frozen-lockfile
COPY packages/ui/ packages/ui/
COPY packages/app/ packages/app/
RUN VITE_APP_VERSION="${APP_VERSION}" pnpm --filter @opencode-ai/router-app build

# Stage 2: Build the router
FROM node:24-slim AS router-build
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/router/package.json packages/router/
RUN npm install -g pnpm@10.0.0 && pnpm install --frozen-lockfile
COPY packages/router/ packages/router/
RUN pnpm --filter @opencode-ai/router build

# Stage 3: Final image
FROM node:24-alpine
WORKDIR /app
COPY --from=router-build /repo/packages/router/dist ./dist
COPY --from=spa-build /repo/packages/app/dist ./public
EXPOSE 3000
USER 1000
CMD ["node", "dist/index.js"]
