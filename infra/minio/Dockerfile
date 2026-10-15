# syntax=docker/dockerfile:1.7
# MinIO server and client built from source at pinned module versions (MinIO no longer publishes community
# container images). Pin updates deliberately: check https://proxy.golang.org/github.com/minio/minio/@latest
ARG GO_IMAGE=golang:1.24.13-alpine
ARG ALPINE_IMAGE=alpine:3.22
ARG MINIO_VERSION=v0.0.0-20260212201848-7aac2a2c5b7c
ARG MC_VERSION=v0.0.0-20251106162529-77f82e18b540

FROM ${GO_IMAGE} AS build
ARG MINIO_VERSION
ARG MC_VERSION
ENV CGO_ENABLED=0 GOBIN=/out GOTOOLCHAIN=local
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=secret,id=build_ca,required=false \
    if [ -s /run/secrets/build_ca ]; then export SSL_CERT_FILE=/run/secrets/build_ca; fi; \
    go install -trimpath -ldflags "-s -w" "github.com/minio/minio@${MINIO_VERSION}" \
 && go install -trimpath -ldflags "-s -w" "github.com/minio/mc@${MC_VERSION}"

FROM ${ALPINE_IMAGE}
RUN addgroup -S minio && adduser -S -G minio -h /home/minio minio && mkdir -p /data && chown minio:minio /data
COPY --from=build /out/minio /out/mc /usr/local/bin/
COPY init-bucket.sh /usr/local/bin/sqms-init-bucket
USER minio
EXPOSE 9000 9001
ENTRYPOINT ["minio"]
CMD ["server", "/data", "--console-address", ":9001"]
