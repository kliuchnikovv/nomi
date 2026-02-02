# Python Agent Dockerfile
# Build context: repository root (so api/plugins is available).
# docker-compose: context: ., dockerfile: back/Dockerfile
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

# Copy back source code
COPY back/ .

# Copy plugins from api/ (manifests and server tools)
COPY api/plugins /app/plugins
ENV PLUGINS_DIR=/app/plugins

# Expose port
EXPOSE 7777

# Run with uvicorn on IPv4
CMD uvicorn app:app --host 0.0.0.0 --port ${PORT:-7777}
