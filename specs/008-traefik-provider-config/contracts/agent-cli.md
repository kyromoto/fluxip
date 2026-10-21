# Contract: Agent (Kommandozeile, Konfiguration, Vorlagen)

Binary: `fluxip-agent`, statisch gelinkt, linux/amd64 und linux/arm64. Der Agent öffnet **keine** eingehenden Ports (Variante A).

## Kommandos

| Kommando | Zweck | Exit-Codes |
|---|---|---|
| `fluxip-agent run` (Standard) | verbindet, rendert, schreibt | 0 bei SIGTERM/SIGINT; 2 Konfigurationsfehler beim Start; 3 Vorlagen-/Verzeichnisfehler beim Start |
| `fluxip-agent templates [--list] [--write DIR] [NAME]` | gibt mitgelieferte Beispielvorlagen aus (stdout) oder schreibt sie in `DIR` | 0 / 2 |
| `fluxip-agent health` | Gesundheitsprüfung für Container-Healthchecks | 0 gesund, 1 ungesund |
| `fluxip-agent check` | rendert alle Vorlagen mit einem leeren Snapshot und validiert, ohne zu schreiben (Trockenlauf) | 0 / 3 |
| `fluxip-agent version` | gibt die SemVer-Version aus | 0 |

## Konfiguration (Umgebungsvariable oder Parameter; Parameter gewinnt)

| Variable | Parameter | Standard | Bedeutung |
|---|---|---|---|
| `FLUXIP_ADDRESS` | `--address` | — (Pflicht) | Agent-Adresse, `https://host/<providerId>` |
| `FLUXIP_TOKEN` | `--token` | — (Pflicht) | Token. Alternativ `FLUXIP_TOKEN_FILE` (Pfad), damit das Geheimnis nicht in der Prozessliste steht |
| `FLUXIP_TEMPLATES_DIR` | `--templates-dir` | `/templates` | Vorlagenverzeichnis |
| `FLUXIP_OUTPUT_DIR` | `--output-dir` | `/out` | Zielverzeichnis (Traefik File Provider) |
| `FLUXIP_FILE_PREFIX` | `--file-prefix` | `fluxip-` | Präfix der verwalteten Dateien. Nicht leer |
| `FLUXIP_MAX_OFFLINE` | `--max-offline` | `24h` | Dauer (`30m`, `24h`) oder `never` |
| `FLUXIP_LOG_LEVEL` | `--log-level` | `info` | `debug`, `info`, `warn`, `error` |
| `FLUXIP_TRAEFIK_API` | `--traefik-api` | leer (aus) | Basis-URL der Traefik-API für die optionale Prüfung |
| `FLUXIP_INSECURE` | `--insecure` | `false` | erlaubt `http://` ohne TLS (nur lokale Tests) |
| `FLUXIP_HEALTH_FILE` | `--health-file` | `/tmp/fluxip-agent.health` | flüchtige Statusdatei |

Beim Start werden fehlende Pflichtwerte, ein nicht beschreibbares Zielverzeichnis, ein fehlendes oder leeres Vorlagenverzeichnis und unbekannte Vorlagenendungen mit eindeutiger Meldung und Exit-Code 2 oder 3 gemeldet.

## Vorlagen

- Eine Datei je Ausgabe: `<name>.<ext>.tmpl` mit `<ext>` in `yml`, `yaml`, `toml`.
- Ausgabedatei: `<prefix><name>.<ext>`.
- Beispiel: `allowlist.yml.tmpl` → `fluxip-allowlist.yml`.
- Engine: Go `text/template`.

### Datenmodell

```text
.Provider  string            Name der Provider-Konfiguration
.Version   uint64            Snapshot-Version
.Time      time.Time         Zeitpunkt des Snapshots (UTC)
.Stale     bool              Daten sind älter als die Offline-Höchstdauer
.Groups    map[string][]Entry
Entry      .Name string, .IPs []string, .IPv4 []string, .IPv6 []string
```

`.Groups` gibt für nicht vorhandene Schlüssel eine leere Liste zurück (kein Fehler).

### Hilfsfunktionen

| Funktion | Beispiel | Ergebnis |
|---|---|---|
| `cidr` | `cidr "203.0.113.5"` | `203.0.113.5/32` (IPv6: `/128`) |
| `cidrs` | `cidrs $entry.IPs` | Liste von CIDR-Strings |
| `ipv4`, `ipv6` | `ipv4 .IPs` | filtert die Adressfamilie |
| `join` | `join ", " $list` | Verkettung |
| `quote` | `quote .Name` | YAML-/TOML-sicheres Anführungszeichen |
| `group` | `group .Groups "admin-allowlist"` | die Einträge einer Gruppe, flach: alle `IPs` aller Einträge |
| `first` | `first $list` | erstes Element oder leer |
| `default` | `default "x" $v` | Standardwert |

### Mitgelieferte Beispiele (`fluxip-agent templates`)

`allowlist.yml.tmpl` (Allow-List-Middleware, Gruppe `admin-allowlist`, Fallback bei leer oder veraltet):

```gotemplate
{{- $ips := cidrs (group .Groups "admin-allowlist") -}}
http:
  middlewares:
    admin-allowlist:
      ipAllowList:
        sourceRange:
{{- if and $ips (not .Stale) }}
{{- range $ips }}
          - {{ quote . }}
{{- end }}
{{- else }}
          - "127.0.0.1/32"   # Fallback: keine Daten oder veraltet
{{- end }}
```

`upstream.yml.tmpl` (Service, dessen Upstream die IP eines Geräts ist; Port steht in der Vorlage):

```gotemplate
{{- $ips := ipv4 (group .Groups "homelab") -}}
http:
  services:
    homelab:
      loadBalancer:
        servers:
{{- range $ips }}
          - url: {{ printf "http://%s:8080" . | quote }}
{{- end }}
```

Hinweis: Das ist die Zielgestalt; der genaue Fallback wird gegen Traefik v3 geprüft (research.md §16). Jede Vorlage kann eine Zeile `# fluxip:expect <typ> <name>@file` (Typ `middleware`, `service`, `router`) enthalten, die die optionale Traefik-Prüfung verwendet.

## Verhalten (Zusammenfassung der Anforderungen)

| Anforderung | Verhalten |
|---|---|
| FR-047 | alle Vorlagen rendern und validieren (YAML bzw. TOML) vor dem ersten Schreiben |
| FR-048 | Schreiben über `.<name>.<zufall>.tmp` im Zielverzeichnis, `fsync`, `rename`; nur bei geändertem Inhalt |
| FR-049 | nur Dateien mit Präfix und Endung `yml/yaml/toml` werden gelesen oder gelöscht. Verwaiste (ohne Vorlage) werden nach erfolgreichem Anwenden entfernt |
| FR-050 | beim Start nichts ersetzen, bis ein gültiger Snapshot da ist. Sind keine Dateien mit Präfix vorhanden, einmal mit leeren Gruppen rendern |
| FR-051 | nach Ablauf von `max-offline` (monotone Uhr) mit `.Stale = true` neu rendern |
| FR-052 | Wiederverbinden 1 s → 60 s exponentiell, ±20 % Zufall. `SyncRequest` alle 15 min |
| FR-053 | niedrigere Version als die zuletzt angewendete: ignorieren, `RESULT_IGNORED_STALE` melden |
| FR-054 | Report mit Version, Prüfsummen je Datei und Vorlage, Agent-Version, Ergebnis |
| FR-057 | Vorlagenänderung (fsnotify, `SIGHUP`) wird mit letztem und leerem Snapshot geprüft, sonst abgelehnt und gemeldet |

## Logs

JSON-Zeilen auf stdout (`log/slog`). Pflichtfelder: `time`, `level`, `msg`. Bei Snapshot-Verarbeitung zusätzlich `correlation_id`, `version`, `result`. Das Token wird nie geloggt.

## Health

`fluxip-agent run` schreibt bei jedem Lebenszeichen und jeder Anwendung `FLUXIP_HEALTH_FILE` (JSON: `lastConnectedAt`, `lastApplyAt`, `lastError`). `fluxip-agent health` meldet Exit 0, wenn aktuell verbunden **oder** die Trennung kürzer als `max-offline` ist. Die Datei ist nur für Diagnose da (kein Zustand im Sinne von FR-042).

## Container (optional)

`FROM scratch`, nur das Binary und CA-Zertifikate, `HEALTHCHECK CMD ["/fluxip-agent","health"]`.
