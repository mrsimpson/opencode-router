FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json tsconfig.json ./
COPY src/ ./src/
RUN npm install
RUN npx tsc

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/dist/server.js ./src/server.js
COPY static/ ./static/

EXPOSE 7681
USER 1000

CMD ["node", "src/server.js"]
