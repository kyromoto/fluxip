# Feature Specification: Verteilung dynamischer Traefik-Konfiguration an Agents

**Feature Branch**: `008-traefik-provider-config`

**Created**: 2026-10-21

**Status**: Draft

**Input**: User description: "FluxIP soll dynamische Daten (zunächst die aktuellen IPs von Geräten) an Traefik-Instanzen auf abgesetzten Systemen verteilen. Der Primäranwendungsfall ist die IP-Liste einer `ipAllowList`-Middleware, der Mechanismus ist aber generisch für beliebige dynamische Traefik-Konfiguration. Pro Account gibt es einen neuen Konfigurationstyp 'Traefik-Provider-Konfiguration'. Er konfiguriert die Authentifizierung eines Agents und legt die Adresse fest, unter der der Agent FluxIP erreicht. Eine neue Aktion an Geräten wählt eine solche Konfiguration aus, sodass Änderungen an diesen Geräten an den zugehörigen Agent geliefert werden. Der Agent ist ein einzelnes Binary neben Traefik, rendert lokale Vorlagen mit den gelieferten Daten und schreibt das Ergebnis atomar in das Verzeichnis von Traefiks File Provider. Für den Verbindungsaufbau sind zwei Varianten vorgesehen (Agent ruft FluxIP an, FluxIP ruft Agent an), umgesetzt wird zunächst nur die erste. Die gesamte Mechanik nach dem Verbindungsaufbau ist für beide Varianten gleich."

> Technische Vorentscheidungen für die Planung stehen in [plan-input.md](plan-input.md) und nicht in dieser Spezifikation.

## Clarifications

### Session 2026-10-21

- Q: Wie oft darf ein Gerät die Aktion je Provider haben? → A: Höchstens einmal je Gerät und Provider-Konfiguration (Entscheidung bei der Umsetzung, Vorschlag aus der Analyse).
- Q: Ab wann zählen die 10 Sekunden in SC-001? → A: Ab der bestätigten IP-Änderung (nach dem bestehenden Entprellfenster); das Fenster bleibt unverändert.

## Kontext und Ziel

FluxIP kennt die aktuellen IP-Adressen von Geräten, die per DynDNS-Ereignis ihre Adresse melden. Abgesetzte Systeme betreiben je einen eigenen Traefik. Dessen dynamische Konfiguration (Middlewares, Services, Router, TLS) soll Werte aus FluxIP verwenden können, ohne dass jemand Dateien von Hand anpasst. Router und Services der Standorte laufen bisher über Labels, Middlewares über den File Provider. An dieser Aufteilung ändert sich nichts. Es wird nur die Pflege der dynamischen Teile automatisiert.

FluxIP liefert ausschließlich Daten. Das Zielformat bestimmen lokale Vorlagen beim Agent. Dadurch ist FluxIP nicht an einen bestimmten Konfigurationsaufbau gebunden, und der Allow-List-Fall ist nur eine von mehreren möglichen Vorlagen. Ein zweiter Fall, der dieselbe Mechanik nutzt, ist ein Service, dessen Upstream-Adresse die dynamische IP eines Geräts ist.

## Begriffe

| Begriff | Bedeutung |
|---|---|
| Provider-Konfiguration | Konfiguration auf Account-Ebene, die einen Agent beschreibt: Name, Verbindungsart, Agent-Adresse, Zugangsdaten |
| Agent | Programm am abgesetzten System, das aus Vorlagen und gelieferten Daten Dateien für Traefik erzeugt |
| Aktion | Aktion eines Geräts. Hier neu: eine Aktion, die eine Provider-Konfiguration auswählt und die Daten des Geräts dorthin liefert |
| Gruppe | Frei benannter Schlüssel in der Aktion (z. B. `admin-allowlist`). Vorlagen wählen darüber die Einträge aus |
| Eintrag | Daten eines Geräts in einer Gruppe: Gerätename und aktuell bekannte IPs |
| Snapshot | Vollständiger Stand einer Provider-Konfiguration (alle Gruppen mit ihren Einträgen) mit Versionsnummer |
| Vorlage | Lokale Textdatei beim Agent, aus der eine Konfigurationsdatei gerendert wird |
| Fallback | Inhalt, den eine Vorlage ausgibt, wenn eine Gruppe leer ist oder FluxIP zu lange nicht erreichbar war |
| Verbindungsart | Wer die Verbindung aufbaut: der Agent zu FluxIP (Variante A) oder FluxIP zum Agent (Variante B) |
| Sitzung | Der Austausch von Snapshots und Berichten nach erfolgtem Verbindungsaufbau, unabhängig von der Verbindungsart |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Provider-Konfiguration anlegen und Agent in Betrieb nehmen (Priority: P1)

Ein Benutzer legt eine Provider-Konfiguration an, bekommt Zugangsdaten und die Agent-Adresse, startet den Agent am abgesetzten System und sieht, dass die Verbindung steht und Dateien geschrieben wurden.

**Why this priority**: Ohne Konfiguration und Agent gibt es keine Verteilung. Die Geschichte ist der kleinste sinnvolle Durchstich.

**Independent Test**: Konfiguration anlegen, Agent mit Token und Adresse starten, Zielverzeichnis prüfen.

**Acceptance Scenarios**:

1. **Given** ein angemeldeter Benutzer, **When** er im Ablauf "Traefik-Provider-Konfiguration anlegen" einen Namen vergibt, **Then** ist die Verbindungsart "Agent verbindet zu FluxIP" vorausgewählt, und FluxIP zeigt einmalig das Token sowie die Agent-Adresse, einen kopierbaren Startbefehl und ein Beispiel für die Traefik-Konfiguration.
2. **Given** ein Agent mit gültigem Token und Adresse, **When** er startet, **Then** zeigt FluxIP die Konfiguration innerhalb von 10 Sekunden als verbunden, der Agent hat einen ersten Snapshot (auch leer) erhalten und seine Vorlagen gerendert.
3. **Given** ein ungültiges oder widerrufenes Token, **When** der Agent sich verbindet, **Then** wird er abgelehnt, schreibt keine Datei und gibt eine verständliche Fehlermeldung aus.
4. **Given** zwei Provider-Konfigurationen im selben Account, **When** beide Agents verbunden sind, **Then** hat jede eine eigene Adresse und eigene Zugangsdaten, und kein Agent erhält Daten der anderen Konfiguration.
5. **Given** ein Benutzer ohne Kenntnis der Interna, **When** er dem Ablauf folgt, **Then** kann er die Konfiguration ohne Nachschlagen externer Dokumentation in Betrieb nehmen.

---

### User Story 2 - Geräteaktion mit einer Provider-Konfiguration verknüpfen (Priority: P1)

Ein Benutzer legt an einem Gerät eine Aktion an, wählt eine Provider-Konfiguration und eine Gruppe. Ab dann fließen die Daten des Geräts zu diesem Agent.

**Why this priority**: Ohne diese Verknüpfung erreichen keine Gerätedaten den Agent.

**Independent Test**: Aktion anlegen, Snapshot der Konfiguration beobachten.

**Acceptance Scenarios**:

1. **Given** ein Gerät und eine Provider-Konfiguration desselben Accounts, **When** der Benutzer eine Aktion dieses Typs anlegt, **Then** wählt er in einem Schritt-für-Schritt-Ablauf die Konfiguration und die Gruppe, wobei bereits genutzte Gruppen vorgeschlagen werden.
2. **Given** eine gespeicherte Aktion und ein Gerät mit bekannter IP, **When** der Snapshot gebildet wird, **Then** enthält die Gruppe einen Eintrag mit Gerätename und IPs.
3. **Given** mehrere Geräte mit derselben Konfiguration und Gruppe, **When** der Snapshot gebildet wird, **Then** stehen alle Einträge in derselben Gruppe.
4. **Given** eine geänderte oder gelöschte Aktion oder ein deaktiviertes Gerät, **When** die Änderung gespeichert wird, **Then** verschwindet der Eintrag aus der bisherigen Gruppe, und die betroffene Konfiguration erhält einen neuen Snapshot.
5. **Given** ein Gerät mit Aktionen für mehrere Provider-Konfigurationen, **When** sich seine IP ändert, **Then** erhält jede dieser Konfigurationen den neuen Stand.
6. **Given** die Auswahl der Konfiguration, **When** sie angezeigt wird, **Then** sind nur Konfigurationen des eigenen Accounts wählbar.

---

### User Story 3 - IP-Änderung wird automatisch wirksam (Priority: P1)

Ändert sich die IP eines Geräts, steht die neue Adresse kurz danach in der gerenderten Datei des betroffenen Agents.

**Why this priority**: Das ist der eigentliche Nutzen des Features.

**Independent Test**: DynDNS-Ereignis mit neuer IP auslösen, Zieldatei am verbundenen Agent beobachten.

**Acceptance Scenarios**:

1. **Given** ein verbundener Agent, **When** sich die IP eines Geräts mit zugehöriger Aktion ändert, **Then** enthält die Zieldatei innerhalb der Zielzeit (SC-001) die neue und nicht mehr die alte Adresse.
2. **Given** eine Änderung, die nur andere Provider-Konfigurationen betrifft, **When** sie eintritt, **Then** erhält dieser Agent keinen neuen Snapshot.
3. **Given** eine Änderung, die das Ergebnis nicht verändert, **When** ein neuer Snapshot eintrifft, **Then** wird keine Datei neu geschrieben.
4. **Given** mehrere Änderungen in kurzer Folge, **When** sie den Agent erreichen, **Then** entspricht der Endzustand der Dateien der zuletzt gültigen Version.
5. **Given** ein Agent, der einen älteren Snapshot nach einem neueren erhält, **When** er ihn verarbeitet, **Then** wird der ältere ignoriert.

---

### User Story 4 - Vorlagen für beliebige dynamische Konfiguration (Priority: P1)

Der Betreiber legt beliebig viele Vorlagen für Traefik-Konfiguration an. Der Agent erzeugt daraus Dateien und behandelt leere Gruppen und Fehler sicher. Der Allow-List-Fall ist eine davon.

**Why this priority**: Die Generizität ist Kern des Features, und der Fallback verhindert, dass eine leere Allow-List Traefiks Middleware ungültig macht.

**Independent Test**: Zwei Vorlagen anlegen, Snapshots mit gefüllter und leerer Gruppe liefern, Ergebnis prüfen.

**Acceptance Scenarios**:

1. **Given** ein Vorlagenverzeichnis mit mehreren Vorlagen, **When** ein Snapshot eintrifft, **Then** entsteht aus jeder Vorlage eine Datei im Zielverzeichnis, deren Name sich aus dem Vorlagennamen und einem Präfix ergibt.
2. **Given** eine Vorlage mit Bedingung für eine leere Gruppe, **When** die Gruppe keine Einträge hat, **Then** wird der Fallback-Zweig gerendert und nie eine ungültige Datei erzeugt.
3. **Given** mehrere Vorlagen, von denen eine ein ungültiges Ergebnis liefert, **When** der Agent rendert, **Then** wird keine Datei verändert (alles oder nichts), die bisherigen Dateien bleiben, und der Fehler wird an FluxIP gemeldet.
4. **Given** die mitgelieferten Beispielvorlagen (Allow-List-Middleware, Service mit dynamischer Upstream-Adresse), **When** der Benutzer sie per Kommando ausgeben lässt, **Then** sind sie ohne Änderung der Programmlogik nutzbar und lassen sich anpassen.
5. **Given** eine entfernte Vorlage, **When** der Agent erfolgreich anwendet, **Then** wird auch die zuvor daraus erzeugte Datei entfernt.
6. **Given** Dateien im Zielverzeichnis ohne das Präfix des Agents, **When** der Agent arbeitet, **Then** werden sie weder gelesen, geändert noch gelöscht.

---

### User Story 5 - Betrieb bei Ausfall und Neustart (Priority: P1)

Fällt FluxIP oder die Verbindung aus oder startet das abgesetzte System neu, bleibt Traefik funktionsfähig, und nach der Rückkehr gleicht sich der Stand von selbst ab.

**Why this priority**: Genau dieses Verhalten ist der Grund für einen Agent mit lokalen Dateien statt eines reinen Abruf-Providers.

**Independent Test**: Verbindung trennen, Agent und Traefik neu starten, Verbindung wiederherstellen.

**Acceptance Scenarios**:

1. **Given** eine abgebrochene Verbindung, **When** sie gestört bleibt, **Then** bleiben die Dateien unverändert, und der Agent versucht mit wachsendem Abstand erneut zu verbinden.
2. **Given** ein Neustart des Agents ohne erreichbares FluxIP und vorhandene Dateien, **When** der Agent startet, **Then** bleiben die Dateien unverändert.
3. **Given** ein Start ohne erreichbares FluxIP und ohne erzeugte Dateien, **When** der Agent startet, **Then** rendert er alle Vorlagen mit leeren Gruppen, sodass die Fallbacks greifen.
4. **Given** eine Offline-Dauer über der konfigurierten Höchstdauer, **When** sie überschritten wird, **Then** rendert der Agent erneut, wobei die Vorlagen über eine Kennzeichnung "veraltet" erkennen, dass die Daten nicht mehr aktuell sind, damit eine alte Adresse nicht unbegrenzt erlaubt bleibt.
5. **Given** ein Neustart oder Update von FluxIP, **When** die Agents die Verbindung neu aufbauen, **Then** erhalten sie ohne Zutun den vollständigen aktuellen Stand.

---

### User Story 6 - Status und Rückmeldung einsehen (Priority: P2)

Der Benutzer sieht je Provider-Konfiguration, ob der Agent verbunden ist und welche Version er angewendet hat, und je Aktion, ob der aktuelle Wert dort angekommen ist.

**Why this priority**: Wichtig für Vertrauen und Fehlersuche, aber die Verteilung funktioniert auch ohne.

**Independent Test**: Übersicht öffnen, Agent trennen und wieder verbinden, Wert ändern.

**Acceptance Scenarios**:

1. **Given** mehrere Provider-Konfigurationen, **When** der Benutzer die Übersicht öffnet, **Then** sieht er je Konfiguration den Zustand (verbunden, getrennt, veraltet), den Zeitpunkt der letzten Verbindung, die angewendete Version und die Agent-Version.
2. **Given** eine Aktion, **When** der Benutzer ihre Details öffnet, **Then** sieht er, ob der letzte Wert angewendet, ausstehend oder wegen eines Fehlers nicht angewendet ist, oder ob der Agent getrennt ist.
3. **Given** ein Fehler beim Anwenden, **When** der Agent ihn meldet, **Then** sieht der Benutzer den Grund an der Konfiguration.
4. **Given** aktivierte Traefik-Prüfung, **When** der Agent die Dateien geschrieben hat, **Then** meldet er zusätzlich, ob Traefik die erwarteten Objekte geladen hat.

---

### User Story 7 - Zugangsdaten und Lebenszyklus verwalten (Priority: P2)

Der Benutzer kann Zugangsdaten ohne Ausfall austauschen, bei Verlust sofort sperren und Konfigurationen sicher entfernen.

**Why this priority**: Sicherheits- und Betriebshygiene, nicht für den ersten Durchstich nötig.

**Independent Test**: Zweites Token erzeugen, erstes widerrufen, Löschversuch einer genutzten Konfiguration.

**Acceptance Scenarios**:

1. **Given** eine Provider-Konfiguration, **When** der Benutzer ein neues Token erzeugt, **Then** sind altes und neues Token gleichzeitig gültig, bis das alte widerrufen wird.
2. **Given** ein widerrufenes Token, **When** ein Agent es nutzt oder bereits verbunden ist, **Then** wird die Verbindung beendet, und neue Verbindungen werden abgelehnt.
3. **Given** eine Konfiguration, die von Aktionen verwendet wird, **When** der Benutzer sie löschen will, **Then** wird das Löschen blockiert und die verwendenden Aktionen werden aufgelistet.
4. **Given** eine gelöschte Konfiguration ohne Aktionen, **When** der Agent verbunden ist, **Then** wird er wie bei einem widerrufenen Token behandelt.

---

### User Story 8 - Verbindungsart vorsehen (Priority: P3)

Die Konfiguration kennt zwei Verbindungsarten. Variante A (Agent verbindet zu FluxIP) wird umgesetzt, Variante B (FluxIP verbindet zum Agent) wird nur vorbereitet.

**Why this priority**: Für den ersten Einsatz wird nur Variante A gebraucht. Die Vorbereitung ist aber eine Architekturvorgabe für alle anderen Stories (FR-032).

**Independent Test**: Verbindungsart im Anlegen-Ablauf prüfen und Variante B per Programmierschnittstelle zu setzen versuchen.

**Acceptance Scenarios**:

1. **Given** das Anlegen einer Provider-Konfiguration, **When** der Benutzer die Verbindungsart sieht, **Then** ist Variante A wählbar und Variante B als "noch nicht verfügbar" gekennzeichnet und nicht wählbar.
2. **Given** ein Versuch, Variante B über eine Programmierschnittstelle oder Import zu setzen, **When** er erfolgt, **Then** wird er mit einer klaren Meldung abgelehnt.
3. **Given** eine später ergänzte Variante B, **When** sie aktiviert wird, **Then** bleiben Snapshot-Format, Berichtsformat, Versionslogik und Rendering unverändert, und es ändert sich nur der Verbindungsaufbau.

---

### User Story 9 - Vorlagen im Betrieb ändern (Priority: P3)

Der Betreiber ändert eine Vorlage, und der Agent übernimmt sie nur, wenn sie funktioniert.

**Why this priority**: Komfort im laufenden Betrieb; ein Neustart des Agents deckt den Bedarf vorerst ab.

**Independent Test**: Gültige und ungültige Vorlagenänderung im laufenden Betrieb einspielen.

**Acceptance Scenarios**:

1. **Given** eine geänderte Vorlage, **When** der Agent sie neu lädt (bei Dateiänderung oder auf Signal), **Then** prüft er sie vorab mit dem zuletzt erhaltenen Snapshot und mit einem leeren Snapshot und übernimmt sie nur, wenn beide Ergebnisse gültig sind.
2. **Given** eine ungültige Vorlage, **When** der Agent sie lädt, **Then** arbeitet er mit der bisherigen weiter und meldet den Fehler.

---

### Edge Cases

- Zwei Agents verbinden sich gleichzeitig mit denselben Zugangsdaten: Die neueste Verbindung gilt, die ältere wird beendet, an der Konfiguration erscheint ein Hinweis.
- Ein Gerät hat noch nie eine IP gemeldet: Es erzeugt keinen Eintrag.
- Eine Gruppe wird in einer Aktion umbenannt: Der Eintrag wechselt die Gruppe, und eine nun leere Gruppe wird wie eine nie befüllte behandelt.
- Eine Vorlage verweist auf eine Gruppe, die es nicht gibt: Die Gruppe gilt als leer, es ist kein Fehler.
- Das Zielverzeichnis ist nicht beschreibbar oder das Vorlagenverzeichnis fehlt oder ist leer: Der Agent beendet sich beim Start mit einer eindeutigen Fehlermeldung.
- Abbruch beim Schreiben (Absturz, Stromausfall): Traefik darf nie eine halb geschriebene Datei sehen.
- Dieselbe Middleware existiert zusätzlich in einer manuell gepflegten Datei: In Traefik entsteht ein Namenskonflikt. Der Einrichtungsablauf weist darauf hin, die manuelle Definition zu entfernen.
- Die Systemuhr des abgesetzten Systems ist falsch: Die Offline-Höchstdauer darf nicht von der Wanduhr abhängen.
- Sehr große Snapshots: Es gibt ein dokumentiertes Maximum, bei Überschreitung wird ein Fehler gemeldet statt abgeschnitten.
- IPv4 und IPv6: Beide Adressfamilien werden unterstützt, soweit FluxIP sie kennt.
- Agent und FluxIP haben unterschiedliche Versionen: Innerhalb einer unterstützten Protokollversion funktioniert die Verbindung, sonst gibt es eine klare Fehlermeldung.
- Die Authentifizierung wird mit falschen Tokens beschossen: Der Schutz greift, ohne gültige Agents zu beeinträchtigen.

## Requirements *(mandatory)*

### Functional Requirements

**Provider-Konfiguration**

- **FR-001**: Ein Account MUSS beliebig viele Provider-Konfigurationen anlegen, ändern und löschen können. Jede hat einen Namen.
- **FR-002**: Jede Provider-Konfiguration MUSS eine Verbindungsart haben (siehe FR-030 bis FR-032) und eine eigene, eindeutige Agent-Adresse, die FluxIP bei der Einrichtung anzeigt.
- **FR-003**: Ein Token MUSS bei der Erstellung einmalig im Klartext angezeigt und danach nur als nicht umkehrbarer Hash gespeichert werden. Je Konfiguration MÜSSEN zeitgleich zwei gültige Tokens möglich sein, jedes MUSS sofort widerrufbar sein.
- **FR-004**: Eine Provider-Konfiguration MUSS nur Daten ihres eigenen Accounts erhalten und nur von Aktionen des eigenen Accounts gewählt werden können.
- **FR-005**: Das Anlegen und Ändern MUSS im UI als Schritt-für-Schritt-Ablauf für Endanwender angeboten werden, inklusive Startbefehl und Beispielkonfiguration für Traefik.
- **FR-006**: Das Löschen einer Provider-Konfiguration, die von Aktionen verwendet wird, MUSS blockiert werden, und die verwendenden Aktionen MÜSSEN aufgelistet werden.

**Aktion am Gerät**

- **FR-010**: Es MUSS einen neuen Aktionstyp geben, der eine Provider-Konfiguration und eine Gruppe auswählt und die Daten des Geräts dorthin liefert. In dieser Version liefert die Aktion ausschließlich Gerätename und IPs; frei definierbare Zusatzwerte gibt es nicht.
- **FR-011**: Ein Gerät DARF höchstens eine solche Aktion je Provider-Konfiguration haben (die Gruppe ist Teil dieser Aktion), kann aber Aktionen für mehrere Provider-Konfigurationen haben. Mehrere Geräte MÜSSEN dieselbe Konfiguration und Gruppe verwenden können. Ein zweiter Versuch für dasselbe Gerät und denselben Provider wird abgelehnt.
- **FR-012**: Ein Eintrag MUSS nur entstehen, wenn für das Gerät mindestens eine IP bekannt ist.
- **FR-013**: Änderung oder Löschung einer Aktion sowie Deaktivierung oder Löschung eines Geräts MUSS zu einem neuen Snapshot der betroffenen Konfigurationen führen (der bisherigen und gegebenenfalls der neuen).
- **FR-014**: Die Aktion MUSS ihren Lieferstatus anzeigen (angewendet, ausstehend, Fehler, Agent getrennt), abgeleitet aus den Berichten des Agents.

**Snapshots**

- **FR-020**: Ein Snapshot MUSS den vollständigen Stand einer Provider-Konfiguration enthalten: eine monoton steigende Version, eine Korrelations-ID des auslösenden Vorgangs sowie alle Gruppen mit ihren Einträgen (Gerätename, IPs). Er DARF keine Daten anderer Konfigurationen oder Accounts enthalten.
- **FR-021**: FluxIP MUSS bei jeder inhaltlichen Änderung nur an die betroffenen Konfigurationen neue Snapshots senden und zusätzlich einen periodischen Abgleich ermöglichen.
- **FR-022**: Änderungen in kurzer Folge SOLLEN zusammengefasst werden.
- **FR-023**: Die Quelle der Wahrheit MUSS der Ereignisspeicher bleiben. Ausgelieferte Snapshots dürfen auf einer verwerfbaren abgeleiteten Sicht beruhen, die sich jederzeit aus den Ereignissen neu aufbauen lässt.
- **FR-024**: Die maximale Größe eines Snapshots MUSS dokumentiert und durchgesetzt werden.

**Verbindung und Sitzung**

- **FR-030**: Variante A (Agent baut die Verbindung zu FluxIP auf) MUSS umgesetzt werden.
- **FR-031**: Variante B (FluxIP baut die Verbindung zum Agent auf) MUSS in Datenmodell, Protokoll und UI vorgesehen, aber nicht umgesetzt werden. Sie DARF nicht wählbar sein und MUSS bei Versuchen mit einer klaren Meldung abgelehnt werden.
- **FR-032**: Die Sitzung nach dem Verbindungsaufbau MUSS unabhängig davon definiert sein, wer die Verbindung geöffnet hat. Das betrifft Snapshots, Versionsvergleich, Anwendungsberichte, Lebenszeichen und Abbruchverhalten. Beide Varianten MÜSSEN dieselbe Sitzungslogik verwenden.
- **FR-033**: Die Verbindung MUSS verschlüsselt sein, und beide Seiten MÜSSEN sich ausweisen (Agent per Token der Konfiguration).
- **FR-034**: Bei mehreren Verbindungen mit denselben Zugangsdaten MUSS die neueste gelten und die ältere beendet werden.
- **FR-035**: Schutz gegen wiederholte fehlgeschlagene Authentifizierung MUSS vorhanden sein.
- **FR-036**: FluxIP MUSS eine Protokollversion aushandeln und Agents einer unterstützten Version weiter bedienen.

**Agent**

- **FR-040**: Der Agent MUSS als einzelnes, eigenständiges Binary ohne Laufzeitabhängigkeiten für linux/amd64 und linux/arm64 bereitgestellt werden.
- **FR-041**: In Variante A DARF der Agent nur ausgehende Verbindungen aufbauen und MUSS ohne offene eingehende Ports funktionieren.
- **FR-042**: Der Agent MUSS zustandslos sein. Einziger Zustand sind die zuletzt geschriebenen Dateien. Ein Neustart jederzeit MUSS folgenlos sein.
- **FR-043**: Der Agent MUSS über Umgebungsvariablen oder Parameter konfigurierbar sein: Agent-Adresse, Token, Vorlagenverzeichnis, Zielverzeichnis, Dateipräfix, Offline-Höchstdauer (Standard 24 Stunden), Log-Level.
- **FR-044**: Der Agent MUSS jede Vorlage im Vorlagenverzeichnis zu einer Datei im Zielverzeichnis rendern. Der Dateiname ergibt sich aus dem Präfix (Standard `fluxip-`) und dem Vorlagennamen ohne die Endung für Vorlagen.
- **FR-045**: Vorlagen MÜSSEN Zugriff haben auf: die Gruppen mit ihren Einträgen (Gerätename, IPs), die Version, einen Zeitstempel, den Namen der Provider-Konfiguration und die Kennzeichnung "veraltet". Sie MÜSSEN Bedingungen, Schleifen und Hilfsfunktionen für gängige Aufgaben unterstützen (z. B. IP als CIDR ausgeben). Eine nicht vorhandene Gruppe MUSS als leer gelten.
- **FR-046**: Beispielvorlagen für die Allow-List-Middleware und für einen Service mit dynamischer Upstream-Adresse MÜSSEN im Binary enthalten und per Kommando ausgebbar sein. Die Allow-List-Vorlage MUSS bei leerer Gruppe einen Fallback ausgeben, nie eine leere IP-Liste.
- **FR-047**: Der Agent MUSS alle Vorlagen vor dem Schreiben rendern und die Ergebnisse auf Gültigkeit prüfen (YAML oder TOML je nach Dateiendung). Schlägt eine fehl, MUSS er keine Datei ändern.
- **FR-048**: Der Agent MUSS jede Datei atomar ersetzen (temporäre Datei im selben Verzeichnis, danach Umbenennen) und nur schreiben, wenn sich der Inhalt ändert. Bei jedem Fehler MÜSSEN die bisherigen Dateien erhalten bleiben.
- **FR-049**: Der Agent DARF ausschließlich Dateien mit seinem Präfix verwalten. Nach erfolgreicher Anwendung MUSS er Dateien mit diesem Präfix entfernen, zu denen es keine Vorlage mehr gibt. Andere Dateien im Zielverzeichnis DARF er nie anfassen.
- **FR-050**: Beim Start DARF der Agent vorhandene Dateien erst durch den ersten gültigen Snapshot ersetzen. Gibt es keine erzeugten Dateien und keinen Snapshot, MUSS er mit leeren Gruppen rendern.
- **FR-051**: Nach Überschreiten der konfigurierten Offline-Höchstdauer MUSS der Agent mit der Kennzeichnung "veraltet" neu rendern. Die Messung MUSS unabhängig von der Systemuhr erfolgen. Ein Wert, der "nie" bedeutet, MUSS möglich sein.
- **FR-052**: Der Agent MUSS Verbindungsabbrüche mit exponentiell wachsendem Abstand und Zufallsanteil überbrücken und regelmäßig den Stand abgleichen.
- **FR-053**: Der Agent MUSS Snapshots mit niedrigerer Version als der zuletzt angewendeten ignorieren.
- **FR-054**: Nach jeder Anwendung MUSS der Agent berichten: angewendete Version, Prüfsumme je Datei, Prüfsumme je Vorlage, Agent-Version, Ergebnis mit Fehlergrund.
- **FR-055**: Der Agent SOLL optional über Traefiks API prüfen können, ob die erwarteten Objekte geladen wurden, und das Ergebnis melden.
- **FR-056**: Der Agent MUSS strukturierte Logs auf der Standardausgabe schreiben, die die Korrelations-ID jedes Snapshots enthalten, und ein Kommando oder einen Exit-Code für Gesundheitsprüfungen anbieten.
- **FR-057**: Eine geänderte Vorlage MUSS vor der Übernahme mit dem zuletzt erhaltenen und mit einem leeren Snapshot geprüft werden.

**Übergreifend**

- **FR-060**: Zustandsänderungen (Konfiguration angelegt oder gelöscht, Token erzeugt oder widerrufen, Aktion angelegt oder geändert, Agent verbunden oder getrennt, Version angewendet) MÜSSEN als Ereignisse nachvollziehbar sein.
- **FR-061**: Ein Vorgang MUSS von der auslösenden IP-Änderung bis zur Rückmeldung des Agents über eine Korrelations-ID nachverfolgbar sein (FluxIP-Logs, Agent-Logs, Ereignisse).
- **FR-062**: Der Agent MUSS als Release-Artefakt mit SemVer-Version veröffentlicht werden, getrennt vom Backend-Image.

### Key Entities *(Arbeitsnamen; endgültige Namen werden in der Planungsphase vorgeschlagen und vor Übernahme bestätigt)*

- **Provider-Konfiguration**: Name, Verbindungsart, Agent-Adresse, Zustand, letzte Verbindung, angewendete Version, Agent-Version
- **Agent-Token**: bis zu zwei gültige je Konfiguration, nur als Hash gespeichert, Status (gültig, widerrufen), Zeitpunkte
- **Aktion "Traefik-Konfiguration liefern"**: Gerät, Provider-Konfiguration, Gruppe, Lieferstatus
- **Eintrag**: Gerät, Gruppe, aktuell bekannte IPs
- **Snapshot**: Version, Gruppen mit Einträgen, Korrelations-ID, Zeitstempel
- **Anwendungsbericht**: Version, Prüfsummen, Ergebnis, Fehlergrund, optionaler Traefik-Ladestatus

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Bei verbundenem Agent liegt die neue IP in 95 % der Fälle innerhalb von 10 Sekunden nach der bestätigten IP-Änderung in FluxIP (also nach Ablauf des bestehenden Entprellfensters, das unverändert bleibt) in den gerenderten Dateien.
- **SC-002**: Ein Benutzer mit laufendem Traefik schafft den Weg von "Konfiguration anlegen" über "Aktion an Gerät anlegen" bis "Wert angewendet" in höchstens 15 Minuten.
- **SC-003**: Bei 24 Stunden Ausfall von FluxIP bleibt jedes abgesetzte System ohne Eingriff funktionsfähig, auch nach Neustart von Agent und Host.
- **SC-004**: In keinem getesteten Fehlerszenario (ungültige Vorlage, leere Gruppe, Abbruch beim Schreiben, Stromausfall) sieht Traefik eine unvollständige oder leere Allow-List-Datei.
- **SC-005**: Das Agent-Binary ist kleiner als 30 MB und benötigt im Leerlauf weniger als 50 MB Arbeitsspeicher.
- **SC-006**: Jede Anwendung eines Snapshots ist über die Korrelations-ID in FluxIP und im Agent-Log nachvollziehbar.
- **SC-007**: Beide Beispielvorlagen (Allow-List, Upstream-Adresse) funktionieren ohne Änderung an FluxIP oder Agent-Code.
- **SC-008**: Ein späterer Ausbau auf Variante B ändert nach einem Review weder Snapshot- noch Berichtsformat, Vorlagenlogik oder Anwendungsreihenfolge im Agent, sondern nur den Verbindungsaufbau.
- **SC-009**: Innerhalb einer unterstützten Protokollversion funktionieren ältere Agents mit neuerem FluxIP ohne Update.

## Out of Scope

- Umsetzung von Variante B (nur vorgesehen, siehe FR-031 und FR-032)
- Konfiguration von Traefiks statischer Konfiguration, Installation und Betrieb von Traefik selbst
- Andere Zielsysteme als dateibasierte Konfiguration (die Vorlage macht sie technisch möglich, sie werden aber weder getestet noch unterstützt)
- Selbstaktualisierung des Agents
- Binaries für Windows und macOS
- Eine HTTP-Provider-Variante direkt in FluxIP
- Neue Quellen für IP-Adressen (die bestehende DynDNS-Auslösung bleibt maßgeblich)
- Frei definierbare zusätzliche Attribute pro Aktion (z. B. ein Port für die Upstream-Adresse; Ports stehen in der Vorlage)

## Assumptions

- Am abgesetzten System läuft Traefik v3 mit File Provider auf einem Verzeichnis mit aktivierter Überwachung (`watch: true`). Traefik erlaubt nur einen File Provider, deshalb teilt sich das Zielverzeichnis in der Regel mit manuell gepflegten Dateien. Daraus folgt die Präfix-Regel in FR-049.
- Objekte aus den gerenderten Dateien werden in Labels oder anderen Dateien als `<name>@file` referenziert.
- FluxIP ist über HTTPS mit gültigem Zertifikat erreichbar, und der vorgeschaltete Reverse Proxy reicht lang laufende Verbindungen durch. Die öffentliche Basisadresse für Agents ist in der Konfiguration des FluxIP-Deployments einstellbar.
- Die Provider-Konfiguration nutzt den bestehenden Mechanismus für zentral pro Account verwaltete Konfigurationen, bei dem mehrere desselben Typs nebeneinander existieren und Aktionen eine davon auswählen. Das ist in der Planungsphase gegen den Ist-Stand zu prüfen.
- Geräte, ihre aktuellen IPs, Aktionen und Accounts existieren bereits in FluxIP.
- Der Agent hat Schreibrechte im Zielverzeichnis.
- Die drei ursprünglich offenen Fragen sind mit den im Entwurf vorgeschlagenen Standardwerten entschieden (siehe FR-006, FR-010, FR-043) und können in `/speckit-clarify` revidiert werden.
