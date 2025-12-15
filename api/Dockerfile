# Build stage
FROM golang:1.24rc1-alpine AS builder

# Allow downloading newer Go version if go.mod requires it
ENV GOTOOLCHAIN=auto

WORKDIR /app

# Install dependencies
RUN apk add --no-cache git

# Copy go mod files first for caching
COPY go.mod go.sum ./
RUN go mod download

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

# Expose port
EXPOSE 8080

# Run
CMD ["/app/genie-api"]
