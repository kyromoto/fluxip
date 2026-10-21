package session

import (
	"context"
	"io"
	"log/slog"
	"net"
	"sync"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"

	pb "github.com/fluxip/fluxip/agent/internal/pb/fluxip/agent/v1"
)

type fakeServer struct {
	pb.UnimplementedAgentSessionServer
	mu       sync.Mutex
	reject   error
	reports  []*pb.Report
	hellos   []*pb.Hello
	md       metadata.MD
	snapshot *pb.Snapshot
}

func (f *fakeServer) Session(stream pb.AgentSession_SessionServer) error {
	f.mu.Lock()
	reject := f.reject
	f.mu.Unlock()
	if reject != nil {
		return reject
	}
	md, _ := metadata.FromIncomingContext(stream.Context())
	f.mu.Lock()
	f.md = md
	f.mu.Unlock()
	first, err := stream.Recv()
	if err != nil {
		return err
	}
	f.mu.Lock()
	f.hellos = append(f.hellos, first.GetHello())
	snapshot := f.snapshot
	f.mu.Unlock()
	if err := stream.Send(&pb.Envelope{Body: &pb.Envelope_Hello{Hello: &pb.Hello{AcceptedVersion: 1, HeartbeatSeconds: 30, ProviderName: "Test"}}}); err != nil {
		return err
	}
	if snapshot != nil {
		if err := stream.Send(&pb.Envelope{Body: &pb.Envelope_Snapshot{Snapshot: snapshot}}); err != nil {
			return err
		}
	}
	for {
		env, err := stream.Recv()
		if err != nil {
			return nil
		}
		if r := env.GetReport(); r != nil {
			f.mu.Lock()
			f.reports = append(f.reports, r)
			f.mu.Unlock()
		}
	}
}

type recordingHandler struct {
	mu           sync.Mutex
	connected    int
	disconnected int
	snapshots    []*pb.Snapshot
}

func (h *recordingHandler) OnConnected(*pb.Hello) { h.mu.Lock(); h.connected++; h.mu.Unlock() }
func (h *recordingHandler) OnDisconnected(error)  { h.mu.Lock(); h.disconnected++; h.mu.Unlock() }
func (h *recordingHandler) OnSnapshot(_ context.Context, s *pb.Snapshot) *pb.Report {
	h.mu.Lock()
	h.snapshots = append(h.snapshots, s)
	h.mu.Unlock()
	return &pb.Report{Version: s.GetVersion(), CorrelationId: s.GetCorrelationId(), Result: pb.Report_RESULT_OK}
}

func startServer(t *testing.T, f *fakeServer) string {
	t.Helper()
	lis, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	srv := grpc.NewServer()
	pb.RegisterAgentSessionServer(srv, f)
	go srv.Serve(lis)
	t.Cleanup(srv.Stop)
	return lis.Addr().String()
}

func newClient(target string, h Handler) *Client {
	return NewClient(Options{
		Target: target, UseTLS: false, ProviderID: "prov-1", Token: "fxt_secret", AgentVersion: "9.9.9",
		MaxOffline: time.Hour, MinBackoff: 10 * time.Millisecond, MaxBackoff: 40 * time.Millisecond, AuthRetry: 30 * time.Millisecond,
		Log: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}, h)
}

func eventually(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestClientSendsCredentialsReceivesSnapshotAndReports(t *testing.T) {
	f := &fakeServer{snapshot: &pb.Snapshot{Version: 7, CorrelationId: "corr-7"}}
	h := &recordingHandler{}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go newClient(startServer(t, f), h).Run(ctx)

	eventually(t, "report", func() bool { f.mu.Lock(); defer f.mu.Unlock(); return len(f.reports) == 1 })
	f.mu.Lock()
	defer f.mu.Unlock()
	if got := f.md.Get("authorization"); len(got) != 1 || got[0] != "Bearer fxt_secret" {
		t.Errorf("authorization = %v", got)
	}
	if got := f.md.Get("x-fluxip-provider"); len(got) != 1 || got[0] != "prov-1" {
		t.Errorf("provider = %v", got)
	}
	if f.hellos[0].GetProtocolVersion() != ProtocolVersion || f.hellos[0].GetAgentVersion() != "9.9.9" || f.hellos[0].GetMaxOfflineSeconds() != 3600 {
		t.Errorf("hello = %v", f.hellos[0])
	}
	if f.reports[0].GetVersion() != 7 || f.reports[0].GetCorrelationId() != "corr-7" {
		t.Errorf("report = %v", f.reports[0])
	}
}

func TestClientRetriesAfterRejectionWithoutRestart(t *testing.T) {
	f := &fakeServer{reject: status.Error(codes.Unauthenticated, "invalid or revoked token for this agent address")}
	h := &recordingHandler{}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go newClient(startServer(t, f), h).Run(ctx)

	time.Sleep(100 * time.Millisecond)
	h.mu.Lock()
	if h.connected != 0 || len(h.snapshots) != 0 {
		t.Fatal("a rejected agent must not be treated as connected")
	}
	h.mu.Unlock()

	// The token gets fixed on the server side; the running agent picks it up on the next slow retry.
	f.mu.Lock()
	f.reject = nil
	f.mu.Unlock()
	eventually(t, "connection after the credential was fixed", func() bool { h.mu.Lock(); defer h.mu.Unlock(); return h.connected > 0 })
}

func TestClientReconnectsAndReportsDisconnect(t *testing.T) {
	f := &fakeServer{}
	h := &recordingHandler{}
	lis, _ := net.Listen("tcp", "127.0.0.1:0")
	srv := grpc.NewServer()
	pb.RegisterAgentSessionServer(srv, f)
	go srv.Serve(lis)
	target := lis.Addr().String()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go newClient(target, h).Run(ctx)
	eventually(t, "first connection", func() bool { h.mu.Lock(); defer h.mu.Unlock(); return h.connected == 1 })

	srv.Stop()
	eventually(t, "disconnect callback", func() bool { h.mu.Lock(); defer h.mu.Unlock(); return h.disconnected == 1 })

	lis2, err := net.Listen("tcp", target)
	if err != nil {
		t.Skipf("port not reusable: %v", err)
	}
	srv2 := grpc.NewServer()
	pb.RegisterAgentSessionServer(srv2, f)
	go srv2.Serve(lis2)
	defer srv2.Stop()
	eventually(t, "second connection", func() bool { h.mu.Lock(); defer h.mu.Unlock(); return h.connected == 2 })
}

func TestBackoffGrowsExponentiallyWithJitter(t *testing.T) {
	mid := func() float64 { return 0.5 }
	min, max := time.Second, time.Minute
	want := []time.Duration{time.Second, 2 * time.Second, 4 * time.Second, 8 * time.Second, 16 * time.Second, 32 * time.Second, time.Minute, time.Minute}
	for i, w := range want {
		if got := Backoff(i, min, max, mid); got != w {
			t.Errorf("attempt %d: %v, want %v", i, got, w)
		}
	}
	if got := Backoff(0, min, max, func() float64 { return 0 }); got != 800*time.Millisecond {
		t.Errorf("low jitter = %v", got)
	}
	if got := Backoff(0, min, max, func() float64 { return 1 }); got != 1200*time.Millisecond {
		t.Errorf("high jitter = %v", got)
	}
}
