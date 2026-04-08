FROM oven/bun:1 AS dev

WORKDIR /app

COPY package.json ./
RUN bun install

EXPOSE 3000

CMD ["bun", "run", "dev", "--", "--host"]

FROM oven/bun:1 AS builder

WORKDIR /app

COPY package.json ./
RUN bun install

COPY . .

ARG VITE_API_BASE_URL=http://localhost:3001
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN bun run build

FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 3000
