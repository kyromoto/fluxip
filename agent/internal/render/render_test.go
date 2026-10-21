package render

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func mustParse(t *testing.T, file, src string) Template {
	t.Helper()
	tpl, err := Parse(file, src)
	if err != nil {
		t.Fatal(err)
	}
	return tpl
}

func TestParseNaming(t *testing.T) {
	tpl := mustParse(t, "allowlist.yml.tmpl", "x: 1")
	if tpl.OutputName != "allowlist.yml" || tpl.Ext != ".yml" {
		t.Fatalf("got %+v", tpl)
	}
	for _, bad := range []string{"allowlist.yml", "allowlist.txt.tmpl", ".yml.tmpl", "noext.tmpl"} {
		if _, err := Parse(bad, ""); err == nil {
			t.Errorf("%q should be rejected", bad)
		}
	}
}

func TestParseSyntaxError(t *testing.T) {
	if _, err := Parse("a.yml.tmpl", "{{ if }}"); err == nil {
		t.Fatal("expected a syntax error")
	}
}

func TestCidrHelpers(t *testing.T) {
	cases := map[string]string{
		"203.0.113.5":    "203.0.113.5/32",
		"2001:db8::1":    "2001:db8::1/128",
		"10.0.0.0/8":     "10.0.0.0/8",
		"not-an-address": "not-an-address",
	}
	for in, want := range cases {
		if got := cidr(in); got != want {
			t.Errorf("cidr(%q) = %q, want %q", in, got, want)
		}
	}
	if got := cidrs([]string{"1.1.1.1", "::1"}); !reflect.DeepEqual(got, []string{"1.1.1.1/32", "::1/128"}) {
		t.Errorf("cidrs = %v", got)
	}
}

func TestFamilyFilters(t *testing.T) {
	ips := []string{"1.1.1.1", "2001:db8::1", "2.2.2.2/32"}
	if got := filterFamily(ips, true); !reflect.DeepEqual(got, []string{"1.1.1.1", "2.2.2.2/32"}) {
		t.Errorf("v4 = %v", got)
	}
	if got := filterFamily(ips, false); !reflect.DeepEqual(got, []string{"2001:db8::1"}) {
		t.Errorf("v6 = %v", got)
	}
}

func TestNewEntrySplitsFamilies(t *testing.T) {
	e := NewEntry("nas", []string{"203.0.113.1", "2001:db8::1"})
	if !reflect.DeepEqual(e.IPv4, []string{"203.0.113.1"}) || !reflect.DeepEqual(e.IPv6, []string{"2001:db8::1"}) {
		t.Fatalf("got %+v", e)
	}
}

func TestMissingGroupIsEmptyNotAnError(t *testing.T) {
	tpl := mustParse(t, "a.yml.tmpl", `n: {{ len (group .Groups "nope") }}{{ range index .Groups "nope" }}x{{ end }}`)
	out, err := tpl.Render(Data{})
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(string(out)) != "n: 0" {
		t.Fatalf("got %q", out)
	}
}

func TestRenderUsesAllDataFields(t *testing.T) {
	tpl := mustParse(t, "a.yml.tmpl", `p: {{ quote .Provider }}
v: {{ .Version }}
s: {{ .Stale }}
ips: {{ join "," (cidrs (group .Groups "g")) }}
dev: {{ range index .Groups "g" }}{{ .Name }};{{ end }}`)
	out, err := tpl.Render(Data{
		Provider: "Nord", Version: 7, Stale: true,
		Groups: map[string][]Entry{"g": {NewEntry("a", []string{"1.1.1.1"}), NewEntry("b", []string{"2001:db8::2"})}},
	})
	if err != nil {
		t.Fatal(err)
	}
	want := "p: \"Nord\"\nv: 7\ns: true\nips: 1.1.1.1/32,2001:db8::2/128\ndev: a;b;"
	if string(out) != want {
		t.Fatalf("got\n%s\nwant\n%s", out, want)
	}
}

func TestExpectLines(t *testing.T) {
	tpl := mustParse(t, "a.yml.tmpl", "# fluxip:expect middleware allow@file\nx: 1\n# fluxip:expect service up@file\n")
	if !reflect.DeepEqual(tpl.Expect, []string{"middleware:allow@file", "service:up@file"}) {
		t.Fatalf("got %v", tpl.Expect)
	}
}

func TestLoadDir(t *testing.T) {
	dir := t.TempDir()
	if _, err := LoadDir(dir); err == nil {
		t.Fatal("an empty directory must be an error")
	}
	os.WriteFile(filepath.Join(dir, "b.yml.tmpl"), []byte("b: 1"), 0o644)
	os.WriteFile(filepath.Join(dir, "a.toml.tmpl"), []byte("a = 1"), 0o644)
	os.WriteFile(filepath.Join(dir, "README.md"), []byte("ignored"), 0o644)
	got, err := LoadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].OutputName != "a.toml" || got[1].OutputName != "b.yml" {
		t.Fatalf("got %+v", got)
	}
	os.WriteFile(filepath.Join(dir, "b.yaml.tmpl"), []byte("x: 1"), 0o644)
	os.WriteFile(filepath.Join(dir, "bad.txt.tmpl"), []byte("x"), 0o644)
	if _, err := LoadDir(dir); err == nil {
		t.Fatal("an unsupported extension must be an error")
	}
}
