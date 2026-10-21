// Package health keeps a small volatile status file for container health checks (FR-056).
// The file is diagnostic only: the agent behaves identically without it (FR-042).
package health

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Status is the content of the health file.
type Status struct {
	Connected         bool       `json:"connected"`
	LastConnectedAt   *time.Time `json:"lastConnectedAt,omitempty"`
	DisconnectedSince *time.Time `json:"disconnectedSince,omitempty"`
	LastApplyAt       *time.Time `json:"lastApplyAt,omitempty"`
	LastError         string     `json:"lastError,omitempty"`
	UpdatedAt         time.Time  `json:"updatedAt"`
}

// Writer updates the file atomically. A nil or empty-path Writer is a no-op.
type Writer struct {
	path string
	mu   sync.Mutex
	st   Status
}

// NewWriter creates a writer; the agent starts out disconnected since "now".
func NewWriter(path string, now time.Time) *Writer {
	w := &Writer{path: path}
	w.st.DisconnectedSince = &now
	return w
}

// Update applies fn to the status and persists it.
func (w *Writer) Update(now time.Time, fn func(*Status)) {
	if w == nil || w.path == "" {
		return
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	fn(&w.st)
	w.st.UpdatedAt = now
	data, err := json.Marshal(w.st)
	if err != nil {
		return
	}
	tmp := w.path + ".tmp"
	if err := os.MkdirAll(filepath.Dir(w.path), 0o755); err != nil {
		return
	}
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return
	}
	_ = os.Rename(tmp, w.path)
}

// Check decides whether the agent is healthy: connected, or disconnected for less than maxOffline
// (maxOffline == 0 means never stale, so a disconnected agent is still healthy).
func Check(path string, maxOffline time.Duration, now time.Time) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return errors.New("no health file: the agent is not running or has not started yet")
	}
	var st Status
	if err := json.Unmarshal(data, &st); err != nil {
		return errors.New("health file is unreadable")
	}
	if st.Connected {
		return nil
	}
	if maxOffline == 0 {
		return nil
	}
	if st.DisconnectedSince != nil && now.Sub(*st.DisconnectedSince) > maxOffline {
		return errors.New("disconnected from FluxIP for longer than the maximum offline duration")
	}
	return nil
}
