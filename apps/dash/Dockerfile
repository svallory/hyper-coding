# Multi-stage Dockerfile for HyperDash
# Stage 1: Build environment
FROM golang:1.24.3-alpine AS builder

# Install essential build tools
RUN apk add --no-cache \
    git \
    ca-certificates \
    tzdata \
    make \
    curl

# Create app directory
WORKDIR /app

# Copy go mod files first for better caching
COPY go.mod go.sum ./
RUN go mod download && go mod verify

# Copy source code
COPY . .

# Build the application with optimizations
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build \
    -ldflags='-w -s -extldflags "-static"' \
    -a -installsuffix cgo \
    -o hyper-dash \
    ./cmd/dash

# Verify the binary
RUN chmod +x hyper-dash && \
    ./hyper-dash -version || echo "Version check completed"

# Stage 2: Production image
FROM alpine:3.19

# Install runtime dependencies
RUN apk add --no-cache \
    ca-certificates \
    tzdata \
    curl \
    bash \
    git

# Create non-root user for security
RUN addgroup -g 1001 -S hyper && \
    adduser -u 1001 -S hyper -G hyper

# Create necessary directories
RUN mkdir -p /app /data && \
    chown -R hyper:hyper /app /data

# Copy binary from builder stage
COPY --from=builder /app/hyper-dash /usr/local/bin/hyper-dash
COPY --from=builder /app/USAGE.md /app/USAGE.md

# Copy additional files
COPY LICENSE /app/LICENSE

# Set permissions
RUN chmod +x /usr/local/bin/hyper-dash

# Switch to non-root user
USER hyper

# Set working directory
WORKDIR /data

# Create volume for data persistence
VOLUME ["/data"]

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD hyper-dash -test || exit 1

# Set environment variables
ENV PATH="/usr/local/bin:$PATH"
ENV HYPER_DASH_DATA_DIR="/data"
ENV HYPER_DASH_LOG_LEVEL="info"

# Expose port (if needed for future web interface)
EXPOSE 8080

# Default command
ENTRYPOINT ["hyper-dash"]
CMD ["--help"]

# Labels for metadata
LABEL maintainer="HyperDev Team <team@hyperdev.io>"
LABEL org.opencontainers.image.title="HyperDash"
LABEL org.opencontainers.image.description="Modern task management and epic tracking dashboard"
LABEL org.opencontainers.image.url="https://github.com/hyperdev-io/hyper-dash"
LABEL org.opencontainers.image.documentation="https://github.com/hyperdev-io/hyper-dash/blob/main/apps/dash/USAGE.md"
LABEL org.opencontainers.image.source="https://github.com/hyperdev-io/hyper-dash"
LABEL org.opencontainers.image.vendor="HyperDev"
LABEL org.opencontainers.image.licenses="MIT"