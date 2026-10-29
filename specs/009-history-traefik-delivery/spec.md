# Feature Specification: Traefik-Lieferung in der Geräte-History

**Feature Branch**: `009-history-traefik-delivery`

**Created**: 2026-10-29

**Status**: Draft

**Input**: User description: "Die Geräte-History soll pro bestätigter IP-Änderung auch die Lieferung an Traefik-Agents zeigen: je Traefik-Aktion eine Zeile mit Stufe (veröffentlicht, vom Agent angewendet, Fehler, ausstehend) und Zeitstempel. Bisher zeigt die History nur Ausführungen (DNS, Firewall); Traefik-Aktionen werden nicht als Ausführung geführt, ihr Lieferstatus steht nur auf der Aktionskarte, sodass die History für eine IP-Änderung unvollständig wirkt."

> Baut auf [008-traefik-provider-config](../008-traefik-provider-config/spec.md) auf. Das Ausführungsmodell und der Agent bleiben unverändert (008, research.md §2).

## Clarifications

### Session 2026-10-29

- Q: Welche Traefik-Aktionen bekommen bei einer älteren IP-Änderung eine Zeile? → A: Nur Aktionen, deren Provider zu dieser Änderung tatsächlich einen Snapshot veröffentlicht hat, plus der Hinweis "zusammen mit einer späteren Änderung geliefert", wenn die Änderung in einem später veröffentlichten Snapshot aufging. Für "keine Änderung nötig" gibt es keine Zeile.

## Kontext und Ziel

Die Geräte-History ("Reported updates") listet jede bestätigte IP-Änderung eines Geräts und darunter, was daraufhin passiert ist. Für DNS- und Firewall-Aktionen sind das Ausführungen mit Status. Aktionen vom Typ Traefik-Konfigurationslieferung laufen bewusst nicht als Ausführung: Sie sind ein Zustandsabgleich, und "angewendet" entsteht erst beim Agent, später und an anderer Stelle. Ihr Lieferstatus ist nur auf der Aktionskarte sichtbar, und zwar als aktueller Stand, nicht je IP-Änderung.

Folge: Wer die History zu einer IP-Änderung öffnet, sieht DNS und Firewall, aber keine Traefik-Aktion, und schließt daraus fälschlich, die Traefik-Aktion sei nicht gelaufen. Ziel dieses Features ist, die History für diese Aktionen vollständig und ehrlich zu machen, ohne Traefik-Lieferungen als Ausführungen zu verkleiden.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Lieferstand einer IP-Änderung nachvollziehen (Priority: P1)

Als Nutzer öffne ich die History eines Geräts, das Traefik-Aktionen hat, und sehe unter jeder IP-Änderung für jede dieser Aktionen eine Zeile mit der erreichten Stufe und einem Zeitstempel.

**Why this priority**: Das ist die eigentliche Lücke. Ohne diese Zeilen wirkt die History für Geräte mit Traefik-Aktionen unvollständig und irreführend.

**Independent Test**: Gerät mit einer DNS- und einer Traefik-Aktion anlegen, eine IP-Änderung bestätigen lassen, den Agent anwenden lassen. In der History erscheinen unter der Änderung die DNS-Ausführung und eine Traefik-Zeile mit der Stufe "angewendet" und Zeitstempel.

**Acceptance Scenarios**:

1. **Given** ein Gerät mit einer aktiven Traefik-Aktion und eine bestätigte IP-Änderung, die zu einem neuen Snapshot geführt hat, **When** der Agent den Snapshot erfolgreich angewendet hat, **Then** zeigt die History zu dieser Änderung eine Zeile für die Aktion mit Agent-Name, Gruppe, Stufe "angewendet" und dem Zeitpunkt der Anwendung.
2. **Given** dieselbe Konstellation, **When** der Snapshot veröffentlicht, aber noch nicht vom Agent bestätigt ist (z. B. Agent offline), **Then** zeigt die Zeile die Stufe "veröffentlicht" mit dem Veröffentlichungszeitpunkt und kennzeichnet die Lieferung als ausstehend.
3. **Given** dieselbe Konstellation, **When** der Agent die Anwendung mit einem Fehler meldet, **Then** zeigt die Zeile die Stufe "Fehler" mit Zeitpunkt und der gemeldeten Ursache.
4. **Given** ein Gerät mit mehreren Traefik-Aktionen (verschiedene Provider), **When** die History geöffnet wird, **Then** erscheint je Aktion eine eigene Zeile mit der Stufe des jeweiligen Providers.
5. **Given** ein Gerät mit DNS-, Firewall- und Traefik-Aktion, **When** die History geöffnet wird, **Then** stehen Ausführungen und Traefik-Zeilen gemeinsam unter derselben IP-Änderung und sind als Art unterscheidbar.

---

### User Story 2 - Sonderfälle verständlich erklärt bekommen (Priority: P2)

Als Nutzer sehe ich auch dann eine nachvollziehbare Aussage, wenn mehrere IP-Änderungen in einem gemeinsamen Snapshot geliefert wurden, und keinen falschen Fehler, wenn für eine Änderung kein Snapshot nötig war.

**Why this priority**: Ohne diese Erklärungen wirkten gerade die häufigen Randfälle wie ein Defekt. Die Kernanzeige aus Story 1 funktioniert aber auch ohne sie.

**Independent Test**: Zwei IP-Änderungen kurz hintereinander erzeugen (zusammengefasst durch das Entprellfenster) und eine Änderung, die den Provider-Inhalt nicht verändert. Die History erklärt den ersten Fall und zeigt im zweiten keine Zeile.

**Acceptance Scenarios**:

1. **Given** mehrere IP-Änderungen, die in einem gemeinsamen Snapshot geliefert wurden, **When** die History geöffnet wird, **Then** zeigt die letzte Änderung die Lieferstufe, und die früheren Änderungen zeigen den Hinweis "zusammen mit einer späteren Änderung geliefert".
2. **Given** eine IP-Änderung, zu der der Provider keinen Snapshot veröffentlicht hat (Inhalt unverändert), **When** die History geöffnet wird, **Then** erscheint für diese Änderung keine Traefik-Zeile, und die History zeigt keinen Fehler und keine Lieferstufe.
3. **Given** eine Traefik-Aktion, die zum Zeitpunkt der IP-Änderung noch nicht existierte oder deaktiviert war, **When** die History geöffnet wird, **Then** erscheint für diese Änderung keine Zeile für diese Aktion.

---

### User Story 3 - Gelöschten Agent verständlich anzeigen (Priority: P3)

Als Nutzer sehe ich auch dann eine verständliche Zeile, wenn der Agent einer früheren Lieferung inzwischen gelöscht wurde.

**Why this priority**: Randfall. Name und Gruppe der Zeilen liefert bereits Story 1.

**Independent Test**: Agent löschen, History öffnen. Die frühere Traefik-Zeile bleibt mit Stufe und Zeit erhalten und nennt "Agent nicht mehr vorhanden".

**Acceptance Scenarios**:

1. **Given** eine Traefik-Zeile zu einem inzwischen gelöschten Agent, **When** die History geöffnet wird, **Then** zeigt die Zeile weiter Stufe und Zeitpunkt und statt des Namens "Agent nicht mehr vorhanden", ohne Fehler.

---

### Edge Cases

- Die Aktion wurde nach der IP-Änderung abgelöst (detached) oder der Agent gelöscht: Die Zeile bleibt für die damalige Änderung nachvollziehbar, soweit die Ereignisse vorliegen, und nennt den Agent weiterhin. Fehlen die Angaben, erscheint "Agent nicht mehr vorhanden" statt eines Fehlers.
- Eine IP-Änderung, die den Provider-Inhalt nicht verändert hat: Es gibt keine Traefik-Zeile. Das ist beabsichtigt (siehe Clarifications), weil die Zeilen Lieferungen belegen und keine Aktionen auflisten.
- Der Agent meldet eine veraltete Version (ignorierter, nicht gespeicherter Bericht): Es entsteht keine neue Stufe. Die Zeile bleibt bei der letzten bekannten Stufe.
- Der Snapshot war zu groß und konnte nicht veröffentlicht werden: Die Zeile zeigt "Fehler" mit dieser Ursache, nicht "ausstehend".
- Die Reihenfolge der Ereignisse (veröffentlicht, angewendet, Fehler) für dieselbe Änderung: Maßgeblich ist die zuletzt erreichte Stufe.
- Ein Gerät ohne Traefik-Aktionen: Die History ändert sich nicht.
- Wird eine Aktion auf einen anderen Provider umgestellt, zeigt die History Lieferungen nur zum aktuellen Provider. Lieferungen zum früheren erscheinen nicht mehr.
- Sehr alte IP-Änderungen aus der Zeit vor diesem Feature: Es gelten dieselben Regeln, soweit die Ereignisse vorliegen. Fehlen sie, gibt es keine Zeile und keinen Fehler.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Die Geräte-History MUSS unter jeder bestätigten IP-Änderung für jede Traefik-Aktion des Geräts eine eigene Zeile zeigen, deren Provider zu dieser Änderung einen Snapshot veröffentlicht hat oder deren Änderung in einem später veröffentlichten Snapshot aufging (FR-006).
- **FR-002**: Jede Zeile MUSS die zuletzt erreichte Stufe der Lieferung zeigen: veröffentlicht (ausstehend), angewendet oder Fehler.
- **FR-003**: Jede Zeile MUSS den Zeitpunkt der angezeigten Stufe zeigen.
- **FR-004**: Bei Stufe "Fehler" MUSS die Zeile die gemeldete Ursache zeigen.
- **FR-005**: Die Zuordnung einer Lieferung zu einer IP-Änderung MUSS über die Korrelation zwischen der IP-Änderung und dem daraus entstandenen Snapshot erfolgen (008, FR-061). Reichen die vorhandenen Ereignisse dafür nicht (zusammengefasste Änderungen), MÜSSEN die aufgegangenen Änderungen am Snapshot-Ereignis festgehalten werden. Agent und Agent-Protokoll bleiben dabei unverändert.
- **FR-006**: Wurden mehrere IP-Änderungen in einem gemeinsamen Snapshot geliefert, MUSS die Lieferstufe an der Änderung stehen, der der Snapshot zugeordnet ist. Für die früheren Änderungen, die darin aufgingen, MUSS der Hinweis "zusammen mit einer späteren Änderung geliefert" erscheinen.
- **FR-007**: Hat eine IP-Änderung keinen Snapshot für den Provider ausgelöst und ging auch in keinem später veröffentlichten auf, MUSS für diese Aktion keine Zeile erscheinen. Das ist kein Fehler.
- **FR-008**: Berichte des Agents zu veralteten Versionen, die nicht gespeichert werden, DÜRFEN keine neue Stufe erzeugen.
- **FR-009**: Traefik-Zeilen MÜSSEN von Ausführungen (DNS, Firewall) unterscheidbar sein und DÜRFEN nicht als Ausführung bezeichnet oder gezählt werden.
- **FR-010**: Jede Traefik-Zeile MUSS den Namen des Agents und die Gruppe nennen.
- **FR-011**: Für Geräte ohne Traefik-Aktionen MUSS die History unverändert bleiben.
- **FR-012**: Das Ausführungsmodell (keine Ausführungen für Traefik-Aktionen), das Agent-Protokoll und der Agent MÜSSEN unverändert bleiben.
- **FR-013**: Die Anzeige MUSS ausschließlich Daten des eigenen Accounts zeigen, wie die übrige History.

### Key Entities

- **IP-Änderung**: Bestätigte Adressänderung eines Geräts, Ankerpunkt jeder History-Zeile.
- **Traefik-Lieferung (je IP-Änderung)**: Abgeleitete Sicht auf eine Traefik-Aktion und eine IP-Änderung mit Stufe (veröffentlicht, angewendet, Fehler, zusammengefasst), Zeitpunkt, Agent-Name, Gruppe und gegebenenfalls Fehlerursache. Keine eigene gespeicherte Größe.
- **Traefik-Aktion**: Aktion des Geräts, die Daten an einen Agent liefert (008).
- **Snapshot**: Vom Agent angewendete Konfigurationsversion, trägt die Korrelation zur auslösenden IP-Änderung.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Für 100 % der IP-Änderungen eines Geräts mit Traefik-Aktionen zeigt die History für jede Traefik-Aktion, zu der ein Snapshot oder ein Aufgehen in einem späteren Snapshot belegt ist, genau eine Zeile oder den erklärenden Hinweis "zusammen mit einer späteren Änderung geliefert". Änderungen ohne Snapshot für den Provider zeigen keine Zeile.
- **SC-002**: Ein Nutzer kann ohne Blick in Logs oder auf die Aktionsseite sagen, ob die Lieferung einer bestimmten IP-Änderung angekommen ist, fehlgeschlagen ist oder noch aussteht.
- **SC-003**: Die Stufe einer Zeile ändert sich spätestens beim nächsten Laden der History nach der Rückmeldung des Agents.
- **SC-004**: Für Geräte ohne Traefik-Aktionen sind Inhalt und Ladeverhalten der History unverändert.
- **SC-005**: Die Anzeige der bisherigen Ausführungen (DNS, Firewall) ist nach dem Feature identisch zu vorher.

## Assumptions

- Die Korrelation zwischen IP-Änderung und Snapshot besteht bereits (008, FR-061). Sie reicht für die zuletzt eingegangene Änderung eines Zusammenfassungsfensters. Für die früheren Änderungen wird sie ergänzt (research.md §2).
- Zusammenfassen mehrerer Änderungen durch das Entprellfenster ist gewollt.
- Die Anzeige beschreibt den Stand je IP-Änderung, nicht den aktuellen Gesamtstand. Der aktuelle Lieferstatus bleibt auf der Aktionskarte (008).
- Es gibt keine zeitliche Rückrechnung des Aktionsverlaufs: Eine Zeile entsteht nur, wenn ein Snapshot des Providers zur Änderung belegt ist. Ob eine Aktion dem Gerät zugeordnet ist, ergibt sich aus der Aktion bzw. dem Snapshot-Ereignis zur Änderung.
- Ob eine Änderung in einem später veröffentlichten Snapshot aufging, muss sich aus den vorhandenen Ereignissen verlässlich ableiten lassen. Der Plan (research.md §1–§2) zeigt: Mit den heutigen Ereignissen ist das nicht eindeutig. Deshalb trägt der Snapshot künftig die IDs der aufgegangenen Änderungen. Der Hinweis in FR-006 gilt daher nur für Snapshots, die nach Auslieferung dieses Features veröffentlicht wurden. Ältere zusammengefasste Änderungen zeigen keine Zeile.
- Die Zeitstempel sind die der gespeicherten Ereignisse; es wird kein neuer Zeitgeber eingeführt.
- Spec und Tasks von Feature 008 werden bei Abweichung im selben Zug angepasst. Angepasst sind bereits `008/data-model.md` (zwei optionale Ereignisfelder) und der History-Eintrag in `001/contracts/management-api.md`.
- Sprache der Oberfläche und Begriffe folgen der vorhandenen History ("Reported updates").
