// Package config reads the agent configuration from flags and environment variables (contracts/agent-cli.md).
package config

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"net/url"
	"os"
	"strings"
	"time"
)

// Exit codes of the agent process.
const (
	ExitConfig = 2
	ExitSetup  = 3
)

// Config is the validated agent configuration.
type Config struct {
	Address      string
	Token        string
	TemplatesDir string
	OutputDir    string
	FilePrefix   string
	// MaxOffline is the time without a valid snapshot after which data counts as stale. Zero means never.
	MaxOffline time.Duration
	LogLevel   string
	TraefikAPI string
	HealthFile string
	Insecure   bool

	// Derived from Address.
	Target     string // host:port for the gRPC dial
	ProviderID string
	UseTLS     bool
}

// Error is a configuration error carrying the process exit code.
type Error struct {
	Code int
	Msg  string
}

func (e *Error) Error() string { return e.Msg }

func fail(code int, format string, args ...any) error {
	return &Error{Code: code, Msg: fmt.Sprintf(format, args...)}
}

func envOr(getenv func(string) string, key, def string) string {
	if v := getenv(key); v != "" {
		return v
	}
	return def
}

// ParseMaxOffline accepts a Go duration ("30m", "24h") or "never"/"0".
func ParseMaxOffline(v string) (time.Duration, error) {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "never", "0", "":
		return 0, nil
	}
	d, err := time.ParseDuration(v)
	if err != nil || d < 0 {
		return 0, fmt.Errorf("invalid duration %q (use e.g. 30m, 24h or never)", v)
	}
	return d, nil
}

// Load builds the configuration. Parameters win over environment variables. With connect set, the
// address and token are required and validated; commands that never dial (check, health) pass false.
func Load(args []string, getenv func(string) string, errOut io.Writer, connect bool) (Config, error) {
	fs := flag.NewFlagSet("fluxip-agent", flag.ContinueOnError)
	fs.SetOutput(errOut)
	var (
		address    = fs.String("address", envOr(getenv, "FLUXIP_ADDRESS", ""), "agent address, https://host/<providerId> (env FLUXIP_ADDRESS)")
		token      = fs.String("token", envOr(getenv, "FLUXIP_TOKEN", ""), "agent token (env FLUXIP_TOKEN or FLUXIP_TOKEN_FILE)")
		templates  = fs.String("templates-dir", envOr(getenv, "FLUXIP_TEMPLATES_DIR", "/templates"), "template directory")
		output     = fs.String("output-dir", envOr(getenv, "FLUXIP_OUTPUT_DIR", "/out"), "target directory of Traefik's file provider")
		prefix     = fs.String("file-prefix", envOr(getenv, "FLUXIP_FILE_PREFIX", "fluxip-"), "prefix of managed files")
		maxOffline = fs.String("max-offline", envOr(getenv, "FLUXIP_MAX_OFFLINE", "24h"), "offline duration before data counts as stale, or never")
		logLevel   = fs.String("log-level", envOr(getenv, "FLUXIP_LOG_LEVEL", "info"), "debug, info, warn or error")
		traefikAPI = fs.String("traefik-api", envOr(getenv, "FLUXIP_TRAEFIK_API", ""), "Traefik API base URL for the optional load check")
		healthFile = fs.String("health-file", envOr(getenv, "FLUXIP_HEALTH_FILE", "/tmp/fluxip-agent.health"), "volatile status file")
		insecure   = fs.Bool("insecure", envOr(getenv, "FLUXIP_INSECURE", "") == "true", "allow http:// without TLS (local tests only)")
	)
	if err := fs.Parse(args); err != nil {
		return Config{}, fail(ExitConfig, "%v", err)
	}

	cfg := Config{
		Address:      strings.TrimSpace(*address),
		Token:        strings.TrimSpace(*token),
		TemplatesDir: *templates,
		OutputDir:    *output,
		FilePrefix:   *prefix,
		LogLevel:     strings.ToLower(*logLevel),
		TraefikAPI:   strings.TrimRight(*traefikAPI, "/"),
		HealthFile:   *healthFile,
		Insecure:     *insecure,
	}

	d, err := ParseMaxOffline(*maxOffline)
	if err != nil {
		return cfg, fail(ExitConfig, "FLUXIP_MAX_OFFLINE: %v", err)
	}
	cfg.MaxOffline = d
	if err := cfg.checkCommon(); err != nil {
		return cfg, err
	}
	if !connect {
		return cfg, nil
	}

	if cfg.Token == "" {
		if file := getenv("FLUXIP_TOKEN_FILE"); file != "" {
			b, err := os.ReadFile(file)
			if err != nil {
				return cfg, fail(ExitConfig, "cannot read FLUXIP_TOKEN_FILE: %v", err)
			}
			cfg.Token = strings.TrimSpace(string(b))
		}
	}
	if cfg.Address == "" {
		return cfg, fail(ExitConfig, "FLUXIP_ADDRESS is required (the agent address shown in FluxIP)")
	}
	if cfg.Token == "" {
		return cfg, fail(ExitConfig, "FLUXIP_TOKEN (or FLUXIP_TOKEN_FILE) is required")
	}
	return cfg, cfg.parseAddress()
}

func (c *Config) parseAddress() error {
	u, err := url.Parse(c.Address)
	if err != nil || u.Host == "" {
		return fail(ExitConfig, "FLUXIP_ADDRESS %q is not a valid URL like https://agents.example.com/<providerId>", c.Address)
	}
	switch u.Scheme {
	case "https":
		c.UseTLS = true
	case "http":
		if !c.Insecure {
			return fail(ExitConfig, "FLUXIP_ADDRESS uses http://; the connection would be unencrypted. Use https:// (or --insecure for local tests)")
		}
	default:
		return fail(ExitConfig, "FLUXIP_ADDRESS must start with https://")
	}
	c.ProviderID = strings.Trim(u.Path, "/")
	if c.ProviderID == "" || strings.Contains(c.ProviderID, "/") {
		return fail(ExitConfig, "FLUXIP_ADDRESS must end in the provider id, e.g. https://agents.example.com/<providerId>")
	}
	host := u.Host
	if u.Port() == "" {
		if c.UseTLS {
			host += ":443"
		} else {
			host += ":80"
		}
	}
	c.Target = host
	return nil
}

func (c Config) checkCommon() error {
	if c.FilePrefix == "" {
		return fail(ExitConfig, "FLUXIP_FILE_PREFIX must not be empty: the agent only manages files with this prefix")
	}
	if strings.HasPrefix(c.FilePrefix, ".") || strings.ContainsAny(c.FilePrefix, "/\\") {
		return fail(ExitConfig, "FLUXIP_FILE_PREFIX %q must not start with a dot or contain path separators", c.FilePrefix)
	}
	switch c.LogLevel {
	case "debug", "info", "warn", "error":
	default:
		return fail(ExitConfig, "FLUXIP_LOG_LEVEL %q must be debug, info, warn or error", c.LogLevel)
	}
	return nil
}

// CheckDirs verifies the template and output directories (startup errors, exit code 3).
func (c Config) CheckDirs() error {
	info, err := os.Stat(c.TemplatesDir)
	if err != nil {
		return fail(ExitSetup, "templates directory %q is not usable: %v", c.TemplatesDir, err)
	}
	if !info.IsDir() {
		return fail(ExitSetup, "templates directory %q is not a directory", c.TemplatesDir)
	}
	info, err = os.Stat(c.OutputDir)
	if err != nil {
		return fail(ExitSetup, "output directory %q is not usable: %v", c.OutputDir, err)
	}
	if !info.IsDir() {
		return fail(ExitSetup, "output directory %q is not a directory", c.OutputDir)
	}
	probe, err := os.CreateTemp(c.OutputDir, "."+c.FilePrefix+"write-test-*.tmp")
	if err != nil {
		return fail(ExitSetup, "output directory %q is not writable: %v", c.OutputDir, err)
	}
	name := probe.Name()
	probe.Close()
	if err := os.Remove(name); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fail(ExitSetup, "output directory %q: %v", c.OutputDir, err)
	}
	return nil
}
