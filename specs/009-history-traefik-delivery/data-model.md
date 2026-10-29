# Data Model: Traefik-Lieferung in der Geräte-History

Es gibt **keine neue gespeicherte Entität** und keine Migration. Die Lieferung je IP-Änderung ist eine abgeleitete Sicht, die bei jeder History-Anfrage aus Ereignissen berechnet wird (research.md §2–§4).

## Änderung an bestehenden Ereignissen

| Ereignis | Neues Feld | Bedeutung |
|---|---|---|
| `snapshot_published` | `absorbedCausationIds?: string[]` | IDs der `ip_changed`-Ereignisse, die im selben Zusammenfassungsfenster eintrafen und in diesem Snapshot geliefert wurden. Nicht enthalten ist die ID, die als `correlationId` dient. Fehlt bei Ereignissen vor diesem Feature, gleichbedeutend mit leer. |
| `snapshot_publish_failed` | `absorbedCausationIds?: string[]` | wie oben, für fehlgeschlagene Veröffentlichung (`too_large`, `internal`). |

Die Version eines Snapshots bleibt die `sequenceNumber` des `snapshot_published`-Ereignisses. `snapshot_applied` und `snapshot_apply_failed` bleiben unverändert.

## Abgeleitete Sicht: Traefik-Lieferung (je IP-Änderung und Aktion)

| Feld | Quelle |
|---|---|
| `actionId` | Traefik-Aktion des Geräts |
| `traefikProviderId`, `providerName`, `group` | Aktion (`config`) und Provider-Zustand. `providerName` ist `null`, wenn der Provider nicht mehr aktiv ist. |
| `kind` | `delivered` (Hauptzeile, `correlationId == ipChangedEventId`) oder `combined` (ID in `absorbedCausationIds`) |
| `stage` | `published` \| `applied` \| `failed` (nur bei `kind = delivered` gesetzt) |
| `at` | Zeitpunkt der Stufe: `publishedAt`, `appliedAt` oder `failedAt` (nur bei `kind = delivered`) |
| `error` | `reason` bei `stage = failed`, sonst `null` |
| `version` | Snapshot-Version, falls veröffentlicht (nur Diagnose) |

### Regeln

- Eine Zeile je Paar (IP-Änderung, Traefik-Aktion), für das ein Ereignis des Providers die Änderung als `correlationId` oder in `absorbedCausationIds` nennt. Sonst keine Zeile (Spec FR-007).
- Stufenbestimmung für `kind = delivered`: research.md §3.
- `kind = combined` trägt keine Stufe. Die Oberfläche zeigt den Hinweis "zusammen mit einer späteren Änderung geliefert".
- Die Zeile gehört zum Gerät und zum Account der History (Spec FR-013). Provider anderer Accounts werden nie gelesen.

### Zustände

```
(kein Ereignis)            → keine Zeile
snapshot_published         → published
  + snapshot_applied (>= v) → applied
  + snapshot_apply_failed (= v), kein applied (>= v) → failed
snapshot_publish_failed    → failed
ID in absorbedCausationIds → combined
```
