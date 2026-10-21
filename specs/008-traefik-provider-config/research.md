# Research: Verteilung dynamischer Traefik-Konfiguration an Agents

Alle Entscheidungen beziehen sich auf den Ist-Stand des Repos (Stand 2026-10-21). Es gibt keine offenen `NEEDS CLARIFICATION`. Punkte, die erst bei der Umsetzung gegen reale Systeme bestätigt werden können, stehen in §16.

## §1 Bestehender Mechanismus für "zentral pro Account verwaltete Konfigurationen"

**Ist-Stand**: Der Mechanismus sind die *Provider Credentials* (`domain/provider-credential`, Route `provider-credentials.ts`): ein Aggregat je Eintrag, Auflistung per `listAggregateIds` plus Replay, Löschen mit `409 credential_in_use` und Liste `usedBy`, Aktionen referenzieren per `providerCredentialId`.

**Entscheidung**: Das *Muster* wird übernommen (Aggregat je Eintrag, Replay statt Projektion, `usedBy`-Blockade beim Löschen), die *Struktur* nicht. Es entsteht ein eigenes Aggregat `traefik_provider`.

**Begründung**: Ein Credential speichert ein einzelnes, verschlüsseltes, ausgehendes Geheimnis. Eine Provider-Konfiguration braucht eingehende Tokens (Hash, bis zu zwei, einzeln widerrufbar), Verbindungsart, veröffentlichte Versionen und Agent-Rückmeldungen. Ein Credential-Eintrag mit `provider: "traefik"` würde diese Felder in ein Aggregat zwängen, dessen Reducer nur ein Geheimnis kennt, und die Löschlogik in `provider-credentials.ts` greift auf `config.providerCredentialId` zu, das der neue Aktionstyp nicht hat.

**Verworfen**: (a) Credential-Typ erweitern: falsche Form. (b) Konfiguration in einem Konto-Aggregat: verhindert mehrere Konfigurationen nebeneinander.

**Folge**: `provider-credentials.ts` löst `usedBy` über `actionState.config?.providerCredentialId` auf. Mit einer erweiterten `ActionConfig`-Union muss dort auf den Typ eingegrenzt werden (kleine Änderung, sonst Kompilierfehler).

## §2 Der Aktionstyp ist kein `ActionExecutor`

**Ist-Stand**: `fanOutActionExecutions` stellt bei jeder bestätigten IP-Änderung pro aktiver Aktion einen Job ein. Der Worker ruft den passenden `ActionExecutor.execute(config, ipValues)` auf, protokolliert Versuche, Wiederholungen und Benachrichtigungen. Das Modell ist "einmal ausführen und Erfolg/Misserfolg melden".

**Entscheidung**: Der Typ `traefik_config_delivery` (Konfiguration `{ traefikProviderId, group }`) wird **nicht** über Ausführungen abgebildet. Stattdessen:

- Der Fan-out überspringt diesen Typ und meldet stattdessen die betroffenen Provider an den Snapshot-Publisher.
- Lieferstatus (FR-014) kommt aus den Berichten des Agents, nicht aus einem Ausführungsergebnis.
- Der manuelle Lauf (`action-run.ts`) lehnt den Typ mit `409 not_runnable` ab.

**Begründung**: Der Zustand "angewendet" entsteht Sekunden bis Stunden später und beim Agent, nicht im Worker. Eine Ausführung, die "erfolgreich" meldet, sobald der Snapshot in einem Kanal liegt, würde in der Ausführungshistorie Erfolg zeigen, obwohl nichts angewendet ist. Außerdem ist die Aktion ein Zustandsabgleich (das Gerät *ist* Teil der Liste, solange die Aktion aktiv ist), kein Ereignis.

**Verworfen**: Executor, der nur "veröffentlicht" und Erfolg meldet. Irreführende Historie, doppelte Wiederholungslogik.

**Auslöser für Neuberechnung (`schedule(accountId, providerIds)`)**:

| Auslöser | Quelle im Code |
|---|---|
| bestätigte IP-Änderung | `debounce-worker.ts` nach Anhängen von `ip_changed` |
| Aktion angelegt, geändert, aktiviert, deaktiviert, entfernt | `routes/actions.ts` (bei Wechsel von Provider oder Gruppe: alter **und** neuer Provider) |
| Gerät aktiviert, deaktiviert, stillgelegt | `routes/ip-clients.ts` (`enable`, `disable`, `DELETE` = decommission) |
| periodischer Abgleich | Timer im Publisher (FR-021) |
| Agent verbindet sich | Sitzungshandler schickt den aktuellen Stand |

Die betroffenen Provider eines Geräts ergeben sich aus einem Replay aller Aktionen des Kontos (bei Konto-Limit 5 Geräten vernachlässigbar).

## §3 Version, Veröffentlichung und Replay-Regel

**Entscheidung**: Die Veröffentlichung eines Snapshots ist eine **Entscheidung** des Systems (neuer Stand mit neuer Versionsnummer). Sie wird als Ereignis `snapshot_published` an das Aggregat `traefik_provider` angehängt. Die **Version ist die Sequenznummer dieses Ereignisses** im Strom des Providers.

**Begründung**: Die Sequenznummer ist bereits monoton, eindeutig und wird vom Ereignisspeicher durch `expectedSequenceNumber` serialisiert. Die Kopplung an die Stromposition löst die Vorgabe aus dem Anhang (Reihenfolge und Wiederaufbau eindeutig). Das Ereignis trägt nur Inhalts-Hash, Zähler und Korrelations-ID, nicht den Inhalt. Der Inhalt ist jederzeit aus dem aktuellen Zustand neu berechenbar. Replay erzeugt keine Seiteneffekte: Der Versand über die Leitung ist nicht Teil des Reducers.

**Lücken in der Versionsfolge** (andere Ereignisse wie `agent_connected` erhöhen die Sequenznummer ebenfalls) sind erlaubt. Der Agent verlangt nur "größer als zuletzt angewendet" (FR-053).

**Änderungen ohne Wirkung**: Vor dem Anhängen wird der kanonische Hash (sortierte Gruppen, sortierte Einträge, sortierte IPs) mit dem Hash des letzten `snapshot_published` verglichen. Gleich → kein Ereignis, kein Push (Szenarien US3-2/3-3).

**Antwort auf die Anhang-Frage "gilt Auslieferung als Entscheidung?"**: Die *Versionsvergabe* ja, die *Zustellung* nein. Die Zustellung ist ein Seiteneffekt, der bei Wiederverbindung ohnehin erneut erfolgt.

**Verworfen**: (a) Zähler in Redis: bei Verlust nicht rekonstruierbar, Verstoß gegen "Redis nie Entscheidungsquelle". (b) Globale Position des Ereignisspeichers: existiert im Schema nicht (`sequence_number` ist je Aggregat). (c) Zeitstempel als Version: Uhrenabhängig.

## §4 Zusammenfassen und Reihenfolge (FR-022)

**Entscheidung (umgesetzt)**: Ein `SnapshotCoordinator` im Backend-Prozess fasst Auslöser je Provider zusammen: Der erste Auslöser startet ein Fenster (Standard 1 s, `BACKEND_AGENT_SNAPSHOT_COALESCE_MS`), weitere Auslöser im Fenster ändern nur die Ereignis-ID der Ursache. Danach läuft genau ein Veröffentlichungslauf. Kommt während eines Laufs ein weiterer Auslöser, folgt genau ein Folgelauf, sodass der zuletzt gültige Zustand gewinnt (US3-4).

**Abweichung vom ursprünglichen Entwurf**: Geplant war ein BullMQ-Job mit deterministischer ID. BullMQ ignoriert `add` mit gleicher ID, solange der Job existiert, auch wenn er gerade läuft. Eine Änderung während des Laufs ginge verloren. Die In-Prozess-Lösung vermeidet das und passt zur Einzelinstanz-Entscheidung (§6). Auslöser, die bei einem Absturz zwischen Ereignis und Lauf verloren gehen, sind unkritisch: Bei der Wiederverbindung berechnet das Hello den Stand neu, und der periodische Abgleich holt Differenzen nach.

**Nur geänderte Stände werden gesendet**: `publish()` meldet `changed`. Ein Auslöser ohne inhaltliche Änderung erzeugt weder Ereignis noch Push (US3-2/3-3). Der periodische Abgleich sendet dagegen immer den aktuellen Stand.

**Serialisierung der Anhänge**: Auf dem Strom eines Providers schreiben Publisher, Sitzungshandler und API. Ein `KeyedMutex` je `providerId` plus einmaliges Neuladen bei `ConcurrencyError` (`ProviderStore.append`) deckt das ab.

**Zeitbudget für SC-001** (gemessen, `traefik-delivery-latency.test.ts`): 20 Läufe ab bestätigtem `ip_changed`: Median 1024 ms, p95 1039 ms, max 1045 ms. Fast die gesamte Zeit ist das Zusammenfassungsfenster.

## §5 Keine Projektion für Snapshots in v1

**Entscheidung**: Der Snapshot wird bei Bedarf durch Replay berechnet (`snapshot.ts`, reine Funktion über Aktionszustände und Geräte-Zustände). Keine Redis-Projektion.

**Begründung**: Das Konto-Limit (Standard 5 Geräte) und wenige Aktionen machen den Replay billig. Eine Projektion würde die bekannte Schwäche der Aktionsprojektion erben: Sie wird nur bei Lebenszyklus-Ereignissen aktualisiert und bleibt bei Korrekturen direkt im Ereignisspeicher veraltet (Memory-Eintrag `redis_actions_projection_cache_gap`). Der periodische Abgleich (FR-021) und die Neuberechnung aus Ereignissen umgehen das.

**Hinweis**: Die Anzeige "welche Aktionen gibt es je Gerät" nutzt weiter die bestehende Aktionsprojektion. Der **Lieferstatus** darf deshalb **nicht** in `ActionSummary` landen, sondern kommt aus einem eigenen Endpunkt (contracts/management-api.md), damit er nicht an der Projektion hängt.

**Neubewertung**: Wenn Konten mit hunderten Geräten üblich werden, kann der Snapshot-Cache als verwerfbare Projektion nachgezogen werden, ohne das Protokoll zu ändern.

## §6 Eine Backend-Instanz, In-Prozess-Sitzungsregister

**Entscheidung**: Die aktiven Sitzungen leben in einem `SessionRegistry` im Backend-Prozess (`providerId → Sitzung`). Der Publisher läuft im selben Prozess (wie die bestehenden BullMQ-Worker in `main.ts`).

**Begründung**: `docker-compose.yml` und `main.ts` betreiben genau einen Prozess, der API, Worker und (neu) den Agent-Listener enthält. Mehrere Replikas würden einen Pub/Sub-Kanal zwischen Instanzen brauchen, damit der Publisher die Sitzung auf einer anderen Instanz erreicht.

**Einschränkung (dokumentiert, in Quickstart und README zu nennen)**: Betrieb mit mehreren Backend-Replikas wird in v1 nicht unterstützt. Die Sitzungsschnittstelle (`AgentChannel`, `SessionRegistry.push(providerId, msg)`) ist so geschnitten, dass ein Redis-Pub/Sub-Adapter später hinter `push` passt.

**Präsenz**: Verbunden/getrennt kommt aus dem Registry und aus den Ereignissen `agent_connected`/`agent_disconnected` (für Zeitpunkt der letzten Verbindung nach Neustart des Backends). Beim Start des Backends gilt jeder Provider als getrennt, bis sich ein Agent meldet. Ein Absturz ohne `agent_disconnected` wird dadurch korrekt behandelt: Beim nächsten Start hängt das Backend für Provider, deren letztes Präsenz-Ereignis `agent_connected` war, kein neues Ereignis an, zeigt aber "getrennt".

## §7 Transport: gRPC über eigenen Listener

**Entscheidung**: `@grpc/grpc-js` Server auf eigenem Port (`BACKEND_AGENT_PORT`, Standard 8081), unverschlüsselt (h2c) hinter dem vorgeschalteten Traefik, der TLS beendet. Der Agent verbindet über TLS zu `agents.<domain>:443`. Die `.proto` liegt in `proto/` und wird im Backend zur Laufzeit mit `@grpc/proto-loader` geladen (`oneofs: true`, `keepCase: false`). Kein Codegen im Backend.

**Begründung**: Hono läuft über `@hono/node-server` auf HTTP/1.1. Ein getrennter Listener hält gRPC (HTTP/2, Trailer) vom REST-Pfad fern. `grpc-js` ist reines JS und vermeidet native Abhängigkeiten im `node:22-slim`-Image. Dynamisches Laden vermeidet einen Generator-Schritt im Build. Der Preis ist schwächere Typisierung. Dagegen gibt es handgeschriebene TS-Typen für die acht Nachrichten und eine Validierung an der Grenze (`agent-session.proto.md`).

**Konfiguration**: `grpc.max_receive_message_length` und `max_send_message_length` = Snapshot-Maximum + Puffer. Keepalive des Servers: Ping alle 30 s, Zeitüberschreitung 10 s, `keepalive_permit_without_calls = 1`. Die Anwendungsebene hat zusätzlich eigene Lebenszeichen (siehe Protokoll), weil Proxys HTTP/2-PINGs unterschiedlich weiterreichen.

**Dockerfile**: `proto/` muss in das Runtime-Image kopiert werden (wie der bestehende Kopierschritt der SQL-Migrationen im Build-Skript von `backend/package.json`).

**Verworfen**: (a) WebSocket oder SSE plus POST: einfacher hinter Proxys und im Hono-Stack, aber weicht von der Vorentscheidung ab und hat keine eingebauten Schemas oder Backpressure. (b) Natives `http2` ohne gRPC: eigenes Framing ohne Gewinn. (c) `nice-grpc`: schöne API, aber zusätzliche Abhängigkeit ohne Bedarf bei einem einzigen Dienst.

## §8 Agent-Adresse und Zuordnung

**Entscheidung**: Die **Agent-Adresse** ist eine URL der Form `https://<agents-host>/<providerId>`. `agents-host` kommt aus `BACKEND_AGENT_PUBLIC_URL`. Der Agent zerlegt sie: Der Host gibt das gRPC-Ziel vor, die `providerId` geht als Metadatum `x-fluxip-provider` mit. Das Token geht als `authorization: Bearer fxt_…`.

**Zuordnung im Backend**: `providerId` → `eventStore.resolveAccountId("traefik_provider", providerId)` (existiert bereits genau für diesen Fall "global eindeutige Kennung vor dem Konto-Kontext") → Replay des Providers → Token-Hash prüfen. Die Zuordnung ist damit unabhängig vom Routing des Proxys.

**Begründung**: Eine eigene Adresse je Konfiguration (FR-002) ohne Wildcard-Zertifikate oder pro Provider ein Traefik-Router. Alle Agents teilen sich einen Router (Host-Regel, h2c-Backend). Die ID ist kein Geheimnis. Das Token ist es.

**Antwort auf die Anhang-Frage "nur über Token auflösen?"**: Möglich wäre ein Token mit eingebetteter Kennung. Eine sichtbare Adresse ist für Benutzer und Logs verständlicher und lässt sich getrennt vom Token weitergeben.

**Fehler**: Unbekannte `providerId` und falsches Token erzeugen dieselbe Antwort (`UNAUTHENTICATED`, gleiche Meldung), damit keine Provider-IDs abgefragt werden können.

## §9 Token und Schutz gegen Missbrauch

**Token**: 32 zufällige Bytes (`crypto.randomBytes`), Format `fxt_<base64url>`. Gespeichert wird **SHA-256** des Tokens (hochentropisch, daher kein Bedarf für ein langsames Passwort-Hashverfahren). Vergleich mit `timingSafeEqual`. Im Ereignis stehen `tokenId` (ULID), Hash und die letzten vier Zeichen zur Anzeige. Der Klartext erscheint genau einmal in der Antwort von `POST …/tokens` und nie im Ereignisspeicher oder Log (logtape-Redaktion für `authorization` prüfen).

**Zwei Tokens** (FR-003): Das Anlegen eines dritten wird mit `409 token_limit_reached` abgelehnt. Der Benutzer widerruft zuerst eines.

**Brute-Force-Schutz (FR-035)**: Redis-Zähler mit Ablauf (`INCR` + `EXPIRE`) **je Quell-IP** (nicht je `providerId`: ein Zähler pro Provider würde einem Angreifer erlauben, den echten Agent auszusperren). Mehr als 10 Fehlversuche in 5 Minuten → `RESOURCE_EXHAUSTED` für diese Quelle, auch für das richtige Token. Agents anderer Quellen sind nicht betroffen. Voraussetzung ist, dass der vorgeschaltete Proxy `X-Forwarded-For` setzt; ohne ihn erscheinen alle Agents als eine Quelle. Die Quell-IP kommt aus `x-forwarded-for` (nur das letzte vertrauenswürdige Glied, da genau ein Proxy davor steht) mit Rückfall auf die Peer-Adresse. Der Zähler ist Schutz, keine Entscheidungsquelle für Geschäftslogik.

**Widerruf**: `token_revoked` → `SessionRegistry.terminateByToken(tokenId)` beendet laufende Sitzungen mit Statuscode `UNAUTHENTICATED` (US7-2). Provider-Löschung beendet alle Sitzungen (US7-4).

## §10 "Veraltet" und Offline-Dauer

**Agent-seitig (FR-051)**: Der Agent misst die Zeit seit der letzten gültigen Sitzung mit der monotonen Uhr (Go: `time.Since` auf einem `time.Now()`-Wert trägt die monotone Komponente). Läuft `max_offline` ab, rendert er mit `.Stale = true` neu. `max_offline` ist konfigurierbar (Standard 24 h, `0`/`never` = nie).

**FluxIP-seitig**: Das Hello des Agents enthält `max_offline_seconds`. FluxIP zeigt "veraltet", wenn der Agent länger als dieser Wert getrennt ist, gerechnet ab dem Ereignis `agent_disconnected` mit Serveruhr. Beim Wiederverbinden meldet der nächste Bericht `stale` zurück.

**Zustände an der Konfiguration** (API-Werte): `connected`, `disconnected`, `stale`, zusätzlich `never_connected` (noch kein Agent; Ergänzung gegenüber der Spezifikation, nur Anzeige). Die UI übersetzt sie.

**Absturz des Backends**: Dabei entsteht kein `agent_disconnected`. Damit "veraltet" trotzdem nach Neustart des Backends korrekt wächst, zählt die Trennungszeit mindestens ab dem Start des Backend-Prozesses (`deriveConnectionState`).

## §11 Agent-Entwurf

**Layout**: siehe plan.md. Der Kern ist eine reine Pipeline `Snapshot → render → validate → apply` ohne I/O im Renderer.

**Vorlagen-Konvention**: Dateien in `TEMPLATES_DIR` mit Endung `.tmpl`. Beispiel `allowlist.yml.tmpl` → Ausgabe `<prefix>allowlist.yml` (Standard `fluxip-allowlist.yml`). Die Endung davor (`.yml`, `.yaml`, `.toml`) bestimmt die Validierung. Andere Endungen werden abgelehnt (Startfehler).

**Datenmodell für Vorlagen** (FR-045):

```text
.Provider   Name der Provider-Konfiguration
.Version    Snapshot-Version (uint64)
.Time       Zeitstempel des Snapshots (UTC)
.Stale      bool
.Groups     map[string][]Entry   (nicht vorhandene Gruppe → leere Liste)
Entry       { Name string; IPs []string; IPv4 []string; IPv6 []string }
Funktionen  cidr, cidrs, join, quote, first, ipv4, ipv6, default, sortBy
```

`cidr "203.0.113.5"` → `203.0.113.5/32`, IPv6 → `/128`. Fehlende Gruppen liefern eine leere Liste statt `nil`, damit `{{ if not (index .Groups "x") }}` immer greift. `template.Option("missingkey=zero")` plus Hilfsmethode `.Group "name"`.

**Fallback (FR-046)**: Die mitgelieferte Allow-List-Vorlage gibt bei leerer Gruppe oder `.Stale` eine Quellbereichsliste `127.0.0.1/32` aus (blockiert effektiv alles Externe, bleibt aber gültiges Traefik-YAML). Eine leere `sourceRange`-Liste wäre in Traefik ungültig oder öffnet je nach Version unerwartet. Das ist ein **Verhaltensvorschlag**, der beim Schreiben der Vorlage gegen Traefik v3 gegengeprüft wird (§16).

**Atomares Schreiben (FR-048)**: temporäre Datei im Zielverzeichnis mit Namen `.<name>.<zufall>.tmp` (Endung `.tmp`, damit Traefiks File Provider sie nicht als Konfiguration lädt), `fsync` der Datei, `rename`, `fsync` des Verzeichnisses. Vorher Vergleich mit dem vorhandenen Inhalt (nur schreiben bei Änderung).

**Alles oder nichts (FR-047)**: erst alle Vorlagen rendern und validieren, erst dann schreiben. Beim Schreiben selbst ist keine echte Transaktion über mehrere Dateien möglich. Es gilt: Schlägt ein Rename fehl, bleiben bereits ersetzte Dateien (jede für sich gültig) bestehen und der Fehler wird gemeldet. Das ist die schwächste noch sichere Zusage. Sie erfüllt SC-004 (nie halb geschrieben, nie leer), nicht aber "alle neu oder alle alt" bei Plattenfehlern. Diese Einschränkung steht im Agent-Leitfaden.

**Präfix-Regel (FR-049)**: Der Agent betrachtet nur Dateien, deren Name mit dem Präfix beginnt und die auf `.yml`, `.yaml` oder `.toml` enden. Aufräumen löscht davon nur, wofür keine Vorlage mehr existiert. Alles andere wird weder gelesen noch angefasst. Das Präfix darf nicht leer sein (Startfehler).

**Start (FR-050)**: Keine Datei mit Präfix vorhanden und kein Snapshot → mit leeren Gruppen rendern. Sonst nichts anfassen, bis der erste gültige Snapshot eintrifft.

**Vorlagenwechsel (FR-057, US9)**: `fsnotify` auf das Vorlagenverzeichnis (mit Entprellung) und `SIGHUP`. Neu geladene Menge wird mit letztem Snapshot und leerem Snapshot probegerendert. Nur wenn beides gültig ist, ersetzt sie die aktive Menge, sonst Fehlerbericht und weiter mit der alten.

**Traefik-Prüfung (FR-055)**: Optional (`TRAEFIK_API_URL`). Nach dem Schreiben mit Wiederholung bis 10 s `GET /api/http/middlewares` (bzw. services/routers). Erwartete Objekte stammen aus einer optionalen Zeile `# fluxip:expect middleware allowlist@file` in der Vorlage. Das Ergebnis geht im Bericht mit (`loaded`, `missing`).

**Health (FR-056)**: `fluxip-agent health` liest eine flüchtige Datei (`HEALTH_FILE`, Standard `/tmp/fluxip-agent.health`) mit Zeitstempeln `lastConnectedAt`, `lastApplyAt`, `lastError`. Exit 0, wenn verbunden oder noch innerhalb von `max_offline`, sonst 1. Die Datei ist kein Zustand im Sinne von FR-042: Ohne sie funktioniert der Agent identisch.

**Logging**: `log/slog` mit JSON-Handler auf stdout. Pflichtfeld `correlation_id` je Snapshot.

**Größe und Speicher (SC-005)**: `-trimpath -ldflags="-s -w"`. Erwartet etwa 12–18 MB, Leerlauf einige MB. Im Release-Job als Prüfschritt (`size`-Grenze 30 MB), RAM-Messung im End-zu-Ende-Test.

## §12 Lieferstatus je Aktion (FR-014)

**Entscheidung**: Der Agent meldet nur Versionen und Prüfsummen, nicht Inhalte. Der Status je Aktion wird deshalb aus dem Zustand des Providers abgeleitet:

| Bedingung | Aktionsstatus |
|---|---|
| Agent getrennt oder veraltet | `agent_disconnected` |
| letzte Rückmeldung zur aktuellen Version `ok` | `applied` |
| letzte Rückmeldung zur aktuellen Version `error` | `error` (mit Grund) |
| sonst | `pending` |

**Grenze**: Das ist pro Provider, nicht pro Gerät genau. Eine Aktion zeigt "applied", sobald der Agent die aktuelle Version angewendet hat, in der ihr Gerät enthalten ist (oder ohne Eintrag, wenn das Gerät noch keine IP hat). Genauer geht es nur, wenn der Agent Eintragsdaten zurückmeldet. Das kann ein späteres Protokollfeld sein (additiv, siehe §13).

## §13 Variante B vorbereiten, ohne sie zu bauen

**Entscheidung**:

- `connectionMode` ist Teil des Ereignisses `created` (`"agent_initiated"` | `"server_initiated"`). Die API akzeptiert nur `agent_initiated` und antwortet sonst `422 connection_mode_not_available`.
- Die gesamte Sitzungslogik liegt in `AgentSessionHandler`, der gegen `AgentChannel` arbeitet (`send(msg)`, `close(reason)`, Eingang per `handle(msg)`). Der gRPC-Server ist nur ein Adapter, der pro eingehendem Stream einen Kanal erstellt.
- Die `.proto` ist richtungsneutral: ein einziger `Envelope`-Typ in beide Richtungen, beide Seiten senden `Hello` zuerst.
- Alles, was von der Richtung abhängt (Authentifizierung, Adressauflösung, Wiederverbinden), liegt **außerhalb** von Handler und Protokoll: Auth im Adapter, Wiederverbinden beim Agent im `session`-Paket.

**Review-Kriterium für SC-008**: Ein späterer Adapter `grpc-agent-dialer` darf nur `AgentChannel` implementieren und den Handler aufrufen. Änderungen an `session.proto`, `snapshot.ts`, Handler und `apply` wären ein Befund.

**Authentifizierung für B (später)**: gegenseitiges TLS. Nicht Teil dieses Plans.

## §14 Release des Agents (FR-062)

**Ist-Stand**: `release.yml` läuft bei Push auf `main`, bestimmt die Version mit semantic-release (`determine-version.mjs`, Tag `vX.Y.Z`) und baut das Backend-Image.

**Entscheidung**: Getrennter Workflow `.github/workflows/agent-release.yml`. Er läuft bei Änderungen unter `agent/**` oder `proto/**`, bestimmt eine eigene Version mit eigenem Tag-Format `agent-v${version}` (semantic-release mit separater Konfiguration `agent/.releaserc.json`, Pfadfilter über `semantic-release-monorepo` oder gleichwertig), baut mit `GOOS=linux GOARCH={amd64,arm64}`, prüft die Größe (< 30 MB) und lädt beide Binaries samt SHA-256-Summen als Release-Assets hoch. Optional ein `scratch`-Image auf GHCR mit Multi-Arch-Manifest.

**Wichtig**: Der bestehende Workflow `release.yml` darf wegen `agent-v*`-Tags nicht seine Versionsbestimmung verwirren. Das Tag-Format `vX.Y.Z` bleibt dem Backend. Das ist beim Anlegen der Konfiguration zu testen (§16).

## §15 Vorschlag für Namen (zur Bestätigung vor Übernahme)

Die Spezifikation verlangt Bestätigung. Vorschlag:

| Konzept | Aggregat/Typ | Ereignisse |
|---|---|---|
| Provider-Konfiguration | `traefik_provider` | `created`, `renamed`, `deleted`, `token_issued`, `token_revoked`, `snapshot_published`, `snapshot_publish_failed`, `agent_connected`, `agent_disconnected`, `snapshot_applied`, `snapshot_apply_failed` |
| Aktion | `traefik_config_delivery` (Wert in `action.type`) | bestehende `action.*`-Ereignisse |
| Gruppe | `group` | — |

Die UI nennt es "Traefik-Provider" (Liste) und "Traefik-Konfiguration liefern" (Aktionstyp), wie in der Spezifikation.

## §16 Gegen reale Systeme geprüft

Geprüft am 2026-10-21 mit Traefik v3.3 (Docker) und dem echten Backend plus Go-Agent:

1. **gRPC (h2c) hinter Traefik**: Ein Router mit `h2c://`-Backend reicht die Agent-Sitzung durch, Auth-Metadaten kommen an, Snapshots fließen. **Aber**: Traefiks Standard-`readTimeout` (60 s) setzt den Stream genau eine Minute nach dem Öffnen mit `RST_STREAM ... INTERNAL_ERROR` zurück (beobachtet: Trennung nach 60 s, in 200 s dreimal). Der Agent verbindet automatisch neu und erhält den vollen Stand, die Funktion bleibt erhalten, die Verbindung flattert aber im Minutentakt (und erzeugt Verbindungsereignisse). Mit `entryPoints.<name>.transport.respondingTimeouts.readTimeout: 0` blieb die Sitzung 140 s ohne Wiederverbindung bestehen, und eine IP-Änderung wurde danach zugestellt. Die Einstellung gilt für den ganzen Entrypoint, daher empfiehlt sich ein eigener Entrypoint für Agents (siehe `deploy/traefik/agents-router.example.yml`). Heartbeats allein genügen nicht, weil der Timeout die Lesedauer des Requests begrenzt, nicht die Leerlaufzeit.
2. **Allow-List mit leerer `sourceRange`**: Traefik meldet `sourceRange is empty, IPAllowLister not created`, die Middleware ist `disabled`, und die **Route antwortet 404** statt 403. Der Fallback `127.0.0.1/32` ist dagegen gültig: Die Route bleibt erreichbar und liefert 403 für fremde Adressen. Die Wahl des Fallbacks ist bestätigt.
3. **`.tmp`-Dateien**: Dateien `.fluxip-x.yml.abc.tmp` im überwachten Verzeichnis werden von Traefiks File Provider ignoriert (keine Log-Zeile, keine Konfigurationsänderung). Ein Umbenennen auf `fluxip-allowlist.yml` wird innerhalb von etwa 2 s übernommen.
4. **Nicht atomar geschriebenes, ungültiges YAML** löst im Watcher einen Fehler aus (`Error occurred during watcher callback`). Genau das verhindert die Validierung vor dem Schreiben.
5. **`X-Forwarded-For`**: Der Server nimmt das letzte Glied des Headers als Quelle; Tests decken das mit gesetztem Header ab. Mit echtem Traefik-Header nicht separat geprüft.
6. **Release-Tags**: `agent-v*` stört die Versionsbestimmung des Backends nicht (semantic-release erwartet `v<semver>`); Commits mit Scope `agent` lösen kein Backend-Release aus (`.releaserc.json`, per `analyzeCommits` geprüft). Die Agent-Versionsbestimmung (`determine-agent-version.mjs`) ist lokal ohne Agent-Commits geprüft, ein echter Release-Lauf steht aus.
7. **Binary-Größe und Speicher**: 12,4 MB, Leerlauf-RSS rund 13 MB, kein lauschender Socket (`agent/e2e_test.go`). Image 18,3 MB.

Offen bleibt ein echter Lauf der GitHub-Pipeline `agent-release.yml`.
