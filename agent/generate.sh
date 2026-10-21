#!/bin/sh
# Regenerates agent/internal/pb from ../proto. Requires on PATH: buf, protoc-gen-go, protoc-gen-go-grpc
#   go install github.com/bufbuild/buf/cmd/buf@latest
#   go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
#   go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest
set -eu
cd "$(dirname "$0")"
PATH="$PATH:$(go env GOPATH)/bin"
buf generate ../proto --template buf.gen.yaml
