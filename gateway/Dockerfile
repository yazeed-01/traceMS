# Stage 1: build Vue frontend
FROM node:22-alpine AS frontend
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --ignore-scripts
COPY frontend/ ./
RUN npm run build-only

# Stage 2: build Go gateway with embedded static
FROM golang:1.24-alpine AS builder
WORKDIR /app
COPY gateway/go.mod gateway/go.sum ./
RUN go mod download
COPY gateway/*.go ./
# Copy Vue build into static so embed picks it up
COPY --from=frontend /app/dist ./static
RUN go build -o /gateway .

# Run
FROM alpine:3.20
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=builder /gateway .
COPY pipeline.example.yaml ./pipeline.example.yaml
ENV PORT=8080
ENV PIPELINE_CONFIG_PATH=/app/pipeline.yaml
EXPOSE 8080
CMD ["./gateway"]
