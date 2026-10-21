// Package session is the agent's side of the FluxIP session protocol (variant A: the agent dials out).
package session

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"sync"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/keepalive"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"

	pb "github.com/fluxip/fluxip/agent/internal/pb/fluxip/agent/v1"
)

// ProtocolVersion is the highest session protocol version this agent speaks.
const ProtocolVersion = 1

// Handler receives what happens on the session. Calls are made from one goroutine at a time per session.
type Handler interface {
	// OnConnected is called after the server's hello arrived.
	OnConnected(hello *pb.Hello)
	// OnSnapshot applies a snapshot and returns the report to send back.
	OnSnapshot(ctx context.Context, snapshot *pb.Snapshot) *pb.Report
	// OnDisconnected is called when a session that had connected ends.
	OnDisconnected(err error)
}

// Options configure a Client.
type Options struct {
	Target       string
	UseTLS       bool
	ProviderID   string
	Token        string
	AgentVersion string
	MaxOffline   time.Duration
	// ResyncEvery is how often the agent asks for the current state even if nothing changed (FR-052).
	ResyncEvery time.Duration
	// Backoff bounds for transient failures.
	MinBackoff time.Duration
	MaxBackoff time.Duration
	// AuthRetry is the slow retry interval after an authentication or protocol rejection.
	AuthRetry time.Duration
	Log       *slog.Logger
	// DialOptions are appended to the defaults (tests use them to inject a dialer).
	DialOptions []grpc.DialOption
}

func (o *Options) defaults() {
	if o.ResyncEvery == 0 {
		o.ResyncEvery = 15 * time.Minute
	}
	if o.MinBackoff == 0 {
		o.MinBackoff = time.Second
	}
	if o.MaxBackoff == 0 {
		o.MaxBackoff = time.Minute
	}
	if o.AuthRetry == 0 {
		o.AuthRetry = 5 * time.Minute
	}
	if o.Log == nil {
		o.Log = slog.Default()
	}
}

// Client keeps one session to FluxIP alive.
type Client struct {
	opts    Options
	handler Handler
}

// NewClient creates a client.
func NewClient(opts Options, handler Handler) *Client {
	opts.defaults()
	return &Client{opts: opts, handler: handler}
}

// Backoff returns the wait before reconnect attempt n (0-based): exponential from min to max with ±20 % jitter (FR-052).
func Backoff(attempt int, min, max time.Duration, jitter func() float64) time.Duration {
	d := min
	for i := 0; i < attempt && d < max; i++ {
		d *= 2
	}
	if d > max {
		d = max
	}
	factor := 0.8 + 0.4*jitter()
	return time.Duration(float64(d) * factor)
}

// Run connects and reconnects until ctx ends. It never returns an error other than ctx's.
func (c *Client) Run(ctx context.Context) error {
	attempt := 0
	for {
		connected, err := c.runOnce(ctx)
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if connected {
			attempt = 0
		}
		wait := c.waitAfter(err, attempt)
		attempt++
		c.opts.Log.Warn("session ended, will reconnect", "error", describe(err), "retry_in", wait.Round(time.Millisecond).String())
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(wait):
		}
	}
}

func (c *Client) waitAfter(err error, attempt int) time.Duration {
	switch status.Code(err) {
	case codes.Unauthenticated, codes.FailedPrecondition, codes.PermissionDenied:
		// A rejected token or protocol is not transient, but a corrected token must work without a restart.
		return c.opts.AuthRetry
	case codes.ResourceExhausted:
		return c.opts.AuthRetry
	}
	return Backoff(attempt, c.opts.MinBackoff, c.opts.MaxBackoff, rand.Float64)
}

// describe turns gRPC errors into the plain message the server sent, so the log is readable.
func describe(err error) string {
	if err == nil {
		return "closed by server"
	}
	if st, ok := status.FromError(err); ok {
		return fmt.Sprintf("%s: %s", st.Code(), st.Message())
	}
	return err.Error()
}

func (c *Client) dial() (*grpc.ClientConn, error) {
	var creds credentials.TransportCredentials
	if c.opts.UseTLS {
		creds = credentials.NewTLS(&tls.Config{MinVersion: tls.VersionTLS12})
	} else {
		creds = insecure.NewCredentials()
	}
	opts := []grpc.DialOption{
		grpc.WithTransportCredentials(creds),
		grpc.WithKeepaliveParams(keepalive.ClientParameters{Time: 30 * time.Second, Timeout: 10 * time.Second, PermitWithoutStream: true}),
	}
	opts = append(opts, c.opts.DialOptions...)
	return grpc.NewClient(c.opts.Target, opts...)
}

// runOnce runs one session. connected reports whether the server's hello was received.
func (c *Client) runOnce(ctx context.Context) (connected bool, err error) {
	conn, err := c.dial()
	if err != nil {
		return false, err
	}
	defer conn.Close()

	sctx, cancel := context.WithCancel(ctx)
	defer cancel()
	sctx = metadata.AppendToOutgoingContext(sctx,
		"authorization", "Bearer "+c.opts.Token,
		"x-fluxip-provider", c.opts.ProviderID,
		"user-agent", "fluxip-agent/"+c.opts.AgentVersion,
	)
	stream, err := pb.NewAgentSessionClient(conn).Session(sctx)
	if err != nil {
		return false, err
	}

	var sendMu sync.Mutex
	send := func(env *pb.Envelope) error {
		sendMu.Lock()
		defer sendMu.Unlock()
		return stream.Send(env)
	}

	if err := send(&pb.Envelope{Body: &pb.Envelope_Hello{Hello: &pb.Hello{
		ProtocolVersion:   ProtocolVersion,
		AgentVersion:      c.opts.AgentVersion,
		MaxOfflineSeconds: uint32(c.opts.MaxOffline / time.Second),
	}}}); err != nil {
		return false, err
	}

	heartbeat := 30 * time.Second
	lastSeen := time.Now()
	var seenMu sync.Mutex
	touch := func() { seenMu.Lock(); lastSeen = time.Now(); seenMu.Unlock() }
	silentFor := func() time.Duration { seenMu.Lock(); defer seenMu.Unlock(); return time.Since(lastSeen) }

	timerDone := make(chan struct{})
	var timerOnce sync.Once
	startTimers := func() {
		timerOnce.Do(func() {
			go func() {
				defer close(timerDone)
				hb := time.NewTicker(heartbeat)
				defer hb.Stop()
				sync := time.NewTicker(c.opts.ResyncEvery)
				defer sync.Stop()
				var nonce uint64
				for {
					select {
					case <-sctx.Done():
						return
					case <-hb.C:
						if silentFor() > 3*heartbeat {
							c.opts.Log.Warn("server went silent, reconnecting")
							cancel()
							return
						}
						nonce++
						_ = send(&pb.Envelope{Body: &pb.Envelope_Heartbeat{Heartbeat: &pb.Heartbeat{Nonce: nonce}}})
					case <-sync.C:
						_ = send(&pb.Envelope{Body: &pb.Envelope_SyncRequest{SyncRequest: &pb.SyncRequest{}}})
					}
				}
			}()
		})
	}

	defer func() {
		if connected {
			c.handler.OnDisconnected(err)
		}
		cancel()
		timerOnce.Do(func() { close(timerDone) })
		<-timerDone
	}()

	for {
		env, rerr := stream.Recv()
		if rerr != nil {
			if errors.Is(rerr, context.Canceled) && ctx.Err() != nil {
				return connected, ctx.Err()
			}
			return connected, rerr
		}
		touch()
		switch body := env.GetBody().(type) {
		case *pb.Envelope_Hello:
			connected = true
			if s := body.Hello.GetHeartbeatSeconds(); s > 0 {
				heartbeat = time.Duration(s) * time.Second
			}
			c.opts.Log.Info("connected", "provider", body.Hello.GetProviderName(), "protocol", body.Hello.GetAcceptedVersion())
			c.handler.OnConnected(body.Hello)
			startTimers()
		case *pb.Envelope_Snapshot:
			report := c.handler.OnSnapshot(sctx, body.Snapshot)
			if report != nil {
				if serr := send(&pb.Envelope{Body: &pb.Envelope_Report{Report: report}}); serr != nil {
					return connected, serr
				}
			}
		case *pb.Envelope_Heartbeat:
			// Receipt already refreshed lastSeen; the server drives its own heartbeats.
		case *pb.Envelope_Bye:
			c.opts.Log.Info("server ended the session", "reason", body.Bye.GetReason())
			return connected, status.Error(codes.Aborted, body.Bye.GetReason())
		}
	}
}
