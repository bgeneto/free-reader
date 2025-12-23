FROM node:lts-alpine AS build

WORKDIR /app/

COPY . .

RUN corepack enable && corepack prepare pnpm@latest --activate

ARG NEXT_PUBLIC_URL
ARG NEXT_PUBLIC_SITE_NAME
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_LOGODEV_TOKEN

RUN --mount=type=cache,target=/root/.local/share/pnpm \
    pnpm install --prefer-offline && \
    pnpm build

CMD [ "pnpm", "start" ]
EXPOSE 3000
