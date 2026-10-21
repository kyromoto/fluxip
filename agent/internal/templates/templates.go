// Package templates ships the example templates inside the binary (FR-046).
package templates

import (
	"embed"
	"fmt"
	"io/fs"
	"sort"
)

//go:embed examples/*.tmpl
var examples embed.FS

// Names lists the bundled example template file names.
func Names() []string {
	entries, _ := fs.ReadDir(examples, "examples")
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		names = append(names, e.Name())
	}
	sort.Strings(names)
	return names
}

// Get returns the source of one bundled template.
func Get(name string) (string, error) {
	b, err := examples.ReadFile("examples/" + name)
	if err != nil {
		return "", fmt.Errorf("no bundled template %q (available: %v)", name, Names())
	}
	return string(b), nil
}
