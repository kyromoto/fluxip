// Command fluxip-agent receives Traefik provider data from FluxIP and keeps Traefik's dynamic
// configuration files up to date (specs/008-traefik-provider-config).
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"time"

	"github.com/fsnotify/fsnotify"

	"github.com/fluxip/fluxip/agent/internal/agent"
	"github.com/fluxip/fluxip/agent/internal/apply"
	"github.com/fluxip/fluxip/agent/internal/config"
	"github.com/fluxip/fluxip/agent/internal/health"
	"github.com/fluxip/fluxip/agent/internal/render"
	"github.com/fluxip/fluxip/agent/internal/session"
	"github.com/fluxip/fluxip/agent/internal/templates"
	"github.com/fluxip/fluxip/agent/internal/traefikcheck"
)

// version is set at build time: -ldflags "-X main.version=1.2.3".
var version = "dev"

func main() {
	os.Exit(run(os.Args[1:], os.Getenv, os.Stdout, os.Stderr))
}

func run(args []string, getenv func(string) string, stdout, stderr io.Writer) int {
	cmd := "run"
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		cmd, args = args[0], args[1:]
	}
	var err error
	switch cmd {
	case "run":
		err = runAgent(args, getenv, stderr)
	case "templates":
		err = runTemplates(args, stdout, stderr)
	case "check":
		err = runCheck(args, getenv, stdout, stderr)
	case "health":
		err = runHealth(args, getenv, stderr)
	case "version":
		fmt.Fprintln(stdout, version)
	case "help", "-h", "--help":
		usage(stdout)
	default:
		usage(stderr)
		return config.ExitConfig
	}
	if err == nil {
		return 0
	}
	var ce *config.Error
	if errors.As(err, &ce) {
		fmt.Fprintf(stderr, "error: %s\n", ce.Msg)
		return ce.Code
	}
	fmt.Fprintf(stderr, "error: %v\n", err)
	return 1
}

func usage(w io.Writer) {
	fmt.Fprint(w, `fluxip-agent <command> [flags]

Commands:
  run        connect to FluxIP, render templates and write Traefik files (default)
  templates  print or write the bundled example templates (--list, --write DIR, NAME)
  check      render all templates with an empty snapshot and validate, without writing
  health     exit 0 if the agent is healthy (for container health checks)
  version    print the version

Configuration is read from FLUXIP_* environment variables or flags; see "run -h".
`)
}

func newLogger(level string, w io.Writer) *slog.Logger {
	var l slog.Level
	switch level {
	case "debug":
		l = slog.LevelDebug
	case "warn":
		l = slog.LevelWarn
	case "error":
		l = slog.LevelError
	default:
		l = slog.LevelInfo
	}
	return slog.New(slog.NewJSONHandler(w, &slog.HandlerOptions{Level: l}))
}

func runAgent(args []string, getenv func(string) string, stderr io.Writer) error {
	cfg, err := config.Load(args, getenv, stderr, true)
	if err != nil {
		return err
	}
	if err := cfg.CheckDirs(); err != nil {
		return err
	}
	log := newLogger(cfg.LogLevel, os.Stdout)

	var checker agent.Checker
	if cfg.TraefikAPI != "" {
		checker = traefikcheck.New(cfg.TraefikAPI)
	}
	a := agent.New(cfg, version, log, agent.RealClock(), checker)
	if err := a.Start(); err != nil {
		return err
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go offlineTimer(ctx, a, cfg)
	go watchTemplates(ctx, a, cfg, log)
	go reloadOnSignal(ctx, a, log)

	log.Info("fluxip-agent starting", "version", version, "provider", cfg.ProviderID, "target", cfg.Target)
	client := session.NewClient(session.Options{
		Target:       cfg.Target,
		UseTLS:       cfg.UseTLS,
		ProviderID:   cfg.ProviderID,
		Token:        cfg.Token,
		AgentVersion: version,
		MaxOffline:   cfg.MaxOffline,
		Log:          log,
	}, a)
	_ = client.Run(ctx)
	log.Info("fluxip-agent stopped")
	return nil
}

// offlineTimer drives the stale rendering (FR-051).
func offlineTimer(ctx context.Context, a *agent.Agent, cfg config.Config) {
	if cfg.MaxOffline <= 0 {
		return
	}
	interval := cfg.MaxOffline / 20
	if interval < time.Second {
		interval = time.Second
	}
	if interval > time.Minute {
		interval = time.Minute
	}
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			a.Tick()
		}
	}
}

func reloadOnSignal(ctx context.Context, a *agent.Agent, log *slog.Logger) {
	ch := make(chan os.Signal, 1)
	signal.Notify(ch, syscall.SIGHUP)
	defer signal.Stop(ch)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ch:
			log.Info("SIGHUP received, reloading templates")
			if err := a.Reload(); err != nil {
				log.Error("template reload failed", "error", err)
			}
		}
	}
}

// watchTemplates reloads when template files change, after a short quiet period (US9).
func watchTemplates(ctx context.Context, a *agent.Agent, cfg config.Config, log *slog.Logger) {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		log.Warn("template watching unavailable; use SIGHUP to reload", "error", err)
		return
	}
	defer w.Close()
	if err := w.Add(cfg.TemplatesDir); err != nil {
		log.Warn("cannot watch the templates directory; use SIGHUP to reload", "error", err)
		return
	}
	var timer *time.Timer
	for {
		select {
		case <-ctx.Done():
			return
		case ev, ok := <-w.Events:
			if !ok {
				return
			}
			if !strings.HasSuffix(ev.Name, ".tmpl") {
				continue
			}
			if timer != nil {
				timer.Stop()
			}
			timer = time.AfterFunc(500*time.Millisecond, func() {
				if err := a.Reload(); err != nil {
					log.Error("template reload failed", "error", err)
				}
			})
		case err, ok := <-w.Errors:
			if !ok {
				return
			}
			log.Warn("template watcher error", "error", err)
		}
	}
}

func runTemplates(args []string, stdout, stderr io.Writer) error {
	var list bool
	var writeDir string
	var names []string
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--list":
			list = true
		case "--write":
			if i+1 >= len(args) {
				return &config.Error{Code: config.ExitConfig, Msg: "--write needs a directory"}
			}
			i++
			writeDir = args[i]
		case "-h", "--help":
			fmt.Fprintln(stdout, "usage: fluxip-agent templates [--list] [--write DIR] [NAME...]")
			return nil
		default:
			names = append(names, args[i])
		}
	}
	if list {
		for _, n := range templates.Names() {
			fmt.Fprintln(stdout, n)
		}
		return nil
	}
	if len(names) == 0 {
		names = templates.Names()
	}
	sort.Strings(names)
	for _, n := range names {
		src, err := templates.Get(n)
		if err != nil {
			return &config.Error{Code: config.ExitConfig, Msg: err.Error()}
		}
		if writeDir == "" {
			if len(names) > 1 {
				fmt.Fprintf(stdout, "# ---- %s ----\n", n)
			}
			fmt.Fprintln(stdout, src)
			continue
		}
		if err := os.MkdirAll(writeDir, 0o755); err != nil {
			return err
		}
		target := filepath.Join(writeDir, n)
		if _, err := os.Stat(target); err == nil {
			fmt.Fprintf(stderr, "skipping %s: already exists\n", target)
			continue
		}
		if err := os.WriteFile(target, []byte(src), 0o644); err != nil {
			return err
		}
		fmt.Fprintf(stdout, "wrote %s\n", target)
	}
	return nil
}

// runCheck renders every template with an empty snapshot and validates the result, without writing anything.
func runCheck(args []string, getenv func(string) string, stdout, stderr io.Writer) error {
	cfg, err := config.Load(args, getenv, stderr, false)
	if err != nil {
		return err
	}
	tpls, err := render.LoadDir(cfg.TemplatesDir)
	if err != nil {
		return &config.Error{Code: config.ExitSetup, Msg: err.Error()}
	}
	data := render.Data{Time: time.Now().UTC(), Groups: map[string][]render.Entry{}}
	failed := false
	for _, t := range tpls {
		out, err := t.Render(data)
		if err == nil {
			err = apply.Validate(cfg.FilePrefix+t.OutputName, out)
		}
		if err != nil {
			fmt.Fprintf(stdout, "FAIL %s: %v\n", t.File, err)
			failed = true
			continue
		}
		fmt.Fprintf(stdout, "ok   %s -> %s%s\n", t.File, cfg.FilePrefix, t.OutputName)
	}
	if failed {
		return &config.Error{Code: config.ExitSetup, Msg: "one or more templates are invalid"}
	}
	return nil
}

func runHealth(args []string, getenv func(string) string, stderr io.Writer) error {
	cfg, err := config.Load(args, getenv, stderr, false)
	if err != nil {
		return err
	}
	if err := health.Check(cfg.HealthFile, cfg.MaxOffline, time.Now()); err != nil {
		return fmt.Errorf("unhealthy: %w", err)
	}
	return nil
}
