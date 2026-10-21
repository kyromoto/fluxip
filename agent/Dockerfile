# Minimal agent image (specs/008-traefik-provider-config, optional): just the static binary and CA certificates.
# Build:  docker buildx build --platform linux/amd64,linux/arm64 --build-arg VERSION=1.0.0 -f agent/Dockerfile .
FROM --platform=$BUILDPLATFORM golang:1.25 AS build
ARG TARGETOS=linux
ARG TARGETARCH
ARG VERSION=dev
WORKDIR /src
COPY agent/go.mod agent/go.sum ./
RUN go mod download
COPY agent/ ./
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags "-s -w -X main.version=$VERSION" -o /out/fluxip-agent ./cmd/fluxip-agent

FROM scratch
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /out/fluxip-agent /fluxip-agent
ENV FLUXIP_TEMPLATES_DIR=/templates FLUXIP_OUTPUT_DIR=/out
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD ["/fluxip-agent", "health"]
ENTRYPOINT ["/fluxip-agent"]
CMD ["run"]
