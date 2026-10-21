package main_test

import (
	"bytes"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"

	pb "github.com/fluxip/fluxip/agent/internal/pb/fluxip/agent/v1"
)

// scriptedServer plays FluxIP: it accepts the agent, sends snapshots on demand and collects reports.
type scriptedServer struct {
	pb.UnimplementedAgentSessionServer
	mu      sync.Mutex
	reports []*pb.Report
	send    chan *pb.Snapshot
	md      metadata.MD
}

func (s *scriptedServer) Session(stream pb.AgentSession_SessionServer) error {
	md, _ := metadata.FromIncomingContext(stream.Context())
	s.mu.Lock()
	s.md = md
	s.mu.Unlock()
	if _, err := stream.Recv(); err != nil {
		return err
	}
	if err := stream.Send(&pb.Envelope{Body: &pb.Envelope_Hello{Hello: &pb.Hello{AcceptedVersion: 1, HeartbeatSeconds: 30, ProviderName: "E2E"}}}); err != nil {
		return err
	}
	go func() {
		for {
			env, err := stream.Recv()
			if err != nil {
				return
			}
			if r := env.GetReport(); r != nil {
				s.mu.Lock()
				s.reports = append(s.reports, r)
				s.mu.Unlock()
			}
		}
	}()
	for {
		select {
		case <-stream.Context().Done():
			return nil
		case snap := <-s.send:
			if err := stream.Send(&pb.Envelope{Body: &pb.Envelope_Snapshot{Snapshot: snap}}); err != nil {
				return err
			}
		}
	}
}

func (s *scriptedServer) reportCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.reports)
}

func eventually(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(8 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func buildAgent(t *testing.T) (string, int64) {
	t.Helper()
	bin := filepath.Join(t.TempDir(), "fluxip-agent")
	cmd := exec.Command("go", "build", "-trimpath", "-ldflags", "-s -w -X main.version=0.0.0-e2e", "-o", bin, "./cmd/fluxip-agent")
	cmd.Env = append(os.Environ(), "CGO_ENABLED=0")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("build: %v\n%s", err, out)
	}
	info, err := os.Stat(bin)
	if err != nil {
		t.Fatal(err)
	}
	return bin, info.Size()
}

// rssKB reads the resident set size of a process from /proc.
func rssKB(t *testing.T, pid int) int {
	t.Helper()
	b, err := os.ReadFile(fmt.Sprintf("/proc/%d/status", pid))
	if err != nil {
		t.Skipf("no /proc: %v", err)
	}
	for _, line := range strings.Split(string(b), "\n") {
		if strings.HasPrefix(line, "VmRSS:") {
			f := strings.Fields(line)
			n, _ := strconv.Atoi(f[1])
			return n
		}
	}
	t.Fatal("VmRSS not found")
	return 0
}

// listeningSockets returns the number of TCP/UDP sockets in LISTEN state that belong to the process (FR-041).
func listeningSockets(t *testing.T, pid int) int {
	t.Helper()
	fds, err := os.ReadDir(fmt.Sprintf("/proc/%d/fd", pid))
	if err != nil {
		t.Skipf("no /proc: %v", err)
	}
	inodes := map[string]bool{}
	for _, fd := range fds {
		link, err := os.Readlink(fmt.Sprintf("/proc/%d/fd/%s", pid, fd.Name()))
		if err == nil && strings.HasPrefix(link, "socket:[") {
			inodes[strings.TrimSuffix(strings.TrimPrefix(link, "socket:["), "]")] = true
		}
	}
	count := 0
	for _, table := range []string{"tcp", "tcp6"} {
		b, err := os.ReadFile("/proc/net/" + table)
		if err != nil {
			continue
		}
		for _, line := range strings.Split(string(b), "\n")[1:] {
			f := strings.Fields(line)
			if len(f) > 9 && f[3] == "0A" && inodes[f[9]] {
				count++
			}
		}
	}
	return count
}

func TestE2E(t *testing.T) {
	bin, size := buildAgent(t)

	// SC-005: the binary stays small.
	if size > 30*1024*1024 {
		t.Errorf("binary is %d bytes, the limit is 30 MB", size)
	}
	t.Logf("binary size: %.1f MB", float64(size)/1024/1024)

	lis, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	srv := &scriptedServer{send: make(chan *pb.Snapshot, 8)}
	gs := grpc.NewServer()
	pb.RegisterAgentSessionServer(gs, srv)
	go gs.Serve(lis)
	defer gs.Stop()

	tpl := t.TempDir()
	out := t.TempDir()
	if o, err := exec.Command(bin, "templates", "--write", tpl).CombinedOutput(); err != nil {
		t.Fatalf("templates: %v\n%s", err, o)
	}
	// A hand-maintained file the agent must never touch.
	manual := filepath.Join(out, "manual.yml")
	os.WriteFile(manual, []byte("http:\n  middlewares:\n    manual: {}\n"), 0o644)

	healthFile := filepath.Join(t.TempDir(), "health")
	var logs bytes.Buffer
	cmd := exec.Command(bin, "run", "--insecure")
	cmd.Env = append(os.Environ(),
		"FLUXIP_ADDRESS=http://"+lis.Addr().String()+"/provider-e2e",
		"FLUXIP_TOKEN=fxt_e2e",
		"FLUXIP_TEMPLATES_DIR="+tpl,
		"FLUXIP_OUTPUT_DIR="+out,
		"FLUXIP_HEALTH_FILE="+healthFile,
	)
	cmd.Stdout = &logs
	cmd.Stderr = &logs
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	exited := make(chan error, 1)
	go func() { exited <- cmd.Wait() }()
	defer func() {
		select {
		case <-exited:
		default:
			cmd.Process.Kill()
		}
	}()

	// Startup renders the fallbacks before FluxIP has said anything (FR-050).
	allow := filepath.Join(out, "fluxip-allowlist.yml")
	eventually(t, "fallback files at startup", func() bool { _, err := os.Stat(allow); return err == nil })
	if b, _ := os.ReadFile(allow); !strings.Contains(string(b), "127.0.0.1/32") {
		t.Fatalf("expected the fallback, got:\n%s", b)
	}

	// A snapshot with data is applied, reported, and logged under its correlation id (SC-006).
	srv.send <- &pb.Snapshot{
		Version: 12, CorrelationId: "corr-e2e-12", ProviderName: "E2E", GeneratedAt: time.Now().UTC().Format(time.RFC3339),
		Groups: []*pb.Group{{Key: "admin-allowlist", Entries: []*pb.Entry{{DeviceName: "home", Ips: []string{"203.0.113.5", "2001:db8::5"}}}}},
	}
	eventually(t, "report", func() bool { return srv.reportCount() >= 1 })
	b, _ := os.ReadFile(allow)
	for _, want := range []string{"203.0.113.5/32", "2001:db8::5/128"} {
		if !strings.Contains(string(b), want) {
			t.Errorf("missing %s in\n%s", want, b)
		}
	}
	srv.mu.Lock()
	r := srv.reports[0]
	md := srv.md
	srv.mu.Unlock()
	if r.Version != 12 || r.CorrelationId != "corr-e2e-12" || r.Result != pb.Report_RESULT_OK || r.AgentVersion != "0.0.0-e2e" {
		t.Errorf("report: %v", r)
	}
	if len(r.Files) != 2 || len(r.Templates) != 2 {
		t.Errorf("checksums: files=%d templates=%d", len(r.Files), len(r.Templates))
	}
	if got := md.Get("authorization"); len(got) != 1 || got[0] != "Bearer fxt_e2e" {
		t.Errorf("authorization = %v", got)
	}
	if got := md.Get("x-fluxip-provider"); len(got) != 1 || got[0] != "provider-e2e" {
		t.Errorf("provider = %v", got)
	}
	if !strings.Contains(logs.String(), `"correlation_id":"corr-e2e-12"`) {
		t.Errorf("agent log lacks the correlation id:\n%s", logs.String())
	}
	if strings.Contains(logs.String(), "fxt_e2e") {
		t.Error("the token must never be logged")
	}

	// An older snapshot is ignored and reported as such (FR-053).
	srv.send <- &pb.Snapshot{Version: 3, CorrelationId: "old", ProviderName: "E2E", GeneratedAt: time.Now().UTC().Format(time.RFC3339)}
	eventually(t, "ignored report", func() bool { return srv.reportCount() >= 2 })
	srv.mu.Lock()
	last := srv.reports[len(srv.reports)-1]
	srv.mu.Unlock()
	if last.Result != pb.Report_RESULT_IGNORED_STALE {
		t.Errorf("old snapshot: %v", last.Result)
	}
	if b2, _ := os.ReadFile(allow); !bytes.Equal(b, b2) {
		t.Error("an older snapshot must not change the file")
	}

	// The foreign file is untouched, and no temporary files are left behind.
	if m, _ := os.ReadFile(manual); !strings.Contains(string(m), "manual: {}") {
		t.Error("the manual file was modified")
	}
	entries, _ := os.ReadDir(out)
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".tmp") {
			t.Errorf("leftover temp file %s", e.Name())
		}
	}

	// SC-005 / FR-041: small footprint, and the agent opens no listening port.
	if rss := rssKB(t, cmd.Process.Pid); rss > 50*1024 {
		t.Errorf("RSS is %d kB, the limit is 50 MB", rss)
	} else {
		t.Logf("idle RSS: %.1f MB", float64(rss)/1024)
	}
	if n := listeningSockets(t, cmd.Process.Pid); n != 0 {
		t.Errorf("the agent listens on %d socket(s); it must only make outgoing connections", n)
	}

	// The health command agrees that a connected agent is fine.
	h := exec.Command(bin, "health")
	h.Env = append(os.Environ(), "FLUXIP_HEALTH_FILE="+healthFile)
	if out, err := h.CombinedOutput(); err != nil {
		t.Errorf("health: %v\n%s", err, out)
	}

	// SIGTERM ends the agent cleanly and quickly.
	cmd.Process.Signal(syscall.SIGTERM)
	select {
	case err := <-exited:
		if err != nil {
			t.Errorf("the agent should exit 0 on SIGTERM, got %v\n%s", err, logs.String())
		}
	case <-time.After(5 * time.Second):
		t.Error("the agent did not stop within 5 s of SIGTERM")
	}
}
