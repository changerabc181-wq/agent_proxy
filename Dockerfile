FROM node:22-alpine

WORKDIR /app

COPY package.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY docs ./docs

RUN npm install --omit=dev --silent

ENV PORT=4000
# 可选: 首次启动时自动创建管理员账号
# ENV ADMIN_EMAIL=
# ENV ADMIN_PASSWORD=
# ENV ADMIN_DISPLAY_NAME=Admin
# ENV TOKEN_SECRET=

EXPOSE 4000

CMD ["node", "apps/server/src/server.mjs"]

