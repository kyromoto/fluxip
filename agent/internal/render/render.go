// Package render turns local template files plus a snapshot into configuration file contents.
package render

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/netip"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"text/template"
	"time"
)

// Entry is one device in a group.
type Entry struct {
	Name string
	IPs  []string
	IPv4 []string
	IPv6 []string
}

// Data is everything a template can see (FR-045).
type Data struct {
	Provider string
	Version  uint64
	Time     time.Time
	Stale    bool
	// Groups maps a group key to its entries; a missing key yields an empty list.
	Groups map[string][]Entry
}

// NewEntry derives the per-family lists from the delivered IPs.
func NewEntry(name string, ips []string) Entry {
	e := Entry{Name: name, IPs: append([]string(nil), ips...)}
	for _, ip := range ips {
		addr, err := netip.ParseAddr(ip)
		if err != nil {
			continue
		}
		if addr.Is4() || addr.Is4In6() {
			e.IPv4 = append(e.IPv4, ip)
		} else {
			e.IPv6 = append(e.IPv6, ip)
		}
	}
	return e
}

// Template is one loaded template file.
type Template struct {
	// File is the template file name, e.g. "allowlist.yml.tmpl".
	File string
	// OutputName is the output file name without prefix, e.g. "allowlist.yml".
	OutputName string
	// Ext is the output extension including the dot (".yml", ".yaml" or ".toml").
	Ext string
	// Sum is the SHA-256 of the template source.
	Sum string
	// Expect lists "<type>:<name>@file" objects named by "# fluxip:expect" lines.
	Expect []string

	tmpl *template.Template
}

// SupportedExt reports whether an output extension is one the agent can validate.
func SupportedExt(ext string) bool {
	switch ext {
	case ".yml", ".yaml", ".toml":
		return true
	}
	return false
}

const templateSuffix = ".tmpl"

// Parse builds a Template from its file name and source.
func Parse(file, source string) (Template, error) {
	if !strings.HasSuffix(file, templateSuffix) {
		return Template{}, fmt.Errorf("template %q: file name must end in %s", file, templateSuffix)
	}
	out := strings.TrimSuffix(file, templateSuffix)
	ext := filepath.Ext(out)
	if !SupportedExt(ext) || strings.TrimSuffix(out, ext) == "" {
		return Template{}, fmt.Errorf("template %q: output must be <name>.yml, <name>.yaml or <name>.toml", file)
	}
	t, err := template.New(file).Funcs(Funcs()).Option("missingkey=zero").Parse(source)
	if err != nil {
		return Template{}, fmt.Errorf("template %q: %w", file, err)
	}
	sum := sha256.Sum256([]byte(source))
	return Template{
		File:       file,
		OutputName: out,
		Ext:        ext,
		Sum:        hex.EncodeToString(sum[:]),
		Expect:     parseExpect(source),
		tmpl:       t,
	}, nil
}

func parseExpect(source string) []string {
	var expected []string
	for _, line := range strings.Split(source, "\n") {
		fields := strings.Fields(strings.TrimSpace(line))
		if len(fields) == 4 && fields[0] == "#" && fields[1] == "fluxip:expect" {
			expected = append(expected, fields[2]+":"+fields[3])
		}
	}
	return expected
}

// LoadDir loads every *.tmpl file in dir, sorted by name. A directory without templates is an error.
func LoadDir(dir string) ([]Template, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("templates directory: %w", err)
	}
	var templates []Template
	seen := map[string]string{}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), templateSuffix) {
			continue
		}
		source, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			return nil, fmt.Errorf("template %q: %w", entry.Name(), err)
		}
		t, err := Parse(entry.Name(), string(source))
		if err != nil {
			return nil, err
		}
		if other, dup := seen[t.OutputName]; dup {
			return nil, fmt.Errorf("templates %q and %q produce the same output %q", other, t.File, t.OutputName)
		}
		seen[t.OutputName] = t.File
		templates = append(templates, t)
	}
	if len(templates) == 0 {
		return nil, fmt.Errorf("templates directory %q contains no *%s files", dir, templateSuffix)
	}
	sort.Slice(templates, func(i, j int) bool { return templates[i].File < templates[j].File })
	return templates, nil
}

// Render executes the template. Missing groups are empty, never an error.
func (t Template) Render(data Data) ([]byte, error) {
	if data.Groups == nil {
		data.Groups = map[string][]Entry{}
	}
	var buf bytes.Buffer
	if err := t.tmpl.Execute(&buf, data); err != nil {
		return nil, fmt.Errorf("template %q: %w", t.File, err)
	}
	return buf.Bytes(), nil
}

// Funcs returns the helper functions available to templates.
func Funcs() template.FuncMap {
	return template.FuncMap{
		"cidr":    cidr,
		"cidrs":   cidrs,
		"ipv4":    func(ips []string) []string { return filterFamily(ips, true) },
		"ipv6":    func(ips []string) []string { return filterFamily(ips, false) },
		"join":    func(sep string, items []string) string { return strings.Join(items, sep) },
		"quote":   strconv.Quote,
		"first":   first,
		"default": func(def, value string) string { return orDefault(def, value) },
		"group":   group,
	}
}

func orDefault(def, value string) string {
	if value == "" {
		return def
	}
	return value
}

func first(items []string) string {
	if len(items) == 0 {
		return ""
	}
	return items[0]
}

// cidr renders an address as a host route: /32 for IPv4, /128 for IPv6. Existing prefixes are kept.
func cidr(ip string) string {
	if strings.Contains(ip, "/") {
		return ip
	}
	addr, err := netip.ParseAddr(ip)
	if err != nil {
		return ip
	}
	return netip.PrefixFrom(addr, addr.BitLen()).String()
}

func cidrs(ips []string) []string {
	out := make([]string, 0, len(ips))
	for _, ip := range ips {
		out = append(out, cidr(ip))
	}
	return out
}

func filterFamily(ips []string, v4 bool) []string {
	var out []string
	for _, ip := range ips {
		addr, err := netip.ParseAddr(strings.SplitN(ip, "/", 2)[0])
		if err != nil {
			continue
		}
		if (addr.Is4() || addr.Is4In6()) == v4 {
			out = append(out, ip)
		}
	}
	return out
}

// group flattens a group's entries into one IP list (all devices, all addresses).
func group(groups map[string][]Entry, key string) []string {
	var out []string
	for _, entry := range groups[key] {
		out = append(out, entry.IPs...)
	}
	return out
}
