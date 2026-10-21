package config

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func env(m map[string]string) func(string) string { return func(k string) string { return m[k] } }

func TestLoadParsesAddressAndDefaults(t *testing.T) {
	cfg, err := Load(nil, env(map[string]string{
		"FLUXIP_ADDRESS": "https://agents.example.com/01JABC",
		"FLUXIP_TOKEN":   "fxt_abc",
	}), io.Discard, true)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Target != "agents.example.com:443" || cfg.ProviderID != "01JABC" || !cfg.UseTLS {
		t.Fatalf("%+v", cfg)
	}
	if cfg.FilePrefix != "fluxip-" || cfg.MaxOffline != 24*time.Hour || cfg.TemplatesDir != "/templates" {
		t.Fatalf("defaults: %+v", cfg)
	}
}

func TestFlagsBeatEnvironment(t *testing.T) {
	cfg, err := Load([]string{"--file-prefix", "x-", "--max-offline", "never"}, env(map[string]string{
		"FLUXIP_ADDRESS": "https://h:8443/p", "FLUXIP_TOKEN": "t", "FLUXIP_FILE_PREFIX": "env-",
	}), io.Discard, true)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.FilePrefix != "x-" || cfg.MaxOffline != 0 || cfg.Target != "h:8443" {
		t.Fatalf("%+v", cfg)
	}
}

func TestTokenFile(t *testing.T) {
	f := filepath.Join(t.TempDir(), "token")
	os.WriteFile(f, []byte("fxt_fromfile\n"), 0o600)
	cfg, err := Load(nil, env(map[string]string{"FLUXIP_ADDRESS": "https://h/p", "FLUXIP_TOKEN_FILE": f}), io.Discard, true)
	if err != nil || cfg.Token != "fxt_fromfile" {
		t.Fatalf("%v %+v", err, cfg)
	}
}

func TestConfigErrorsCarryExitCode2(t *testing.T) {
	cases := map[string]map[string]string{
		"missing address":   {"FLUXIP_TOKEN": "t"},
		"missing token":     {"FLUXIP_ADDRESS": "https://h/p"},
		"plain http":        {"FLUXIP_ADDRESS": "http://h/p", "FLUXIP_TOKEN": "t"},
		"no provider id":    {"FLUXIP_ADDRESS": "https://h", "FLUXIP_TOKEN": "t"},
		"nested path":       {"FLUXIP_ADDRESS": "https://h/a/b", "FLUXIP_TOKEN": "t"},
		"empty prefix":      {"FLUXIP_ADDRESS": "https://h/p", "FLUXIP_TOKEN": "t", "FLUXIP_FILE_PREFIX": "."},
		"bad level":         {"FLUXIP_ADDRESS": "https://h/p", "FLUXIP_TOKEN": "t", "FLUXIP_LOG_LEVEL": "loud"},
		"bad max offline":   {"FLUXIP_ADDRESS": "https://h/p", "FLUXIP_TOKEN": "t", "FLUXIP_MAX_OFFLINE": "soon"},
		"unsupported proto": {"FLUXIP_ADDRESS": "ftp://h/p", "FLUXIP_TOKEN": "t"},
	}
	for name, e := range cases {
		_, err := Load(nil, env(e), io.Discard, true)
		var ce *Error
		if !errors.As(err, &ce) || ce.Code != ExitConfig {
			t.Errorf("%s: got %v", name, err)
		}
	}
}

func TestInsecureAllowsHTTP(t *testing.T) {
	cfg, err := Load([]string{"--insecure"}, env(map[string]string{"FLUXIP_ADDRESS": "http://localhost:8081/p", "FLUXIP_TOKEN": "t"}), io.Discard, true)
	if err != nil || cfg.UseTLS || cfg.Target != "localhost:8081" {
		t.Fatalf("%v %+v", err, cfg)
	}
}

func TestEmptyPrefixIsRejected(t *testing.T) {
	_, err := Load([]string{"--file-prefix", ""}, env(map[string]string{"FLUXIP_FILE_PREFIX": ""}), io.Discard, false)
	// An empty flag value falls back to nothing: the prefix env default does not apply to an explicit empty flag.
	var ce *Error
	if !errors.As(err, &ce) {
		t.Fatalf("expected a config error, got %v", err)
	}
}

func TestCheckDirs(t *testing.T) {
	good := t.TempDir()
	tpl := t.TempDir()
	cfg := Config{TemplatesDir: tpl, OutputDir: good, FilePrefix: "fluxip-"}
	if err := cfg.CheckDirs(); err != nil {
		t.Fatal(err)
	}
	cfg.OutputDir = filepath.Join(good, "missing")
	var ce *Error
	if err := cfg.CheckDirs(); !errors.As(err, &ce) || ce.Code != ExitSetup {
		t.Fatalf("missing output dir: %v", err)
	}
	cfg.OutputDir = good
	cfg.TemplatesDir = filepath.Join(good, "nope")
	if err := cfg.CheckDirs(); !errors.As(err, &ce) || ce.Code != ExitSetup {
		t.Fatalf("missing templates dir: %v", err)
	}
}
