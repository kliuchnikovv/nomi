# Build stage
FROM golang:1.24-alpine AS builder

WORKDIR /app

# Install git and ca-certificates for private repos
RUN apk add --no-cache git ca-certificates

# Copy go mod files
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build a static binary (runs on the debian final image without libc deps)
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o out ./cmd/controller/main.go

# Final stage — this image IS the sandbox: commands run as subprocesses inside it,
# so the agent toolchain must be present here.
FROM debian:bookworm-slim

# Preinstalled toolchain available to the agent's sandbox commands.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
        python3 \
        python3-pip \
        python3-venv \
        nodejs \
        npm \
        build-essential \
    && rm -rf /var/lib/apt/lists/*

# Non-root user that sandbox subprocesses run as (matches SANDBOX_UID/GID=1000).
RUN useradd --uid 1000 --create-home --shell /bin/bash sandbox \
    && mkdir -p /sandboxes \
    && chown sandbox:sandbox /sandboxes

WORKDIR /app

# Copy the controller binary from the builder.
COPY --from=builder /app/out .

# The controller itself runs as root so it can drop privileges to SANDBOX_UID/GID
# (1000) per command. Workspaces live under /sandboxes.
ENV SANDBOX_BACKEND=local \
    SANDBOX_ROOT=/sandboxes \
    SANDBOX_UID=1000 \
    SANDBOX_GID=1000

# Expose port (Railway will assign PORT env var)
EXPOSE 8090

# Run the binary
# Note: Railway sets PORT env variable, app reads it
CMD ["./out"]
