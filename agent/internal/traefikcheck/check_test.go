package traefikcheck

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	pb "github.com/fluxip/fluxip/agent/internal/pb/fluxip/agent/v1"
)

func fast(c *Checker) *Checker { c.retries = 2; c.wait = 5 * time.Millisecond; return c }

func TestAllExpectedObjectsLoaded(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/http/middlewares":
			w.Write([]byte(`[{"name":"admin-allowlist@file"},{"name":"other@docker"}]`))
		case "/api/http/services":
			w.Write([]byte(`[{"name":"homelab@file"}]`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	res := fast(New(srv.URL)).Check(context.Background(), []string{"middleware:admin-allowlist@file", "service:homelab@file"})
	if res.Status != pb.TraefikCheck_STATUS_OK || len(res.Loaded) != 2 || len(res.Missing) != 0 {
		t.Fatalf("%+v", res)
	}
}

func TestMissingObjectsAreListed(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(`[{"name":"a@file"}]`)) }))
	defer srv.Close()
	res := fast(New(srv.URL)).Check(context.Background(), []string{"middleware:a@file", "middleware:b@file", "bogus"})
	if res.Status != pb.TraefikCheck_STATUS_MISSING || len(res.Loaded) != 1 || len(res.Missing) != 2 {
		t.Fatalf("%+v", res)
	}
}

func TestRetriesUntilTraefikHasReloaded(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) < 3 {
			w.Write([]byte(`[]`))
			return
		}
		w.Write([]byte(`[{"name":"a@file"}]`))
	}))
	defer srv.Close()
	c := fast(New(srv.URL))
	c.retries = 5
	if res := c.Check(context.Background(), []string{"middleware:a@file"}); res.Status != pb.TraefikCheck_STATUS_OK {
		t.Fatalf("%+v", res)
	}
}

func TestUnreachableTraefik(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	url := srv.URL
	srv.Close()
	res := fast(New(url)).Check(context.Background(), []string{"middleware:a@file"})
	if res.Status != pb.TraefikCheck_STATUS_UNREACHABLE {
		t.Fatalf("%+v", res)
	}
}

func TestErrorStatusCountsAsUnreachable(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Error(w, "no", 500) }))
	defer srv.Close()
	if res := fast(New(srv.URL)).Check(context.Background(), []string{"middleware:a@file"}); res.Status != pb.TraefikCheck_STATUS_UNREACHABLE {
		t.Fatalf("%+v", res)
	}
}
