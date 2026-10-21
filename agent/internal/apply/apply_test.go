package apply

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

const goodYAML = "http:\n  middlewares:\n    a:\n      ipAllowList:\n        sourceRange:\n          - \"203.0.113.1/32\"\n"

func read(t *testing.T, dir, name string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(dir, name))
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestValidate(t *testing.T) {
	ok := map[string]string{"a.yml": goodYAML, "a.yaml": goodYAML, "a.toml": "[http]\nx = 1\n"}
	for name, content := range ok {
		if err := Validate(name, []byte(content)); err != nil {
			t.Errorf("%s: %v", name, err)
		}
	}
	bad := map[string]string{
		"a.yml":  "http: [unclosed",
		"b.yml":  "",
		"c.yml":  "# only a comment\n",
		"d.toml": "x = ",
		"e.toml": "",
		"f.txt":  "x",
	}
	for name, content := range bad {
		if err := Validate(name, []byte(content)); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
}

func TestApplyWritesAtomicallyAndReportsChecksums(t *testing.T) {
	dir := t.TempDir()
	res, err := Apply(dir, "fluxip-", []Output{{Name: "fluxip-a.yml", Content: []byte(goodYAML)}})
	if err != nil {
		t.Fatal(err)
	}
	if read(t, dir, "fluxip-a.yml") != goodYAML {
		t.Fatal("content mismatch")
	}
	if len(res.Files) != 1 || len(res.Files[0].SHA256) != 64 || !reflect.DeepEqual(res.Written, []string{"fluxip-a.yml"}) {
		t.Fatalf("result %+v", res)
	}
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".tmp") {
			t.Errorf("temp file left behind: %s", e.Name())
		}
	}
}

func TestApplySkipsUnchangedFiles(t *testing.T) {
	dir := t.TempDir()
	out := []Output{{Name: "fluxip-a.yml", Content: []byte(goodYAML)}}
	if _, err := Apply(dir, "fluxip-", out); err != nil {
		t.Fatal(err)
	}
	past := time.Now().Add(-time.Hour)
	if err := os.Chtimes(filepath.Join(dir, "fluxip-a.yml"), past, past); err != nil {
		t.Fatal(err)
	}
	res, err := Apply(dir, "fluxip-", out)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Written) != 0 {
		t.Fatalf("unchanged content must not be rewritten: %+v", res)
	}
	info, _ := os.Stat(filepath.Join(dir, "fluxip-a.yml"))
	if !info.ModTime().Equal(past.Truncate(time.Nanosecond)) && info.ModTime().After(past.Add(time.Second)) {
		t.Fatal("modification time changed although nothing was written")
	}
}

func TestApplyIsAllOrNothingOnInvalidOutput(t *testing.T) {
	dir := t.TempDir()
	if _, err := Apply(dir, "fluxip-", []Output{{Name: "fluxip-a.yml", Content: []byte(goodYAML)}}); err != nil {
		t.Fatal(err)
	}
	newer := strings.ReplaceAll(goodYAML, "203.0.113.1", "203.0.113.9")
	_, err := Apply(dir, "fluxip-", []Output{
		{Name: "fluxip-a.yml", Content: []byte(newer)},
		{Name: "fluxip-b.yml", Content: []byte("http: [unclosed")},
	})
	if err == nil {
		t.Fatal("expected an error")
	}
	if read(t, dir, "fluxip-a.yml") != goodYAML {
		t.Fatal("a valid file must stay untouched when another output is invalid")
	}
	if _, err := os.Stat(filepath.Join(dir, "fluxip-b.yml")); !os.IsNotExist(err) {
		t.Fatal("invalid output must not be written")
	}
}

func TestApplyNeverTouchesForeignFiles(t *testing.T) {
	dir := t.TempDir()
	foreign := map[string]string{
		"manual.yml":        "keep: me\n",
		"other-prefix.yml":  "keep: me\n",
		"fluxip-notes.txt":  "not managed ext",
		"FLUXIP-upper.yml":  "keep: me\n",
		"fluxip.yml-backup": "keep",
	}
	for name, content := range foreign {
		os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644)
	}
	if _, err := Apply(dir, "fluxip-", []Output{{Name: "fluxip-a.yml", Content: []byte(goodYAML)}}); err != nil {
		t.Fatal(err)
	}
	for name, content := range foreign {
		if read(t, dir, name) != content {
			t.Errorf("%s was changed", name)
		}
	}
}

func TestApplyRemovesOrphansWithPrefixOnly(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "fluxip-old.yml"), []byte(goodYAML), 0o644)
	os.WriteFile(filepath.Join(dir, "manual.yml"), []byte("keep: me\n"), 0o644)
	res, err := Apply(dir, "fluxip-", []Output{{Name: "fluxip-a.yml", Content: []byte(goodYAML)}})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(res.Removed, []string{"fluxip-old.yml"}) {
		t.Fatalf("removed %v", res.Removed)
	}
	if _, err := os.Stat(filepath.Join(dir, "manual.yml")); err != nil {
		t.Fatal("foreign file removed")
	}
}

func TestApplyRejectsEmptyPrefixAndForeignOutputName(t *testing.T) {
	dir := t.TempDir()
	if _, err := Apply(dir, "", nil); err == nil {
		t.Fatal("empty prefix must be rejected")
	}
	if _, err := Apply(dir, "fluxip-", []Output{{Name: "elsewhere.yml", Content: []byte(goodYAML)}}); err == nil {
		t.Fatal("output without the prefix must be rejected")
	}
}

func TestCleanupTempRemovesOnlyOwnLeftovers(t *testing.T) {
	dir := t.TempDir()
	own := ".fluxip-a.yml.abc.tmp"
	foreign := ".other.tmp"
	os.WriteFile(filepath.Join(dir, own), []byte("x"), 0o644)
	os.WriteFile(filepath.Join(dir, foreign), []byte("x"), 0o644)
	if err := CleanupTemp(dir, "fluxip-"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, own)); !os.IsNotExist(err) {
		t.Fatal("own temp file should be removed")
	}
	if _, err := os.Stat(filepath.Join(dir, foreign)); err != nil {
		t.Fatal("foreign temp file must stay")
	}
}

func TestManagedIgnoresTempAndDirectories(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "fluxip-a.yml"), []byte(goodYAML), 0o644)
	os.WriteFile(filepath.Join(dir, ".fluxip-a.yml.x.tmp"), []byte("x"), 0o644)
	os.Mkdir(filepath.Join(dir, "fluxip-dir.yml"), 0o755)
	got, err := Managed(dir, "fluxip-")
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, []string{"fluxip-a.yml"}) {
		t.Fatalf("got %v", got)
	}
}
