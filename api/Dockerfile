# Build stage
FROM golang:1.24rc1-alpine AS builder

# Allow downloading newer Go version if go.mod requires it
ENV GOTOOLCHAIN=auto

WORKDIR /app

# Install dependencies
RUN apk add --no-cache git

# Copy go.mod first (go.sum is optional, will be generated)
COPY go.mod ./
RUN go mod download && go mod verify

# Copy source code
COPY . .

# Build the binary
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /genie-api ./cmd/api/...

# Runtime stage
FROM alpine:3.19

WORKDIR /app

# Install ca-certificates for HTTPS
RUN apk --no-cache add ca-certificates tzdata

# Copy binary from builder
COPY --from=builder /genie-api /app/genie-api

# Copy Railway config
COPY config.railway.yaml /app/config.railway.yaml

# Copy models config
COPY config/models.json /app/config/models.json

# Copy plugins (manifests and server tool modules)
COPY plugins /app/plugins

# Expose port
EXPOSE 8080

# Run
CMD ["/app/genie-api"]
