# Implementation Plan: Traefik-Lieferung in der Geräte-History

**Branch**: `009-history-traefik-delivery` | **Date**: 2026-10-29 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/009-history-traefik-delivery/spec.md`

## Summary

Die Geräte-History zeigt unter jeder IP-Änderung zusätzlich die Lieferung an Traefik-Agents: je Traefik-Aktion eine Zeile mit Stufe (veröffentlicht, angewendet, Fehler) und Zeit, oder den Hinweis "zusammen mit einer späteren Änderung geliefert".

Die Zuordnung läuft über die bestehende `correlationId` des Snapshots (= ID des `ip_changed`-Ereignisses). Sie reicht nur für die jeweils letzte Änderung eines Zusammenfassungsfensters (research.md §1). Damit auch die früheren Änderungen exakt zuordenbar sind, trägt `snapshot_published` künftig zusätzlich die IDs der aufgegangenen Änderungen (`absorbedCausationIds`, additiv und optional). Die Stufe wird wie im bestehenden Lieferstatus aus den Versionen der Agent-Berichte abgeleitet. Es gibt keine neue gespeicherte Entität und keine Änderung an Agent, Protokoll oder Ausführungsmodell.

## Technical Context

**Language/Version**: Backend TypeScript 5.7 auf Node.js 22, Frontend SolidJS + TypeScript (beide bestehend).

**Primary Dependencies**: Hono (Route), bestehender Ereignisspeicher (`EventStore`, `loadAggregate`), Solid UI. Keine neuen Abhängigkeiten.

**Storage**: PostgreSQL-Ereignisspeicher unverändert. Nur zwei Ereignis-Payloads erhalten ein optionales Feld. Keine Migration (`events` ist generisch), keine neue Projektion, kein Redis.

**Testing**: Backend Vitest. Unit-Test des `SnapshotCoordinator` (bestehende Datei `tests/unit/adapters/agent-grpc/snapshot-coordinator.test.ts`), Integrationstest der History-Route gegen Postgres und Redis (echte Infrastruktur wie bisher). Frontend Vitest (`tests/unit/device-history-page.test.tsx`).

**Target Platform**: Linux-Container (Backend), Browser (Frontend).

**Project Type**: Web-Anwendung (`backend/`, `frontend/`).

**Performance Goals**: Wie die bestehende History-Route (Replay, kleiner Maßstab). Zusätzlich ein `readStream` je Provider des Geräts.

**Constraints**: Agent, Agent-Protokoll (`proto/`) und Ausführungsmodell bleiben unverändert. Die Antwort von `executions` bleibt byte-kompatibel.

**Scale/Scope**: Wenige Provider je Gerät, History je Gerät, keine Serverpaginierung (wie bisher).

## Constitution Check

*GATE: Muss vor Phase 0 bestehen, nach Phase 1 erneut prüfen.*

| Prinzip | Bewertung |
|---|---|
| I. Explicit Commit Authorization | Es wird nicht automatisch committet. Der Spec-Kit-Ablauf erzeugt nur Artefakte. |
| II. Twelve-Factor | Keine neue Konfiguration, keine Logdateien, keine neuen Prozesse. Der Zustand bleibt im Ereignisspeicher. Der Coordinator hält die gesammelten IDs im selben prozesslokalen Zustand wie bisher das Coalescing (Backlog Punkt 4). Das verschlechtert die Abweichung nicht, die Folge verlorener IDs (Neustart oder mehrere Replikas im Fenster) ist nur eine fehlende Hinweis-Zeile, nie eine falsche Stufe. Der Backlog-Eintrag wird entsprechend ergänzt (T021). |

Ergebnis: bestanden, keine Abweichung, kein Eintrag unter Complexity Tracking. Nach Phase 1 unverändert bestanden.

## Project Structure

### Documentation (this feature)

```text
specs/009-history-traefik-delivery/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── history-api.md
├── checklists/
│   └── requirements.md
└── tasks.md             # /speckit-tasks, nicht Teil von /speckit-plan
```

### Source Code (repository root)

```text
backend/
├── src/
│   ├── domain/traefik-provider/
│   │   ├── events.ts                      # absorbedCausationIds? in Published/PublishFailed-Data
│   │   └── snapshot-scheduler.ts          # schedule(): causationId bleibt, Koordinator sammelt intern
│   ├── adapters/
│   │   ├── agent-grpc/snapshot-coordinator.ts   # alle causationIds eines Fensters sammeln, durchreichen
│   │   ├── queue-bullmq/snapshot-publisher.ts   # absorbedCausationIds ins Ereignis schreiben
│   │   └── http/routes/ip-client-history.ts     # deliveries je IP-Änderung ableiten
│   └── domain/traefik-provider/delivery-history.ts   # NEU: reine Funktion, leitet Zeilen/Stufen aus Provider-Ereignissen ab
└── tests/
    ├── unit/adapters/agent-grpc/snapshot-coordinator.test.ts   # erweitern
    ├── unit/domain/traefik-provider/delivery-history.test.ts   # NEU
    └── integration/ip-client-history-traefik.test.ts           # NEU

frontend/
├── src/pages/DeviceHistory.tsx            # Traefik-Zeilen je Änderung
└── tests/unit/device-history-page.test.tsx # erweitern
```

Weitere Dokumente, die im selben Zug nachgezogen werden (research.md §6): `specs/008-traefik-provider-config/data-model.md` und `specs/001-ip-change-automation/contracts/management-api.md`.

**Structure Decision**: Bestehende Web-Struktur. Die Ableitung der Zeilen steht als reine Funktion in `domain/traefik-provider/` (testbar ohne Infrastruktur). Die Route lädt nur Daten und ruft sie auf, wie es der Rest der History-Route tut.

## Design-Überblick

1. **Ereignis erweitern** (`events.ts`): `absorbedCausationIds?: string[]` an `TraefikProviderSnapshotPublishedData` und `TraefikProviderSnapshotPublishFailedData`. Der Reducer ist unverändert.
2. **Sammeln** (`snapshot-coordinator.ts`): `Pending` hält die `causationId`s des Fensters als geordnete Liste. Beim Lauf wird die letzte zur `causationId`, die übrigen werden als `absorbedCausationIds` an `publisher.publish(...)` gereicht. Auslöser ohne `causationId` ändern nichts. Danach wird die Liste geleert.
3. **Schreiben** (`snapshot-publisher.ts`): `publish(accountId, providerId, causationId?, absorbedCausationIds?)` schreibt das Feld nur, wenn es nicht leer ist. Bei unverändertem Inhalt wird weiter nichts geschrieben.
4. **Ableiten** (`delivery-history.ts`): Eingabe sind IP-Änderungen, die Traefik-Aktionen des Geräts mit Provider-Ereignissen und Provider-Zustand. Ausgabe sind die `deliveries` je Änderung gemäß [data-model.md](./data-model.md), Stufenregeln aus research.md §3.
5. **Route** (`ip-client-history.ts`): Aus `relevantActions` die Traefik-Aktionen wählen (auch abgelöste), je Provider einmal `readStream`, Funktion aufrufen, `deliveries` an jede Änderung hängen. `executions` bleibt wie es ist.
6. **Frontend** (`DeviceHistory.tsx`): Unter den Ausführungen je Änderung die Traefik-Zeilen mit dem vorhandenen `ExecutionStatusIcon`-Muster, Agent-Name, Gruppe, Stufe, Zeit, Fehlertext. Hinweis-Text für `combined`. Optisch von Ausführungen unterscheidbar (Spec FR-009), "Agent nicht mehr vorhanden" bei `providerName = null`.
7. **Dokumente** nachziehen (siehe oben).

## Risiken

- **Alte Ereignisse** haben kein `absorbedCausationIds`. Ältere zusammengefasste Änderungen zeigen keine Zeile. Das ist in der Spec als Fallback festgehalten.
- **Neustart im Fenster** verliert die gesammelten IDs, weil das Sammeln im Prozess läuft (008 research.md §4). Folge ist höchstens eine fehlende Hinweis-Zeile.
- **Überholte Versionen** werden wie im Lieferstatus behandelt (research.md §3). Dasselbe Verhalten ist gewollt und muss in beiden Stellen identisch bleiben. Gemeinsame Logik, wo es ohne Umbau geht, sonst durch einen Test abgesichert.

## Complexity Tracking

Keine Abweichungen von der Constitution.
