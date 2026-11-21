FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=3022
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY servidor ./servidor
COPY painel ./painel
RUN chown -R node:node /app
USER node
EXPOSE 3022
CMD ["node", "servidor/server.js"]
