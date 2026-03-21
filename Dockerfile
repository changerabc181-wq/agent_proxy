FROM node:22-alpine

WORKDIR /app

COPY package.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY docs ./docs

ENV PORT=4000

EXPOSE 4000

CMD ["node", "apps/server/src/server.mjs"]

