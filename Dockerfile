FROM node:22-slim
WORKDIR /app
# better-sqlite3 embarque ses binaires précompilés (voir .npmrc : pas de compilation à l'installation).
COPY package*.json .npmrc ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
ENV NODE_ENV=production PORT=3000 DB_PATH=/data/manager.db
VOLUME /data
EXPOSE 3000
USER node
CMD ["node", "server/index.js"]
