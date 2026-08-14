FROM node:20-bookworm-slim

WORKDIR /workspace

RUN corepack enable

COPY . .

RUN pnpm install --frozen-lockfile

RUN pnpm exec nx build api

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "apps/api/dist/main.js"]
