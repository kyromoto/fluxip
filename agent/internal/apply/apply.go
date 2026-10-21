// Package apply validates rendered files and replaces them atomically, touching only files with the agent's prefix.
package apply

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	toml "github.com/pelletier/go-toml/v2"
	"gopkg.in/yaml.v3"
)

// Output is one rendered file. Name is the final file name including the prefix.
type Output struct {
	Name    string
	Content []byte
}

// FileSum identifies a written or kept file by content.
type FileSum struct {
	Name   string
	SHA256 string
}

// Result describes what Apply did.
type Result struct {
	Files   []FileSum
	Written []string
	Removed []string
}

func managedExt(name string) bool {
	switch filepath.Ext(name) {
	case ".yml", ".yaml", ".toml":
		return true
	}
	return false
}

// Validate checks that content is a non-empty YAML or TOML document according to the file extension.
// An empty document is rejected on purpose: Traefik must never see an empty allow-list file (SC-004).
func Validate(name string, content []byte) error {
	switch filepath.Ext(name) {
	case ".yml", ".yaml":
		var doc map[string]any
		if err := yaml.Unmarshal(content, &doc); err != nil {
			return fmt.Errorf("%s: invalid YAML: %w", name, err)
		}
		if len(doc) == 0 {
			return fmt.Errorf("%s: rendered document is empty", name)
		}
	case ".toml":
		var doc map[string]any
		if err := toml.Unmarshal(content, &doc); err != nil {
			return fmt.Errorf("%s: invalid TOML: %w", name, err)
		}
		if len(doc) == 0 {
			return fmt.Errorf("%s: rendered document is empty", name)
		}
	default:
		return fmt.Errorf("%s: unsupported file type", name)
	}
	return nil
}

// Managed lists the files in dir that belong to the agent: regular files with the prefix and a managed extension.
// Everything else in dir is never read, changed or deleted (FR-049).
func Managed(dir, prefix string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	var names []string
	for _, entry := range entries {
		if !entry.Type().IsRegular() {
			continue
		}
		if strings.HasPrefix(entry.Name(), prefix) && managedExt(entry.Name()) {
			names = append(names, entry.Name())
		}
	}
	sort.Strings(names)
	return names, nil
}

// CleanupTemp removes leftovers of an interrupted write. Only files named ".<prefix>*.tmp" are touched.
func CleanupTemp(dir, prefix string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		name := entry.Name()
		if entry.Type().IsRegular() && strings.HasPrefix(name, "."+prefix) && strings.HasSuffix(name, ".tmp") {
			if err := os.Remove(filepath.Join(dir, name)); err != nil && !errors.Is(err, os.ErrNotExist) {
				return err
			}
		}
	}
	return nil
}

func sum(content []byte) string {
	s := sha256.Sum256(content)
	return hex.EncodeToString(s[:])
}

// Apply validates every output first and writes nothing if any is invalid (FR-047). Then each file is
// replaced atomically and only if its content changed (FR-048). Managed files without an output are
// removed at the end (FR-049).
func Apply(dir, prefix string, outputs []Output) (Result, error) {
	if prefix == "" {
		return Result{}, errors.New("file prefix must not be empty")
	}
	var result Result
	for _, out := range outputs {
		if !strings.HasPrefix(out.Name, prefix) {
			return result, fmt.Errorf("%s: output name lacks the prefix %q", out.Name, prefix)
		}
		if err := Validate(out.Name, out.Content); err != nil {
			return result, err
		}
	}

	wanted := map[string]bool{}
	for _, out := range outputs {
		wanted[out.Name] = true
		result.Files = append(result.Files, FileSum{Name: out.Name, SHA256: sum(out.Content)})
	}

	for _, out := range outputs {
		target := filepath.Join(dir, out.Name)
		if existing, err := os.ReadFile(target); err == nil && bytes.Equal(existing, out.Content) {
			continue
		}
		if err := writeAtomic(dir, out.Name, out.Content); err != nil {
			return result, fmt.Errorf("%s: %w", out.Name, err)
		}
		result.Written = append(result.Written, out.Name)
	}

	managed, err := Managed(dir, prefix)
	if err != nil {
		return result, err
	}
	for _, name := range managed {
		if wanted[name] {
			continue
		}
		if err := os.Remove(filepath.Join(dir, name)); err != nil && !errors.Is(err, os.ErrNotExist) {
			return result, fmt.Errorf("%s: %w", name, err)
		}
		result.Removed = append(result.Removed, name)
	}
	if len(result.Written) > 0 || len(result.Removed) > 0 {
		if err := syncDir(dir); err != nil {
			return result, err
		}
	}
	return result, nil
}

// writeAtomic writes to ".<name>.<random>.tmp" next to the target, syncs, then renames. The temp name
// has a .tmp extension so Traefik's file provider never loads it, and it starts with a dot so Managed ignores it.
func writeAtomic(dir, name string, content []byte) error {
	var rnd [6]byte
	if _, err := rand.Read(rnd[:]); err != nil {
		return err
	}
	tmpPath := filepath.Join(dir, "."+name+"."+hex.EncodeToString(rnd[:])+".tmp")
	f, err := os.OpenFile(tmpPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return err
	}
	cleanup := func() { _ = os.Remove(tmpPath) }
	if _, err := f.Write(content); err != nil {
		f.Close()
		cleanup()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		cleanup()
		return err
	}
	if err := f.Close(); err != nil {
		cleanup()
		return err
	}
	if err := os.Rename(tmpPath, filepath.Join(dir, name)); err != nil {
		cleanup()
		return err
	}
	return nil
}

func syncDir(dir string) error {
	d, err := os.Open(dir)
	if err != nil {
		return err
	}
	defer d.Close()
	return d.Sync()
}
