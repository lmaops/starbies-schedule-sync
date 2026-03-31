FROM node:20-alpine AS frontend
WORKDIR /app
COPY web/package.json web/package-lock.json* ./
RUN npm ci
COPY web/ ./
RUN npm run build
RUN mv dist ../static

FROM golang:1.26.1-alpine3.23 AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=frontend /static ./cmd/app/static
ARG COMMIT_SHA=dev
ARG COMMIT_URL=
RUN go build -ldflags "-X main.CommitSHA=${COMMIT_SHA} -X main.CommitURL=${COMMIT_URL}" -o /app/bin/app ./cmd/app

FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=builder /app/bin/app ./app
EXPOSE 8080
ENTRYPOINT ["./app"]