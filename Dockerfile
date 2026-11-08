FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json ./
COPY src/ ./src/
RUN mkdir -p /app/data && chown node:node /app/data
ENV HOST=0.0.0.0 PORT=8080
USER node
EXPOSE 8080
CMD ["node", "src/server.ts"]
