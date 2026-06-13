# Node >= 22 provides a global WebSocket, which the railway SDK needs to stream
# exec output (no WebSocket → "No WebSocket implementation found" at exec time).
FROM node:22-slim

WORKDIR /app

# Install deps first for layer caching.
COPY package.json ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src

ENV PORT=8090
EXPOSE 8090

CMD ["npm", "start"]
