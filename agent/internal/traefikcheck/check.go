// Package traefikcheck verifies through Traefik's API that the expected objects were loaded (FR-055).
package traefikcheck

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	pb "github.com/fluxip/fluxip/agent/internal/pb/fluxip/agent/v1"
)

// Checker queries the Traefik API.
type Checker struct {
	base    string
	client  *http.Client
	retries int
	wait    time.Duration
}

// New creates a checker for the given API base URL (e.g. http://traefik:8080).
func New(base string) *Checker {
	return &Checker{base: strings.TrimRight(base, "/"), client: &http.Client{Timeout: 3 * time.Second}, retries: 10, wait: time.Second}
}

var endpoints = map[string]string{
	"middleware": "/api/http/middlewares",
	"service":    "/api/http/services",
	"router":     "/api/http/routers",
}

// Check looks for each "<type>:<name>@file" entry, retrying for a short while because Traefik reloads asynchronously.
func (c *Checker) Check(ctx context.Context, expected []string) *pb.TraefikCheck {
	var loaded, missing []string
	reachable := false
	for attempt := 0; attempt <= c.retries; attempt++ {
		loaded, missing = nil, nil
		reachable = true
		cache := map[string]map[string]bool{}
		for _, e := range expected {
			kind, name, ok := strings.Cut(e, ":")
			path := endpoints[kind]
			if !ok || path == "" {
				missing = append(missing, e)
				continue
			}
			names, ok := cache[kind]
			if !ok {
				var err error
				names, err = c.fetch(ctx, path)
				if err != nil {
					reachable = false
					break
				}
				cache[kind] = names
			}
			if names[name] {
				loaded = append(loaded, e)
			} else {
				missing = append(missing, e)
			}
		}
		if reachable && len(missing) == 0 {
			break
		}
		select {
		case <-ctx.Done():
			attempt = c.retries
		case <-time.After(c.wait):
		}
	}
	sort.Strings(loaded)
	sort.Strings(missing)
	switch {
	case !reachable:
		return &pb.TraefikCheck{Status: pb.TraefikCheck_STATUS_UNREACHABLE}
	case len(missing) > 0:
		return &pb.TraefikCheck{Status: pb.TraefikCheck_STATUS_MISSING, Loaded: loaded, Missing: missing}
	default:
		return &pb.TraefikCheck{Status: pb.TraefikCheck_STATUS_OK, Loaded: loaded}
	}
}

func (c *Checker) fetch(ctx context.Context, path string) (map[string]bool, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+path, nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("traefik api: %s", resp.Status)
	}
	var items []struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&items); err != nil {
		return nil, err
	}
	names := make(map[string]bool, len(items))
	for _, it := range items {
		names[it.Name] = true
	}
	return names, nil
}
