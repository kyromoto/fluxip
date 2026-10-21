package agent

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/fluxip/fluxip/agent/internal/config"
	pb "github.com/fluxip/fluxip/agent/internal/pb/fluxip/agent/v1"
)

type fakeClock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *fakeClock) Now() time.Time { c.mu.Lock(); defer c.mu.Unlock(); return c.now }
func (c *fakeClock) Since(t time.Time) time.Duration {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now.Sub(t)
}
func (c *fakeClock) Advance(d time.Duration) { c.mu.Lock(); c.now = c.now.Add(d); c.mu.Unlock() }

const allowTmpl = `http:
  middlewares:
    allow:
      ipAllowList:
        sourceRange:
{{- $ips := cidrs (group .Groups "g") }}
{{- if and $ips (not .Stale) }}
{{- range $ips }}
          - {{ quote . }}
{{- end }}
{{- else }}
          - "127.0.0.1/32"
{{- end }}
`

type env struct {
	t     *testing.T
	tpl   string
	out   string
	clock *fakeClock
	cfg   config.Config
}

func newEnv(t *testing.T, templates map[string]string) *env {
	t.Helper()
	e := &env{t: t, tpl: t.TempDir(), out: t.TempDir(), clock: &fakeClock{now: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}}
	for name, src := range templates {
		if err := os.WriteFile(filepath.Join(e.tpl, name), []byte(src), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	e.cfg = config.Config{TemplatesDir: e.tpl, OutputDir: e.out, FilePrefix: "fluxip-", MaxOffline: time.Hour, LogLevel: "info"}
	return e
}

func (e *env) agent() *Agent {
	return New(e.cfg, "test", slog.New(slog.NewTextHandler(io.Discard, nil)), e.clock, nil)
}

func (e *env) read(name string) string {
	e.t.Helper()
	b, err := os.ReadFile(filepath.Join(e.out, name))
	if err != nil {
		e.t.Fatal(err)
	}
	return string(b)
}

func (e *env) exists(name string) bool {
	_, err := os.Stat(filepath.Join(e.out, name))
	return err == nil
}

func snapshot(version uint64, corr string, ips ...string) *pb.Snapshot {
	s := &pb.Snapshot{Version: version, CorrelationId: corr, ProviderName: "Nord", GeneratedAt: "2026-01-01T00:00:00Z"}
	if len(ips) > 0 {
		s.Groups = []*pb.Group{{Key: "g", Entries: []*pb.Entry{{DeviceName: "dev", Ips: ips}}}}
	}
	return s
}

func TestStartRendersEmptyGroupsWhenNoFilesExist(t *testing.T) {
	e := newEnv(t, map[string]string{"allow.yml.tmpl": allowTmpl})
	if err := e.agent().Start(); err != nil {
		t.Fatal(err)
	}
	if got := e.read("fluxip-allow.yml"); !strings.Contains(got, "127.0.0.1/32") {
		t.Fatalf("fallback expected:\n%s", got)
	}
}

func TestStartKeepsExistingFilesUntouched(t *testing.T) {
	e := newEnv(t, map[string]string{"allow.yml.tmpl": allowTmpl})
	existing := "http:\n  middlewares:\n    allow:\n      ipAllowList:\n        sourceRange:\n          - \"203.0.113.5/32\"\n"
	os.WriteFile(filepath.Join(e.out, "fluxip-allow.yml"), []byte(existing), 0o644)
	if err := e.agent().Start(); err != nil {
		t.Fatal(err)
	}
	if e.read("fluxip-allow.yml") != existing {
		t.Fatal("an agent restart without FluxIP must leave existing files alone (FR-050)")
	}
}

func TestStartRefusesTemplatesThatFailForAnEmptySnapshot(t *testing.T) {
	e := newEnv(t, map[string]string{"bad.yml.tmpl": "http: [unclosed"})
	err := e.agent().Start()
	var ce *config.Error
	if !errors.As(err, &ce) || ce.Code != config.ExitSetup {
		t.Fatalf("expected a setup error, got %v", err)
	}
	if e.exists("fluxip-bad.yml") {
		t.Fatal("nothing may be written for an invalid template")
	}
}

func TestStartFailsWithoutTemplates(t *testing.T) {
	e := newEnv(t, nil)
	if err := e.agent().Start(); err == nil {
		t.Fatal("an empty templates directory is a setup error")
	}
}

func TestSnapshotIsAppliedAndReported(t *testing.T) {
	e := newEnv(t, map[string]string{"allow.yml.tmpl": allowTmpl})
	a := e.agent()
	a.Start()
	r := a.OnSnapshot(context.Background(), snapshot(5, "corr-5", "203.0.113.5"))
	if r.Result != pb.Report_RESULT_OK || r.Version != 5 || r.CorrelationId != "corr-5" || r.AgentVersion != "test" {
		t.Fatalf("report %+v", r)
	}
	if !strings.Contains(e.read("fluxip-allow.yml"), "203.0.113.5/32") {
		t.Fatal("new IP missing")
	}
	if len(r.Files) != 1 || r.Files[0].Name != "fluxip-allow.yml" || len(r.Files[0].Sha256) != 64 {
		t.Fatalf("file sums %+v", r.Files)
	}
	if len(r.Templates) != 1 || r.Templates[0].Name != "allow.yml.tmpl" || len(r.Templates[0].Sha256) != 64 {
		t.Fatalf("template sums %+v", r.Templates)
	}
}

func TestOlderSnapshotIsIgnoredAndEqualOneIsIdempotent(t *testing.T) {
	e := newEnv(t, map[string]string{"allow.yml.tmpl": allowTmpl})
	a := e.agent()
	a.Start()
	a.OnSnapshot(context.Background(), snapshot(10, "c10", "203.0.113.10"))

	old := a.OnSnapshot(context.Background(), snapshot(9, "c9", "203.0.113.9"))
	if old.Result != pb.Report_RESULT_IGNORED_STALE {
		t.Fatalf("result %v", old.Result)
	}
	if strings.Contains(e.read("fluxip-allow.yml"), "203.0.113.9") {
		t.Fatal("an older snapshot must not overwrite a newer one (FR-053)")
	}

	path := filepath.Join(e.out, "fluxip-allow.yml")
	past := time.Now().Add(-time.Hour)
	os.Chtimes(path, past, past)
	same := a.OnSnapshot(context.Background(), snapshot(10, "c10", "203.0.113.10"))
	if same.Result != pb.Report_RESULT_OK {
		t.Fatalf("equal version must be accepted, got %v", same.Result)
	}
	info, _ := os.Stat(path)
	if info.ModTime().After(past.Add(time.Minute)) {
		t.Fatal("unchanged content must not be rewritten")
	}
}

func TestSnapshotWithFailingTemplateChangesNothing(t *testing.T) {
	// A template that is valid for an empty snapshot but breaks once data arrives.
	breaks := "{{ range index .Groups \"g\" }}{{ if eq .Name \"dev\" }}http: [unclosed{{ end }}{{ end }}http:\n  routers: {}\n"
	e := newEnv(t, map[string]string{"allow.yml.tmpl": allowTmpl, "breaks.yml.tmpl": breaks})
	a := e.agent()
	if err := a.Start(); err != nil {
		t.Fatal(err)
	}
	before := e.read("fluxip-allow.yml")
	r := a.OnSnapshot(context.Background(), snapshot(2, "c2", "203.0.113.5"))
	if r.Result != pb.Report_RESULT_ERROR || r.Error == "" {
		t.Fatalf("report %+v", r)
	}
	if e.read("fluxip-allow.yml") != before {
		t.Fatal("all-or-nothing: a valid file must not change when another output is invalid (FR-047)")
	}
	if len(r.Templates) != 2 {
		t.Fatalf("template sums must still be reported: %+v", r.Templates)
	}
}

func TestOfflineTimerRendersStaleOnceAndSnapshotRecovers(t *testing.T) {
	e := newEnv(t, map[string]string{"allow.yml.tmpl": allowTmpl})
	a := e.agent()
	a.Start()
	a.OnConnected(&pb.Hello{})
	a.OnSnapshot(context.Background(), snapshot(1, "c1", "203.0.113.5"))
	a.OnDisconnected(errors.New("network down"))

	e.clock.Advance(59 * time.Minute)
	a.Tick()
	if !strings.Contains(e.read("fluxip-allow.yml"), "203.0.113.5/32") {
		t.Fatal("data must stay valid within the maximum offline duration (SC-003)")
	}

	e.clock.Advance(2 * time.Minute)
	a.Tick()
	stale := e.read("fluxip-allow.yml")
	if strings.Contains(stale, "203.0.113.5") || !strings.Contains(stale, "127.0.0.1/32") {
		t.Fatalf("after the maximum offline duration the stale fallback must apply:\n%s", stale)
	}

	a.OnConnected(&pb.Hello{})
	r := a.OnSnapshot(context.Background(), snapshot(2, "c2", "203.0.113.6"))
	if r.Stale || !strings.Contains(e.read("fluxip-allow.yml"), "203.0.113.6/32") {
		t.Fatal("a fresh snapshot ends the stale state")
	}
}

func TestOfflineTimerNeverFiresWhenConnectedOrDisabled(t *testing.T) {
	e := newEnv(t, map[string]string{"allow.yml.tmpl": allowTmpl})
	a := e.agent()
	a.Start()
	a.OnConnected(&pb.Hello{})
	a.OnSnapshot(context.Background(), snapshot(1, "c1", "203.0.113.5"))
	e.clock.Advance(100 * time.Hour)
	a.Tick()
	if !strings.Contains(e.read("fluxip-allow.yml"), "203.0.113.5/32") {
		t.Fatal("a connected agent is never stale")
	}

	e2 := newEnv(t, map[string]string{"allow.yml.tmpl": allowTmpl})
	e2.cfg.MaxOffline = 0
	b := e2.agent()
	b.Start()
	b.OnSnapshot(context.Background(), snapshot(1, "c1", "203.0.113.5"))
	b.OnDisconnected(nil)
	e2.clock.Advance(1000 * time.Hour)
	b.Tick()
	if !strings.Contains(e2.read("fluxip-allow.yml"), "203.0.113.5/32") {
		t.Fatal("max-offline 'never' must keep data forever (FR-051)")
	}
}

func TestOfflineTimerStartsAtProcessStartWhenNeverConnected(t *testing.T) {
	e := newEnv(t, map[string]string{"allow.yml.tmpl": allowTmpl})
	existing := "http:\n  middlewares:\n    allow:\n      ipAllowList:\n        sourceRange:\n          - \"203.0.113.77/32\"\n"
	os.WriteFile(filepath.Join(e.out, "fluxip-allow.yml"), []byte(existing), 0o644)
	a := e.agent()
	a.Start()
	e.clock.Advance(30 * time.Minute)
	a.Tick()
	if e.read("fluxip-allow.yml") != existing {
		t.Fatal("still inside the window")
	}
	e.clock.Advance(40 * time.Minute)
	a.Tick()
	if strings.Contains(e.read("fluxip-allow.yml"), "203.0.113.77") {
		t.Fatal("files restored from a previous run must also expire when FluxIP never answers")
	}
}

func TestForeignFilesAreNeverTouched(t *testing.T) {
	e := newEnv(t, map[string]string{"allow.yml.tmpl": allowTmpl})
	manual := "http:\n  middlewares:\n    manual: {}\n"
	os.WriteFile(filepath.Join(e.out, "manual.yml"), []byte(manual), 0o644)
	a := e.agent()
	a.Start()
	a.OnSnapshot(context.Background(), snapshot(1, "c1", "203.0.113.5"))
	if e.read("manual.yml") != manual {
		t.Fatal("files without the agent's prefix must stay untouched (FR-049)")
	}
}

func TestRemovedTemplateRemovesItsFile(t *testing.T) {
	e := newEnv(t, map[string]string{"allow.yml.tmpl": allowTmpl, "extra.yml.tmpl": "http:\n  routers: {}\n"})
	a := e.agent()
	a.Start()
	a.OnSnapshot(context.Background(), snapshot(1, "c1", "203.0.113.5"))
	if !e.exists("fluxip-extra.yml") {
		t.Fatal("setup")
	}
	os.Remove(filepath.Join(e.tpl, "extra.yml.tmpl"))
	if err := a.Reload(); err != nil {
		t.Fatal(err)
	}
	if e.exists("fluxip-extra.yml") {
		t.Fatal("the file of a removed template must be removed (US4-5)")
	}
	if !e.exists("fluxip-allow.yml") {
		t.Fatal("other files stay")
	}
}

func TestReloadAcceptsValidAndRejectsInvalidTemplates(t *testing.T) {
	e := newEnv(t, map[string]string{"allow.yml.tmpl": allowTmpl})
	a := e.agent()
	a.Start()
	a.OnSnapshot(context.Background(), snapshot(1, "c1", "203.0.113.5"))

	changed := strings.Replace(allowTmpl, "allow:", "renamed:", 1)
	os.WriteFile(filepath.Join(e.tpl, "allow.yml.tmpl"), []byte(changed), 0o644)
	if err := a.Reload(); err != nil {
		t.Fatal(err)
	}
	if got := e.read("fluxip-allow.yml"); !strings.Contains(got, "renamed:") || !strings.Contains(got, "203.0.113.5/32") {
		t.Fatalf("valid change must apply with the last snapshot:\n%s", got)
	}

	// Valid with data, broken for an empty snapshot: must be rejected (FR-057).
	onlyWithData := `{{ if index .Groups "g" }}http:
  routers: {}
{{ end }}`
	os.WriteFile(filepath.Join(e.tpl, "allow.yml.tmpl"), []byte(onlyWithData), 0o644)
	before := e.read("fluxip-allow.yml")
	if err := a.Reload(); err == nil {
		t.Fatal("a template that is empty for an empty snapshot must be rejected")
	}
	if e.read("fluxip-allow.yml") != before {
		t.Fatal("files must stay when the reload is rejected")
	}

	os.WriteFile(filepath.Join(e.tpl, "allow.yml.tmpl"), []byte("{{ if }}"), 0o644)
	if err := a.Reload(); err == nil {
		t.Fatal("a template with a syntax error must be rejected")
	}
	// The previous template set is still active.
	r := a.OnSnapshot(context.Background(), snapshot(2, "c2", "203.0.113.6"))
	if r.Result != pb.Report_RESULT_OK || !strings.Contains(e.read("fluxip-allow.yml"), "203.0.113.6/32") {
		t.Fatalf("the previous templates must keep working: %+v", r)
	}
}

type fakeChecker struct{ expected []string }

func (f *fakeChecker) Check(_ context.Context, expected []string) *pb.TraefikCheck {
	f.expected = expected
	return &pb.TraefikCheck{Status: pb.TraefikCheck_STATUS_OK, Loaded: expected}
}

func TestTraefikCheckRunsOnlyWhenTemplatesDeclareExpectations(t *testing.T) {
	e := newEnv(t, map[string]string{"allow.yml.tmpl": "# fluxip:expect middleware allow@file\n" + allowTmpl})
	checker := &fakeChecker{}
	a := New(e.cfg, "test", slog.New(slog.NewTextHandler(io.Discard, nil)), e.clock, checker)
	a.Start()
	r := a.OnSnapshot(context.Background(), snapshot(1, "c1", "203.0.113.5"))
	if r.TraefikCheck == nil || r.TraefikCheck.Status != pb.TraefikCheck_STATUS_OK {
		t.Fatalf("check result %+v", r.TraefikCheck)
	}
	if len(checker.expected) != 1 || checker.expected[0] != "middleware:allow@file" {
		t.Fatalf("expected %v", checker.expected)
	}

	plain := newEnv(t, map[string]string{"allow.yml.tmpl": allowTmpl})
	checker2 := &fakeChecker{}
	b := New(plain.cfg, "test", slog.New(slog.NewTextHandler(io.Discard, nil)), plain.clock, checker2)
	b.Start()
	if r := b.OnSnapshot(context.Background(), snapshot(1, "c1", "203.0.113.5")); r.TraefikCheck != nil {
		t.Fatal("no expectations, no check")
	}
}
