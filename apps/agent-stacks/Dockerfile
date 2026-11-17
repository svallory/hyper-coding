# Build context is the repository root: the app's dependencies are locked in the root bun.lock.
#   docker build -f apps/agent-stacks/Dockerfile -t agent-stacks .
FROM node:20-slim AS build
COPY --from=oven/bun:1.3.11 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /repo
COPY . .
# @babel/types is declared in the app only because the @marko/run CLI imports it without listing it;
# the isolated install cannot reach it otherwise. Drop it once a fixed @marko/run is locked.
RUN bun install --frozen-lockfile --ignore-scripts --filter agent-stacks
WORKDIR /repo/apps/agent-stacks
RUN bun run build

FROM nginxinc/nginx-unprivileged:stable-alpine
COPY apps/agent-stacks/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/agent-stacks/dist/public /usr/share/nginx/html
EXPOSE 8080
