# syntax=docker/dockerfile:1

# ---- build ----
FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS build
WORKDIR /app
# pnpm version comes from package.json "packageManager"
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm exec ng build --configuration production

# ---- serve ----
FROM nginx/nginx-unprivileged:1.31-alpine@sha256:86628f2c9eaa5e84e3b98d25e26563c4a4f9b0ead9cf5656da4731d86e0621de
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/dist/stormwatch/browser /usr/share/nginx/html
USER 101
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD ["wget", "-q", "--spider", "http://127.0.0.1:8080/healthz"]
