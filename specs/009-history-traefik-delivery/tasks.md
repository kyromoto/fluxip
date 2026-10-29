---

description: "Task list for Traefik-Lieferung in der Geräte-History"
---

# Tasks: Traefik-Lieferung in der Geräte-History

**Input**: Design documents from `/specs/009-history-traefik-delivery/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/history-api.md, quickstart.md (alle vorhanden)

**Tests**: Enthalten. plan.md legt Testarten und Orte fest (Vitest unter `backend/tests/{unit,integration}`, Vitest im Frontend), quickstart.md §1–§2 verlangt sie. Die Testaufgaben sind deshalb echte Lieferumfänge. Backend-Tests laufen gegen echtes Postgres und Redis (CLAUDE.md).

**Organization**: Aufgaben sind nach User Story gruppiert (spec.md: US1 P1, US2 P2, US3 P3). Pfade sind relativ zum Repository-Root.

**Commits**: Keine Aufgabe enthält einen Commit. Commits entstehen nur auf ausdrückliche Anweisung (Constitution, Prinzip I).

**Annahmen dieser Task-Liste**: Sie folgt spec.md und plan.md in ihrem aktuellen Stand. Die Dokumente `specs/008-traefik-provider-config/data-model.md` und `specs/001-ip-change-automation/contracts/management-api.md` sind bereits angepasst (plan.md, research.md §6) und werden nur in der Abschlussphase geprüft.

## Format: `[ID] [P?] [Story] Beschreibung`

- **[P]**: parallel ausführbar (andere Dateien, keine Abhängigkeit von offenen Aufgaben)
- **[Story]**: zugehörige User Story (US1 … US3)

## Path Conventions

- Backend: `backend/src/`, Tests `backend/tests/{unit,integration}/`
- Frontend: `frontend/src/`, Tests `frontend/tests/unit/`
- Es gibt keine Änderung an `agent/` und `proto/` (Spec FR-012).

---

## Phase 1: Setup

Entfällt. Es gibt keine neuen Abhängigkeiten, keine Konfiguration, keine Migration (plan.md, Technical Context).

---

## Phase 2: Foundational

**Purpose**: Gemeinsame Typen der abgeleiteten Sicht, damit Backend-Funktion, Route und Frontend dieselbe Form nutzen.

- [X] T001 Lege `backend/src/domain/traefik-provider/delivery-history.ts` mit den exportierten Typen `DeliveryKind` (`"delivered" | "combined"`), `DeliveryStage` (`"published" | "applied" | "failed"`) und `TraefikDelivery` (`actionId`, `traefikProviderId`, `providerName: string | null`, `group`, `kind`, `stage: DeliveryStage | null`, `at: string | null`, `error: string | null`, `version: number | null`) gemäß data-model.md an. Funktionen folgen in US1.

**Checkpoint**: Typen stehen, die Stories können beginnen.

---

## Phase 3: User Story 1 - Lieferstand einer IP-Änderung nachvollziehen (Priority: P1) 🎯 MVP

**Goal**: Unter jeder IP-Änderung zeigt die History je Traefik-Aktion eine Zeile mit Stufe (veröffentlicht, angewendet, Fehler) und Zeitstempel, wenn der Snapshot des Providers die Änderung als `correlationId` trägt.

**Independent Test**: Gerät mit einer DNS- und einer Traefik-Aktion, IP-Änderung bestätigen, Agent anwenden lassen. Die History zeigt unter der Änderung die DNS-Ausführung und eine Traefik-Zeile "angewendet" mit Zeit (spec.md US1, quickstart.md §3).

### Tests für User Story 1

- [X] T002 [P] [US1] Schreibe `backend/tests/unit/domain/traefik-provider/delivery-history.test.ts` für `deriveDeliveries` (Hauptzeilen, `kind = "delivered"`): `snapshot_published` ohne Bericht → `published` mit `publishedAt`. `snapshot_applied` mit `version == v` und mit `version > v` → `applied` mit `appliedAt` des ersten solchen Ereignisses. `snapshot_apply_failed` mit `version == v` ohne späteres `applied` → `failed` mit `reason`. `snapshot_publish_failed` → `failed` mit `reason` und `failedAt`. Ereignisse mit fremder `correlationId` erzeugen keine Zeile. Zwei Traefik-Aktionen an zwei Providern ergeben zwei Zeilen (research.md §3, §4).
- [X] T003 [P] [US1] Schreibe `backend/tests/integration/ip-client-history-traefik.test.ts` (Postgres und Redis wie `backend/tests/integration/traefik-ip-change-pipeline.test.ts`) für `GET /api/ip-clients/:id/history`: Gerät mit DNS- und Traefik-Aktion, Änderung mit `snapshot_published` und `snapshot_applied` → `executions` unverändert und `deliveries` mit `stage: "applied"`. Fall nur veröffentlicht → `published`. Fall `snapshot_apply_failed` → `failed` mit `error`. Gerät ohne Traefik-Aktion → `deliveries: []`. Fremder Account liefert `404` und liest keine Provider-Ereignisse (Spec FR-013). Nach einem `ignored_stale`-Bericht ist die Antwort unverändert (FR-008). Ohne Traefik-Aktion werden keine Provider-Ereignisse gelesen (SC-004). Abgelöste Aktion (`detached`) zeigt die Zeile weiter.
- [X] T004 [P] [US1] Erweitere `frontend/tests/unit/device-history-page.test.tsx` um eine Änderung mit `deliveries` (`published`, `applied`, `failed` mit Fehlertext): je Zeile Agent-Name, Gruppe, Stufe und Zeit sichtbar, Zeilen stehen getrennt von den Ausführungen und tragen nicht deren Beschriftung (Spec FR-009). Bestehende Tests bleiben unverändert grün (SC-005).

### Implementierung für User Story 1

- [X] T005 [US1] Implementiere `deriveDeliveries` in `backend/src/domain/traefik-provider/delivery-history.ts`: reine Funktion aus IP-Änderungen, Traefik-Aktionen des Geräts, den Ereignissen je Provider und dem Provider-Zustand. Stufenregeln und Zeitpunkte nach research.md §3 (`applied` bei `snapshot_applied.version >= v` vor `failed`). Version `v` ist die `sequenceNumber` von `snapshot_published`. Es entsteht nur für `kind = "delivered"` eine Zeile.
- [X] T006 [US1] Erweitere `backend/src/adapters/http/routes/ip-client-history.ts`: aus `relevantActions` die Aktionen vom Typ `traefik_config_delivery` mit `traefikProviderId` und `group` wählen (auch abgelöste), je Provider einmal die Ereignisse mit `eventStore.readStream` (Aggregattyp aus `backend/src/domain/traefik-provider/events.ts`) und den Zustand laden, `deriveDeliveries` aufrufen und `deliveries` an jede Änderung hängen (leer ohne Traefik-Aktion). `providerName` aus dem Provider-Zustand, `null` wenn nicht mehr aktiv. `executions` bleibt unverändert. Nur Daten des eigenen Accounts lesen.
- [X] T007 [US1] Erweitere `frontend/src/pages/DeviceHistory.tsx`: Typ `TraefikDelivery` (spiegelt contracts/history-api.md) im Schnittstellen-Block ergänzen, unter den Ausführungen je Änderung die Zeilen für `deliveries` mit `kind = "delivered"` rendern: Stufe als Text mit `frontend/src/components/history/ExecutionStatusIcon.tsx` (prüfen, ob die vorhandenen Statuswerte reichen, sonst schmal erweitern), Zeitstempel, bei `failed` der Fehlertext, dazu Agent-Name und Gruppe (`providerName`, `group`). Beschriftungen der Stufen: "Published, awaiting agent", "Applied", "Failed". Zeilen optisch und im Text von Ausführungen unterscheidbar, nicht als Ausführung bezeichnen. Die Leer-Meldung "No Actions were configured for this change." darf nicht erscheinen, wenn nur Traefik-Zeilen vorhanden sind.

**Checkpoint**: US1 ist eigenständig nutzbar und testbar (MVP). Änderungen, die in einem späteren Snapshot aufgingen, zeigen noch keine Zeile.

---

## Phase 4: User Story 2 - Sonderfälle verständlich erklärt bekommen (Priority: P2)

**Goal**: Gehen mehrere IP-Änderungen in einem gemeinsamen Snapshot auf, zeigen die früheren den Hinweis "zusammen mit einer späteren Änderung geliefert". Änderungen ohne Snapshot zeigen keine Zeile und keinen Fehler.

**Independent Test**: Zwei IP-Änderungen innerhalb von `BACKEND_AGENT_SNAPSHOT_COALESCE_MS` erzeugen. Die frühere zeigt den Hinweis, die letzte die Stufe. Eine Änderung ohne Inhaltsänderung zeigt keine Traefik-Zeile (quickstart.md §3 Schritte 4–5).

### Tests für User Story 2

- [X] T008 [P] [US2] Erweitere `backend/tests/unit/adapters/agent-grpc/snapshot-coordinator.test.ts`: Mehrere `schedule`-Aufrufe im Fenster mit `cause-1`, `cause-2`, `cause-3` führen zu `publish(..., "cause-3", ["cause-1", "cause-2"])`. Auslöser ohne `causationId` ändern die Liste nicht. Nach dem Lauf ist die Liste leer. Ein Auslöser während des Laufs (`dirty`) liefert im Folgelauf nur die neuen IDs. Bei `changed: false` werden keine Ereignisse behauptet (Verhalten des Publishers bleibt). Das bestehende Verhalten "letzte Ursache gewinnt" bleibt erhalten.
- [X] T009 [P] [US2] Erweitere `backend/tests/unit/domain/traefik-provider/delivery-history.test.ts`: Eine ID in `absorbedCausationIds` von `snapshot_published` oder `snapshot_publish_failed` erzeugt eine Zeile `kind = "combined"` ohne Stufe (`stage`, `at`, `error` sind `null`). Fehlendes Feld (Ereignis vor diesem Feature) erzeugt keine `combined`-Zeile. Dieselbe Änderung kann nicht gleichzeitig `delivered` und `combined` sein.
- [X] T010 [P] [US2] Erweitere `backend/tests/integration/ip-client-history-traefik.test.ts`: Zwei Änderungen über den Debounce-Pfad im Fenster → die frühere hat `kind: "combined"`, die letzte `kind: "delivered"`. Eine Änderung ohne Inhaltsänderung des Providers hat keinen Eintrag in `deliveries`.
- [X] T011 [P] [US2] Erweitere `frontend/tests/unit/device-history-page.test.tsx`: Eine `combined`-Zeile zeigt den Hinweis "zusammen mit einer späteren Änderung geliefert" ohne Stufe und Zeit. Eine Änderung ohne `deliveries`-Eintrag zeigt keine Traefik-Zeile.

### Implementierung für User Story 2

- [X] T012 [US2] Ergänze in `backend/src/domain/traefik-provider/events.ts` das optionale Feld `absorbedCausationIds?: string[]` an `TraefikProviderSnapshotPublishedData` und `TraefikProviderSnapshotPublishFailedData` (data-model.md). Der Reducer in `traefik-provider-aggregate.ts` bleibt unverändert.
- [X] T013 [US2] Ändere `backend/src/adapters/agent-grpc/snapshot-coordinator.ts`: `Pending` hält die `causationId`s des Fensters als geordnete Liste statt nur der letzten. Beim Lauf wird die letzte zur `causationId`, die übrigen gehen als vierter Parameter `absorbedCausationIds` an `publisher.publish`, danach wird die Liste geleert. `SnapshotPublishing.publish` bekommt den optionalen vierten Parameter. `startResync` und `SnapshotScheduler` (`backend/src/domain/traefik-provider/snapshot-scheduler.ts`) bleiben in der Signatur unverändert.
- [X] T014 [US2] Ändere `backend/src/adapters/queue-bullmq/snapshot-publisher.ts`: `publish(accountId, providerId, causationId?, absorbedCausationIds?)` schreibt `absorbedCausationIds` nur in `snapshot_published` und `snapshot_publish_failed`, wenn die Liste nicht leer ist. Bei unverändertem Inhalt wird weiter nichts geschrieben. `publishNow` bleibt unverändert.
- [X] T015 [US2] Erweitere `deriveDeliveries` in `backend/src/domain/traefik-provider/delivery-history.ts` um `kind = "combined"` (research.md §4, data-model.md Zustände). Die Route aus T006 braucht dafür keine Änderung, solange sie die Ereignisse unverändert übergibt.
- [X] T016 [US2] Erweitere `frontend/src/pages/DeviceHistory.tsx`: `combined`-Zeilen mit dem Hinweis "zusammen mit einer späteren Änderung geliefert" statt Stufe und Zeit.

**Checkpoint**: US1 und US2 funktionieren. Frühere Änderungen eines Fensters sind erklärt, Änderungen ohne Snapshot bleiben ohne Zeile.

---

## Phase 5: User Story 3 - Gelöschten Agent verständlich anzeigen (Priority: P3)

**Goal**: Ist der Agent einer früheren Lieferung gelöscht, bleibt die Zeile mit Stufe und Zeit erhalten und nennt "Agent nicht mehr vorhanden".

**Independent Test**: Agent löschen, History öffnen. Die Traefik-Zeile bleibt mit dem Ersatztext (spec.md US3, Edge Cases).

### Tests für User Story 3

- [X] T017 [P] [US3] Erweitere `backend/tests/integration/ip-client-history-traefik.test.ts`: Provider gelöscht oder nicht mehr aktiv → `providerName: null`, Stufe und Zeit bleiben erhalten. Die Zeile kommt weiter aus den vorhandenen Ereignissen.
- [X] T018 [P] [US3] Erweitere `frontend/tests/unit/device-history-page.test.tsx`: Bei `providerName: null` erscheint "Agent nicht mehr vorhanden", Stufe und Zeit bleiben sichtbar.

### Implementierung für User Story 3

- [X] T019 [US3] Erweitere `frontend/src/pages/DeviceHistory.tsx`: Bei `providerName = null` statt des Namens den Text "Agent nicht mehr vorhanden" anzeigen. Das Backend liefert das Feld bereits (T006).

**Checkpoint**: Alle drei Stories sind unabhängig nutzbar.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T020 [P] Prüfe, dass `specs/008-traefik-provider-config/data-model.md` und `specs/001-ip-change-automation/contracts/management-api.md` mit dem umgesetzten Verhalten übereinstimmen (Feld `absorbedCausationIds?`, `deliveries`) und passe sie an, falls die Umsetzung abweicht. Spec und Tasks von 008 nur bei Abweichung anpassen (CLAUDE.md).
- [X] T021 [P] Ergänze in `docs/12-factor-backlog.md` Punkt 4 (prozesslokales Coalescing im `SnapshotCoordinator`) um den Satz, dass auch die gesammelten `causationId`s prozesslokal sind: bei mehreren Replikas oder einem Neustart im Fenster können Hinweis-Zeilen ("zusammen mit einer späteren Änderung geliefert") fehlen, Stufen werden nie falsch angezeigt. Der Punkt bleibt offen.
- [X] T022 Führe `pnpm --filter fluxip-backend test`, `pnpm --filter fluxip-frontend test` und `pnpm run lint` aus (Postgres und Redis laufen, siehe quickstart.md). Neue Fehler sind zu beheben, bekannte Fehler der Ausgangslage getrennt zu benennen.
- [X] T023 Validiere quickstart.md §3 manuell gegen die laufende App: angewendet, nur veröffentlicht (Agent getrennt), zusammengefasst, ohne Inhaltsänderung.
- [X] T024 Bestätige, dass Agent, `proto/` und das Ausführungsmodell unverändert sind (`git diff --stat -- agent proto backend/src/adapters/queue-bullmq/execution-fanout-worker.ts` ist leer, Spec FR-012).

---

## Dependencies & Execution Order

### Phase Dependencies

- Phase 2 (Foundational): keine Abhängigkeit, blockiert die Stories.
- Phase 3 (US1): nach Phase 2. Eigenständig.
- Phase 4 (US2): nach US1, weil `deriveDeliveries`, Route und Frontend-Zeilen dort entstehen. Der Teil ohne Ableitung (T012–T014) ist unabhängig davon und kann parallel zu US1 beginnen.
- Phase 5 (US3): nach US1 (Zeilen und `providerName` aus der Route).
- Phase 6 (Polish): nach allen gewünschten Stories.

### Within Each Story

- Tests zuerst schreiben, sie müssen fehlschlagen, bevor implementiert wird.
- US1: T005 vor T006 vor T007. US2: T012 vor T013 und T014, T013 und T014 vor T015.

### Parallel Opportunities

- US1: T002, T003 und T004 parallel (verschiedene Dateien).
- US2: T008 bis T011 parallel. T012 parallel zu den US1-Aufgaben T005 bis T007, danach T013 und T014 parallel.
- US3: T017 und T018 parallel.
- Polish: T020 und T021 parallel.

### Parallel Example: User Story 1

```text
Task: "Schreibe delivery-history.test.ts" (T002)
Task: "Schreibe ip-client-history-traefik.test.ts" (T003)
Task: "Erweitere device-history-page.test.tsx" (T004)
```

---

## Implementation Strategy

### MVP First (nur User Story 1)

1. Phase 2 abschließen (T001).
2. US1 (T002–T007).
3. Prüfen: Änderung mit Traefik-Aktion zeigt Stufe und Zeit. Lieferung wird sichtbar, auch ohne Zusammenfassungs-Hinweis.

### Incremental Delivery

1. US1 → MVP, die Lücke "Traefik fehlt in der History" ist geschlossen.
2. US2 → Zusammengefasste Änderungen sind erklärt (additive Ereignisänderung, keine Migration).
3. US3 → Ersatztext bei gelöschtem Agent.

### Hinweis zu Ausrollen

Der Hinweis aus US2 erscheint nur für Snapshots, die nach dem Ausrollen von T012–T014 veröffentlicht wurden (spec.md, Assumptions). US1 wirkt rückwirkend, soweit `correlationId` und Berichte vorliegen.
