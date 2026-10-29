# Research: Traefik-Lieferung in der Geräte-History

Alle Aussagen beziehen sich auf den Ist-Stand des Repos (2026-10-29). Es gibt keine offenen `NEEDS CLARIFICATION`.

## §1 Reicht die vorhandene Korrelation für die Zuordnung? (Spec FR-005, Assumptions)

**Ist-Stand**:
- Der Debounce-Worker ruft nach `ip_changed` `snapshots.schedule(accountId, providerIds, causationEvent.id)` auf (`debounce-worker.ts`). Die ID des `ip_changed`-Ereignisses wird so zur `causationId`.
- Der `SnapshotCoordinator` fasst Auslöser je Provider im Fenster `agentSnapshotCoalesceMs` (Default 1000 ms) zusammen. Dabei überschreibt die zuletzt gesetzte `causationId` die vorherige (`entry.causationId = causationId`). Auslöser ohne `causationId` (Aktion geändert, Gerät aktiviert, Resync) lassen sie unverändert.
- Der `SnapshotPublisher` schreibt `snapshot_published` nur bei geändertem Inhaltshash. `correlationId` dieses Ereignisses ist die `causationId` oder, ohne sie, eine neue ULID. Die Version des Snapshots ist die `sequenceNumber` des Ereignisses.
- Der Agent echot im Bericht `version` und `correlationId`. `snapshot_applied` und `snapshot_apply_failed` tragen beide Felder (`agent-session-handler.ts`). `ignored_stale` wird nicht gespeichert.

**Befund**: Die direkte Zuordnung "IP-Änderung → Snapshot" ist über `correlationId == ipChangedEventId` eindeutig, aber nur für die **zuletzt** eingegangene Änderung eines Zusammenfassungsfensters. Die früheren Änderungen verlieren ihre ID. Das gilt auch geräteübergreifend, denn ein Provider-Snapshot deckt alle Geräte der Gruppe ab: Ändern sich zwei Geräte desselben Providers im selben Fenster, trägt der Snapshot nur die ID der zweiten Änderung.

**Der Hinweis "zusammen mit einer späteren Änderung geliefert" (Spec FR-006) ist aus den vorhandenen Ereignissen nicht verlässlich ableitbar.** Eine Heuristik über Zeitfenster würde zufällige spätere Snapshots (Resync, Aktionsänderung) mit "aufgegangenen" Änderungen verwechseln und die Fälle "aufgegangen" und "kein Snapshot nötig" nicht trennen. Das ist genau das Risiko, das die Spec in den Assumptions benennt.

## §2 Entscheidung: Aufgegangene Änderungen am Snapshot mitführen

**Entscheidung**: `snapshot_published` und `snapshot_publish_failed` bekommen ein **optionales** Feld `absorbedCausationIds: string[]`. Es enthält die IDs aller Änderungen, die im Fenster zusammengefasst wurden, ausgenommen die, die als `correlationId` dient. Der `SnapshotCoordinator` sammelt dafür alle `causationId`s des Fensters, statt nur die letzte zu behalten, und reicht sie dem Publisher durch.

**Begründung**:
- Es wird nur festgehalten, was die Koordinatoren zum Zeitpunkt der Veröffentlichung ohnehin wissen. Die Aussage "Änderung X ist in Snapshot Y geliefert worden" ist dadurch exakt und nicht geschätzt.
- Das Feld ist additiv. Alte Ereignisse lesen sich unverändert. Agent, Protokoll und Ausführungsmodell bleiben unberührt (Spec FR-012).
- Die Alternative, die Information erst in der History-Route aus Zeitstempeln zu raten, liefert falsche Aussagen.

**Verworfen**:
- *Heuristik über Zeitfenster/Zeitstempel*: nicht eindeutig (§1).
- *Änderung am Agent-Protokoll*: unnötig, der Agent kennt die IP-Änderungen nicht und muss nichts melden.
- *Neue Projektion oder Redis-Index*: widerspricht dem Replay-Muster der History-Route und ist bei dem kleinen Umfang unnötig (008 research.md §5).

**Folge für die Spec**: Der Hinweis in FR-006 gilt nur für Snapshots, die nach Auslieferung des Features veröffentlicht wurden. Ältere Änderungen, die in einem Snapshot aufgingen, zeigen keine Zeile (Spec-Assumption "Fallback"). Die Spec wird dazu im selben Zug ergänzt.

## §3 Stufe einer Lieferung bestimmen

**Entscheidung**: Für den Snapshot mit Version `v` (= `sequenceNumber` des `snapshot_published`-Ereignisses) gilt, in dieser Reihenfolge:

1. **angewendet**, wenn es ein `snapshot_applied` mit `version >= v` gibt. Zeit: `appliedAt` des ersten solchen Ereignisses.
2. **Fehler**, wenn es ein `snapshot_apply_failed` mit `version == v` gibt. Zeit: dessen `appliedAt`, Ursache: `reason`. Bei `snapshot_publish_failed` zu dieser Änderung ebenfalls Fehler, mit `reason` (`too_large`, `internal`) und `failedAt`.
3. sonst **veröffentlicht** (ausstehend). Zeit: `publishedAt`.

**Begründung**: Das spiegelt `deriveDeliveryStatus` in `delivery-status.ts` (008 research.md §12): Der Agent meldet Versionen, nicht Inhalte. Wird `v` von einer neueren Version überholt, bevor der Agent `v` berichtet, gilt `v` mit der Anwendung der neueren Version als angewendet, statt ewig "ausstehend" zu bleiben. Ein späteres `snapshot_applied` überdeckt einen früheren `snapshot_apply_failed` derselben Version nicht, weil der Fehler zu `v` gehört und `applied` mit `version >= v` Vorrang hat (die neuere Version wurde erfolgreich angewendet).

**Verworfen**: Nur auf `version == v` prüfen. Ergäbe bei überholten Versionen dauerhaft "ausstehend", obwohl der Agent den Zustand längst hat.

## §4 Welche Aktionen und Provider werden einbezogen

**Entscheidung**: Die History-Route lädt ohnehin alle Aktionen des Geräts (`relevantActions`). Daraus werden die Aktionen vom Typ `traefik_config_delivery` mit ihrer `traefikProviderId` und `group` genommen, **auch abgelöste** (die Konfiguration bleibt im Aktions-Zustand erhalten). Je Provider werden die Ereignisse des Aggregats `traefik_provider` einmal gelesen (`readStream`), nicht je Änderung.

Eine Zeile entsteht für (Änderung, Aktion), wenn das `snapshot_published`/`snapshot_publish_failed`-Ereignis des Providers `correlationId == ipChangedEventId` hat (Hauptzeile) oder die ID in `absorbedCausationIds` steht (Hinweis-Zeile). Es gibt keine zeitliche Rückrechnung des Aktionsverlaufs (Clarification 2026-10-29).

**Agent gelöscht**: Der Aggregat-Stream bleibt lesbar. Für den Namen wird der Provider-Zustand geladen; ist er nicht mehr aktiv oder fehlt, nennt die Zeile "Agent nicht mehr vorhanden" und behält Stufe und Zeit, soweit die Ereignisse vorliegen.

**Mehrere Aktionen am selben Provider/Gerät**: Laut 008 höchstens eine je Gerät und Provider-Konfiguration. Existieren dennoch mehrere (etwa mit unterschiedlichen Gruppen), bekommt jede ihre eigene Zeile mit derselben Stufe.

## §5 Aufwand und Skalierung

Die History-Route lädt bereits alle Aktionen und Ausführungen des Accounts per Replay (kleiner Maßstab). Neu hinzu kommen je Provider ein `readStream` und die Auswertung im Speicher. Bei der Zahl der Provider je Gerät (typisch ein bis wenige) ist das vernachlässigbar. Keine Paginierung auf dem Server, wie bisher.

## §6 Bestehende Dokumente, die mitgezogen werden

- `specs/008-traefik-provider-config/data-model.md`: Ereignis-Payloads von `snapshot_published` und `snapshot_publish_failed` um das optionale Feld `absorbedCausationIds` ergänzen.
- `specs/001-ip-change-automation/contracts/management-api.md`: Zeile zu `GET /api/ip-clients/{id}/history` um `deliveries` ergänzen.
- Nicht betroffen: `agent-session.proto.md`, Go-Agent, Ausführungsmodell (008 research.md §2).
