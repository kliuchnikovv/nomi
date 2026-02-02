# Python Agent Dockerfile
# Build context: repo root (docker-compose context: ., Railway Root Directory: .)
FROM python:3.12-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for caching
COPY back/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code and plugins (repo root)
COPY back/ .
COPY plugins /app/plugins

ENV PLUGINS_DIR=/app/plugins

# Expose port
EXPOSE 7777

# Run with uvicorn on IPv4 (PORT from env on Railway)
CMD uvicorn app:app --host 0.0.0.0 --port ${PORT:-7777}
