FROM node:22-slim
WORKDIR /app
# better-sqlite3 est précompilé pour node:22 ; ces paquets ne servent que si un binaire manque.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
ENV NODE_ENV=production PORT=3000 DB_PATH=/data/manager.db
VOLUME /data
EXPOSE 3000
USER node
CMD ["node", "server/index.js"]
