package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/fluxip/fluxip/agent/internal/config"
	"github.com/fluxip/fluxip/agent/internal/health"
)

func runCmd(t *testing.T, env map[string]string, args ...string) (int, string, string) {
	t.Helper()
	var out, errOut bytes.Buffer
	code := run(args, func(k string) string { return env[k] }, &out, &errOut)
	return code, out.String(), errOut.String()
}

func TestVersionAndUnknownCommand(t *testing.T) {
	if code, out, _ := runCmd(t, nil, "version"); code != 0 || strings.TrimSpace(out) != version {
		t.Fatalf("%d %q", code, out)
	}
	if code, _, _ := runCmd(t, nil, "frobnicate"); code != config.ExitConfig {
		t.Fatalf("unknown command exit %d", code)
	}
}

func TestRunWithoutConfigurationExplainsWhatIsMissing(t *testing.T) {
	code, _, errOut := runCmd(t, nil, "run")
	if code != config.ExitConfig || !strings.Contains(errOut, "FLUXIP_ADDRESS") {
		t.Fatalf("%d %q", code, errOut)
	}
}

func TestRunRefusesUnusableDirectories(t *testing.T) {
	env := map[string]string{
		"FLUXIP_ADDRESS": "https://agents.example.com/p1", "FLUXIP_TOKEN": "fxt_x",
		"FLUXIP_TEMPLATES_DIR": filepath.Join(t.TempDir(), "missing"), "FLUXIP_OUTPUT_DIR": t.TempDir(),
	}
	code, _, errOut := runCmd(t, env, "run")
	if code != config.ExitSetup || !strings.Contains(errOut, "templates directory") {
		t.Fatalf("missing templates dir: %d %q", code, errOut)
	}

	tpl := t.TempDir()
	env["FLUXIP_TEMPLATES_DIR"] = tpl
	env["FLUXIP_OUTPUT_DIR"] = filepath.Join(t.TempDir(), "missing")
	if code, _, errOut := runCmd(t, env, "run"); code != config.ExitSetup || !strings.Contains(errOut, "output directory") {
		t.Fatalf("missing output dir: %d %q", code, errOut)
	}
}

func TestRunRefusesAnEmptyTemplatesDirectory(t *testing.T) {
	env := map[string]string{
		"FLUXIP_ADDRESS": "https://agents.example.com/p1", "FLUXIP_TOKEN": "fxt_x",
		"FLUXIP_TEMPLATES_DIR": t.TempDir(), "FLUXIP_OUTPUT_DIR": t.TempDir(),
	}
	code, _, errOut := runCmd(t, env, "run")
	if code != config.ExitSetup || !strings.Contains(errOut, "no *.tmpl") {
		t.Fatalf("%d %q", code, errOut)
	}
}

func TestTemplatesCommand(t *testing.T) {
	code, out, _ := runCmd(t, nil, "templates", "--list")
	if code != 0 || !strings.Contains(out, "allowlist.yml.tmpl") || !strings.Contains(out, "upstream.yml.tmpl") {
		t.Fatalf("%d %q", code, out)
	}
	code, out, _ = runCmd(t, nil, "templates", "allowlist.yml.tmpl")
	if code != 0 || !strings.Contains(out, "ipAllowList") {
		t.Fatalf("%d %q", code, out)
	}
	dir := filepath.Join(t.TempDir(), "t")
	if code, _, _ := runCmd(t, nil, "templates", "--write", dir); code != 0 {
		t.Fatal("write failed")
	}
	if _, err := os.Stat(filepath.Join(dir, "upstream.yml.tmpl")); err != nil {
		t.Fatal(err)
	}
	// Existing files are never overwritten.
	os.WriteFile(filepath.Join(dir, "allowlist.yml.tmpl"), []byte("mine"), 0o644)
	_, _, errOut := runCmd(t, nil, "templates", "--write", dir)
	b, _ := os.ReadFile(filepath.Join(dir, "allowlist.yml.tmpl"))
	if string(b) != "mine" || !strings.Contains(errOut, "already exists") {
		t.Fatalf("overwrote %q / %q", b, errOut)
	}
	if code, _, _ := runCmd(t, nil, "templates", "nope.tmpl"); code != config.ExitConfig {
		t.Fatalf("unknown template exit %d", code)
	}
}

func TestCheckCommand(t *testing.T) {
	dir := t.TempDir()
	runCmd(t, nil, "templates", "--write", dir)
	env := map[string]string{"FLUXIP_TEMPLATES_DIR": dir}
	code, out, _ := runCmd(t, env, "check")
	if code != 0 || strings.Count(out, "ok ") != 2 {
		t.Fatalf("%d %q", code, out)
	}
	os.WriteFile(filepath.Join(dir, "broken.yml.tmpl"), []byte("http: [unclosed"), 0o644)
	code, out, _ = runCmd(t, env, "check")
	if code != config.ExitSetup || !strings.Contains(out, "FAIL broken.yml.tmpl") {
		t.Fatalf("%d %q", code, out)
	}
}

func TestHealthCommand(t *testing.T) {
	file := filepath.Join(t.TempDir(), "health")
	env := map[string]string{"FLUXIP_HEALTH_FILE": file, "FLUXIP_MAX_OFFLINE": "1h"}
	if code, _, _ := runCmd(t, env, "health"); code != 1 {
		t.Fatalf("no health file must be unhealthy, got %d", code)
	}
	now := time.Now()
	w := health.NewWriter(file, now)
	w.Update(now, func(s *health.Status) { s.Connected = true })
	if code, _, _ := runCmd(t, env, "health"); code != 0 {
		t.Fatalf("connected must be healthy, got %d", code)
	}
	w.Update(now, func(s *health.Status) {
		s.Connected = false
		past := now.Add(-2 * time.Hour)
		s.DisconnectedSince = &past
	})
	if code, _, _ := runCmd(t, env, "health"); code != 1 {
		t.Fatalf("offline beyond the maximum must be unhealthy, got %d", code)
	}
	env["FLUXIP_MAX_OFFLINE"] = "never"
	if code, _, _ := runCmd(t, env, "health"); code != 0 {
		t.Fatalf("'never' means offline is fine, got %d", code)
	}
}
