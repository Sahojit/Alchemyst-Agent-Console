FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
EXPOSE 4747
ENV MODE=normal
CMD ["node", "server.js"]
