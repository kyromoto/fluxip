// Package agent ties templates, snapshots and files together: it decides what to render and when,
// independent of how the snapshots arrive.
package agent

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/fluxip/fluxip/agent/internal/apply"
	"github.com/fluxip/fluxip/agent/internal/config"
	"github.com/fluxip/fluxip/agent/internal/health"
	pb "github.com/fluxip/fluxip/agent/internal/pb/fluxip/agent/v1"
	"github.com/fluxip/fluxip/agent/internal/render"
)

// Clock abstracts time so the offline timer can be tested. Real implementations must use the monotonic clock.
type Clock interface {
	Now() time.Time
	Since(t time.Time) time.Duration
}

type realClock struct{}

func (realClock) Now() time.Time                  { return time.Now() }
func (realClock) Since(t time.Time) time.Duration { return time.Since(t) }

// RealClock measures with the monotonic reading of time.Now, so wall-clock jumps don't matter (FR-051).
func RealClock() Clock { return realClock{} }

// Checker verifies after writing that Traefik loaded the expected objects (FR-055).
type Checker interface {
	Check(ctx context.Context, expected []string) *pb.TraefikCheck
}

// Agent holds the in-memory state. Nothing here is persisted; the written files are the only state (FR-042).
type Agent struct {
	cfg     config.Config
	log     *slog.Logger
	clock   Clock
	version string
	health  *health.Writer
	checker Checker

	mu             sync.Mutex
	templates      []render.Template
	last           *pb.Snapshot // last snapshot applied successfully
	appliedVersion uint64
	haveApplied    bool
	connected      bool
	offlineSince   time.Time
	stale          bool
}

// New creates an agent. The offline timer starts now: until the first snapshot, the agent is "offline".
func New(cfg config.Config, version string, log *slog.Logger, clock Clock, checker Checker) *Agent {
	if clock == nil {
		clock = RealClock()
	}
	now := clock.Now()
	return &Agent{
		cfg:          cfg,
		log:          log,
		clock:        clock,
		version:      version,
		health:       health.NewWriter(cfg.HealthFile, now),
		checker:      checker,
		offlineSince: now,
	}
}

// Start loads the templates and applies the startup rules (FR-050): existing files stay untouched until the
// first valid snapshot arrives; without any managed file the templates are rendered with empty groups.
// Templates that cannot render with an empty snapshot are a setup error.
func (a *Agent) Start() error {
	templates, err := render.LoadDir(a.cfg.TemplatesDir)
	if err != nil {
		return &config.Error{Code: config.ExitSetup, Msg: err.Error()}
	}
	if _, err := a.renderAll(templates, a.emptyData(false)); err != nil {
		return &config.Error{Code: config.ExitSetup, Msg: fmt.Sprintf("templates do not produce valid output for an empty snapshot: %v", err)}
	}

	a.mu.Lock()
	defer a.mu.Unlock()
	a.templates = templates
	if err := apply.CleanupTemp(a.cfg.OutputDir, a.cfg.FilePrefix); err != nil {
		a.log.Warn("could not clean up leftover temporary files", "error", err)
	}
	managed, err := apply.Managed(a.cfg.OutputDir, a.cfg.FilePrefix)
	if err != nil {
		return &config.Error{Code: config.ExitSetup, Msg: err.Error()}
	}
	if len(managed) > 0 {
		a.log.Info("keeping existing files until FluxIP delivers data", "files", len(managed))
		return nil
	}
	a.log.Info("no generated files yet; rendering templates with empty groups so fallbacks apply")
	if _, err := a.applyLocked(a.emptyData(false)); err != nil {
		return &config.Error{Code: config.ExitSetup, Msg: err.Error()}
	}
	return nil
}

// Templates returns the active templates (for the check command and tests).
func (a *Agent) Templates() []render.Template {
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]render.Template(nil), a.templates...)
}

func (a *Agent) emptyData(stale bool) render.Data {
	return render.Data{Time: time.Now().UTC(), Stale: stale, Groups: map[string][]render.Entry{}}
}

func dataFrom(s *pb.Snapshot, stale bool) render.Data {
	groups := map[string][]render.Entry{}
	for _, g := range s.GetGroups() {
		for _, e := range g.GetEntries() {
			groups[g.GetKey()] = append(groups[g.GetKey()], render.NewEntry(e.GetDeviceName(), e.GetIps()))
		}
	}
	t, err := time.Parse(time.RFC3339, s.GetGeneratedAt())
	if err != nil {
		t = time.Now().UTC()
	}
	return render.Data{Provider: s.GetProviderName(), Version: s.GetVersion(), Time: t.UTC(), Stale: stale, Groups: groups}
}

func (a *Agent) renderAll(templates []render.Template, data render.Data) ([]apply.Output, error) {
	outputs := make([]apply.Output, 0, len(templates))
	for _, t := range templates {
		content, err := t.Render(data)
		if err != nil {
			return nil, err
		}
		name := a.cfg.FilePrefix + t.OutputName
		if err := apply.Validate(name, content); err != nil {
			return nil, fmt.Errorf("template %q: %w", t.File, err)
		}
		outputs = append(outputs, apply.Output{Name: name, Content: content})
	}
	return outputs, nil
}

func (a *Agent) applyLocked(data render.Data) (apply.Result, error) {
	outputs, err := a.renderAll(a.templates, data)
	if err != nil {
		return apply.Result{}, err
	}
	res, err := apply.Apply(a.cfg.OutputDir, a.cfg.FilePrefix, outputs)
	if err != nil {
		return res, err
	}
	now := a.clock.Now()
	a.health.Update(now, func(s *health.Status) { s.LastApplyAt = &now; s.LastError = "" })
	a.log.Info("files up to date", "written", res.Written, "removed", res.Removed, "stale", data.Stale)
	return res, nil
}

func (a *Agent) templateSums() []*pb.FileSum {
	sums := make([]*pb.FileSum, 0, len(a.templates))
	for _, t := range a.templates {
		sums = append(sums, &pb.FileSum{Name: t.File, Sha256: t.Sum})
	}
	return sums
}

// OnConnected implements session.Handler.
func (a *Agent) OnConnected(_ *pb.Hello) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.connected = true
	now := a.clock.Now()
	a.health.Update(now, func(s *health.Status) {
		s.Connected = true
		s.LastConnectedAt = &now
		s.DisconnectedSince = nil
	})
}

// OnDisconnected implements session.Handler. The offline timer restarts here.
func (a *Agent) OnDisconnected(err error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.connected = false
	a.offlineSince = a.clock.Now()
	now := a.offlineSince
	a.health.Update(now, func(s *health.Status) {
		s.Connected = false
		s.DisconnectedSince = &now
		if err != nil {
			s.LastError = err.Error()
		}
	})
}

// OnSnapshot implements session.Handler: older versions are ignored (FR-053); everything else is rendered,
// validated and written, and the outcome is reported (FR-054).
func (a *Agent) OnSnapshot(ctx context.Context, s *pb.Snapshot) *pb.Report {
	a.mu.Lock()
	defer a.mu.Unlock()

	log := a.log.With("correlation_id", s.GetCorrelationId(), "version", s.GetVersion())
	report := &pb.Report{Version: s.GetVersion(), CorrelationId: s.GetCorrelationId(), AgentVersion: a.version}

	if a.haveApplied && s.GetVersion() < a.appliedVersion {
		log.Info("ignoring snapshot older than the applied version", "applied", a.appliedVersion)
		report.Result = pb.Report_RESULT_IGNORED_STALE
		report.Stale = a.stale
		return report
	}

	res, err := a.applyLocked(dataFrom(s, false))
	if err != nil {
		log.Error("snapshot not applied", "error", err)
		now := a.clock.Now()
		a.health.Update(now, func(st *health.Status) { st.LastError = err.Error() })
		report.Result = pb.Report_RESULT_ERROR
		report.Error = err.Error()
		report.Templates = a.templateSums()
		return report
	}

	a.last = s
	a.appliedVersion = s.GetVersion()
	a.haveApplied = true
	a.stale = false
	a.offlineSince = a.clock.Now()
	log.Info("snapshot applied")

	report.Result = pb.Report_RESULT_OK
	report.Templates = a.templateSums()
	for _, f := range res.Files {
		report.Files = append(report.Files, &pb.FileSum{Name: f.Name, Sha256: f.SHA256})
	}
	if a.checker != nil {
		var expected []string
		for _, t := range a.templates {
			expected = append(expected, t.Expect...)
		}
		if len(expected) > 0 {
			report.TraefikCheck = a.checker.Check(ctx, expected)
		}
	}
	return report
}

// Tick checks the offline timer: once the maximum offline duration passes, the files are rendered again
// with Stale set so templates can stop trusting old addresses (FR-051). Call it periodically.
func (a *Agent) Tick() {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.cfg.MaxOffline <= 0 || a.connected || a.stale {
		return
	}
	if a.clock.Since(a.offlineSince) <= a.cfg.MaxOffline {
		return
	}
	data := a.emptyData(true)
	if a.last != nil {
		data = dataFrom(a.last, true)
	}
	a.log.Warn("offline longer than the maximum; rendering with stale marker", "max_offline", a.cfg.MaxOffline.String())
	if _, err := a.applyLocked(data); err != nil {
		a.log.Error("could not render stale files", "error", err)
		return
	}
	a.stale = true
}

// Reload swaps in changed templates only if they render validly with the last snapshot and with an empty one (FR-057).
func (a *Agent) Reload() error {
	templates, err := render.LoadDir(a.cfg.TemplatesDir)
	if err != nil {
		return err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	check := []render.Data{a.emptyData(false)}
	if a.last != nil {
		check = append(check, dataFrom(a.last, a.stale))
	}
	for _, data := range check {
		if _, err := a.renderAll(templates, data); err != nil {
			return fmt.Errorf("new templates rejected, keeping the previous ones: %w", err)
		}
	}
	a.templates = templates
	data := a.emptyData(a.stale)
	if a.last != nil {
		data = dataFrom(a.last, a.stale)
	}
	if _, err := a.applyLocked(data); err != nil {
		return err
	}
	a.log.Info("templates reloaded", "count", len(templates))
	return nil
}
