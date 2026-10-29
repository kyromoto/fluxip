# Traefik agents

FluxIP can keep dynamic Traefik configuration up to date on remote systems — typically an `ipAllowList` middleware that contains the current IPs of your devices. It only delivers data; **local templates on the agent decide the file format**, so the same mechanism also works for, say, a service whose upstream is a device's IP.

**How it fits together**

1. In the UI, open **Agents** and add one per Traefik host. FluxIP shows the agent address, a token (once) and a start command.
2. On a device, add the action **Traefik configuration**, choose the agent and a *group* (for example `admin-allowlist`). Devices with the same agent and group end up in the same list. A device can deliver to a given agent through one action; it can deliver to several agents.
3. Run the agent next to Traefik. It connects **outbound only** (no open ports), receives a complete snapshot, renders every `*.tmpl` file in its template directory and writes `fluxip-<name>.yml|yaml|toml` into Traefik's file-provider directory.

```bash
fluxip-agent templates --write /etc/fluxip-agent/templates        # allowlist + upstream examples
FLUXIP_ADDRESS=https://agents.example.com/<providerId> FLUXIP_TOKEN=fxt_... \
FLUXIP_TEMPLATES_DIR=/etc/fluxip-agent/templates FLUXIP_OUTPUT_DIR=/etc/traefik/dynamic \
  fluxip-agent run
```

Traefik needs a file provider with `watch: true` on that directory; reference the generated objects as `<name>@file`.

**Safety properties** (all covered by tests): files are replaced atomically and only when the content changed; all templates are validated before any file is touched; only files with the agent's prefix (default `fluxip-`) are ever read, written or deleted; an agent restart without FluxIP keeps the existing files; after `FLUXIP_MAX_OFFLINE` (default 24 h, measured with the monotonic clock) the templates are rendered again with `.Stale` set so old addresses don't stay allowed. The bundled allow-list template falls back to `127.0.0.1/32` for an empty or stale group — Traefik 3 disables a middleware with an empty `sourceRange`, which would make the route answer 404 instead of 403.

**Template data**: `.Provider`, `.Version`, `.Time`, `.Stale`, `.Groups` (map of group → entries with `.Name`, `.IPs`, `.IPv4`, `.IPv6`; a missing group is empty) and the helpers `cidr`, `cidrs`, `ipv4`, `ipv6`, `join`, `quote`, `group`, `first`, `default`. Full reference: `specs/008-traefik-provider-config/contracts/agent-cli.md`.

**Operating FluxIP for agents**

| Name | Default | Description |
|---|---|---|
| `BACKEND_AGENT_PORT` | `8081` | Port of the agent session listener (gRPC over h2c). Put a reverse-proxy router with an **h2c backend** in front of it (example: [`deploy/traefik/agents-router.example.yml`](../deploy/traefik/agents-router.example.yml)) and give agents the public URL. |
| `BACKEND_AGENT_PUBLIC_URL` | — | Public base URL agents use, e.g. `https://agents.example.com`. Agents can't be created while it is empty. |
| `BACKEND_AGENT_SNAPSHOT_MAX_BYTES` | `1048576` | Largest snapshot FluxIP will send; beyond it the provider shows an error and the agent keeps its last files. |
| `BACKEND_AGENT_SNAPSHOT_COALESCE_MS` / `_RESYNC_MS` / `_HEARTBEAT_SECONDS` | `1000` / `900000` / `30` | Collapse window for change bursts, periodic full resend, session heartbeat. |

- **One backend instance.** Live agent sessions are held in memory, so running several backend replicas is not supported yet.
- **Reverse proxy timeouts.** A session is one long HTTP/2 stream. Traefik's default `readTimeout` (60 s) resets it after exactly one minute — the agent reconnects by itself, but the connection flaps. Set `respondingTimeouts.readTimeout: 0` on the entrypoint agents use (verified with Traefik v3.3); the example above shows a dedicated entrypoint. Heartbeats every 30 s keep the stream busy otherwise.
- **Releases.** The agent is released separately from the image: [`agent-release.yml`](../.github/workflows/agent-release.yml) publishes `fluxip-agent-linux-{amd64,arm64}` plus `SHA256SUMS` as assets of an `agent-vX.Y.Z` release (and an optional `ghcr.io/<owner>/fluxip-agent` image). Its version follows Conventional Commits on `agent/` and `proto/`; commits scoped `agent` don't bump the backend release.

