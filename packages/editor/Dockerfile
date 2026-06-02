FROM node:22-alpine
WORKDIR /app

# Copy server and static assets
COPY src/server.js ./src/server.js
COPY static/ ./static/

EXPOSE 7681
USER 1000

CMD ["node", "src/server.js"]
