FROM node:20-slim

WORKDIR /app

# Install deps first for layer caching.
COPY package.json ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src

ENV PORT=8090
EXPOSE 8090

CMD ["npm", "start"]
