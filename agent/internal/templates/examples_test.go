package templates

import (
	"strings"
	"testing"
	"time"

	"github.com/fluxip/fluxip/agent/internal/apply"
	"github.com/fluxip/fluxip/agent/internal/render"
)

func load(t *testing.T, name string) render.Template {
	t.Helper()
	src, err := Get(name)
	if err != nil {
		t.Fatal(err)
	}
	tpl, err := render.Parse(name, src)
	if err != nil {
		t.Fatal(err)
	}
	return tpl
}

func renderValid(t *testing.T, tpl render.Template, data render.Data) string {
	t.Helper()
	out, err := tpl.Render(data)
	if err != nil {
		t.Fatal(err)
	}
	if err := apply.Validate("fluxip-"+tpl.OutputName, out); err != nil {
		t.Fatalf("invalid output: %v\n%s", err, out)
	}
	return string(out)
}

func data(stale bool, groups map[string][]render.Entry) render.Data {
	return render.Data{Provider: "Nord", Version: 3, Time: time.Now(), Stale: stale, Groups: groups}
}

func TestBundledNames(t *testing.T) {
	names := Names()
	if len(names) != 2 || names[0] != "allowlist.yml.tmpl" || names[1] != "upstream.yml.tmpl" {
		t.Fatalf("names = %v", names)
	}
	if _, err := Get("nope"); err == nil {
		t.Fatal("unknown template must be an error")
	}
}

func TestAllowListWithDevices(t *testing.T) {
	out := renderValid(t, load(t, "allowlist.yml.tmpl"), data(false, map[string][]render.Entry{
		"admin-allowlist": {render.NewEntry("home", []string{"203.0.113.5", "2001:db8::1"}), render.NewEntry("office", []string{"198.51.100.7"})},
	}))
	for _, want := range []string{`"203.0.113.5/32"`, `"2001:db8::1/128"`, `"198.51.100.7/32"`, "ipAllowList", "admin-allowlist"} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %s in\n%s", want, out)
		}
	}
	if strings.Contains(out, "127.0.0.1") {
		t.Errorf("fallback must not appear when data exists:\n%s", out)
	}
}

func TestAllowListFallsBackWhenEmptyOrStale(t *testing.T) {
	tpl := load(t, "allowlist.yml.tmpl")
	cases := map[string]render.Data{
		"missing group": data(false, nil),
		"empty group":   data(false, map[string][]render.Entry{"admin-allowlist": {}}),
		"stale data":    data(true, map[string][]render.Entry{"admin-allowlist": {render.NewEntry("home", []string{"203.0.113.5"})}}),
	}
	for name, d := range cases {
		out := renderValid(t, tpl, d)
		if !strings.Contains(out, `"127.0.0.1/32"`) {
			t.Errorf("%s: expected the loopback fallback:\n%s", name, out)
		}
		if strings.Contains(out, "203.0.113.5") {
			t.Errorf("%s: stale or absent data must not be allowed:\n%s", name, out)
		}
		if strings.Contains(out, "sourceRange: []") {
			t.Errorf("%s: never an empty list:\n%s", name, out)
		}
	}
}

func TestUpstreamServers(t *testing.T) {
	tpl := load(t, "upstream.yml.tmpl")
	out := renderValid(t, tpl, data(false, map[string][]render.Entry{
		"homelab": {render.NewEntry("nas", []string{"203.0.113.9", "2001:db8::9"})},
	}))
	if !strings.Contains(out, `url: "http://203.0.113.9:8080"`) || strings.Contains(out, "2001:db8") {
		t.Errorf("only IPv4 upstreams expected:\n%s", out)
	}
	fallback := renderValid(t, tpl, data(false, nil))
	if !strings.Contains(fallback, "127.0.0.1:9") {
		t.Errorf("expected the placeholder upstream:\n%s", fallback)
	}
}

func TestExpectedObjectsAreDeclared(t *testing.T) {
	if got := load(t, "allowlist.yml.tmpl").Expect; len(got) != 1 || got[0] != "middleware:admin-allowlist@file" {
		t.Errorf("allowlist expects %v", got)
	}
	if got := load(t, "upstream.yml.tmpl").Expect; len(got) != 1 || got[0] != "service:homelab@file" {
		t.Errorf("upstream expects %v", got)
	}
}
