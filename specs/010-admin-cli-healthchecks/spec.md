# Feature Specification: Admin-CLI und Healthchecks

**Feature Branch**: `010-admin-cli-healthchecks`

**Created**: 2026-10-29

**Status**: Draft

**Input**: User description: "Admin-CLI für das FluxIP-Backend mit den Kommandos `migrate` und `validate-config`, dazu Healthchecks im Compose. Hintergrund sind Punkt 2 (XII Admin-Prozesse) und Punkt 9 (III Konfiguration) aus docs/12-factor-backlog.md."

> Vorbild ist die CLI des Schwesterprojekts paperfeed (`validate-config`, `healthcheck`, `migrate`, Exit-Codes 0/1/2). Übernommen werden `migrate` und `validate-config`. Ein eigenes `healthcheck`-Kommando entfällt, weil `/healthz` und `/readyz` bereits existieren.

## Kontext und Ziel

Zwei Abweichungen von den Twelve-Factor-Regeln der Constitution (Prinzip II) sind im Backlog offen:

- **Admin-Prozesse (Backlog 2, Prio Hoch)**: Datenbankmigrationen laufen bei jedem Start des Webprozesses, ohne Schutz vor gleichzeitigem Ausführen. Starten mehrere Instanzen zugleich, können sie kollidieren. Einen eigenständigen Migrationsschritt gibt es nicht, auch nicht in der Pipeline.
- **Konfiguration (Backlog 9, Prio Mittel)**: Wichtige Werte (Logto-Anmeldedaten, Management-Zugangsdaten, SMTP, Absender) dürfen leer bleiben oder haben stille Entwicklungswerte. Fehler zeigen sich erst bei der Benutzung, etwa beim Mailversand oder beim Login.

Außerdem melden `app` und `frontend` im Compose keinen Gesundheitszustand, obwohl das Backend dafür Endpunkte bereitstellt. Abhängige Dienste und Betreiber sehen nicht, ob ein Container wirklich bereit ist.

Ziel: Betreiber können Migrationen und Konfigurationsprüfung als eigene, einmalige Schritte vor dem Deploy ausführen, und das Compose zeigt den Gesundheitszustand der Dienste.

## Clarifications

### Session 2026-10-29

- Q: Soll der Webprozess beim Start weiter selbst migrieren? → A: Nein. Migration läuft ausschließlich über den Migrationsbefehl. Beim Start prüft die Anwendung den Schemastand und bricht bei veraltetem Stand mit klarer Meldung ab.
- Q: Welche Konfigurationswerte sind Pflicht, welche nur Warnung? → A: Fehler für fehlende oder ungültige Pflichtwerte. Warnung für SMTP/Absender, Management-Zugangsdaten und die öffentliche Agent-Adresse, weil die zugehörigen Funktionen (Benachrichtigungen, Kontoverwaltung, Traefik-Agents) weglassbar sind. Die Variablen `BACKEND_LOGTO_APP_ID` und `BACKEND_LOGTO_APP_SECRET` liest das Backend nirgends (Stand 2026-10-29, Prüfung im Plan), sie werden deshalb nicht geprüft. Dafür ist der Verschlüsselungsschlüssel ein Pflichtwert mit Formatprüfung (32 Byte, Base64), weil ein falscher Wert sonst erst beim ersten Speichern eines Credentials auffällt.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Migrationen als eigener Schritt ausführen (Priority: P1)

Als Betreiber führe ich vor dem Deploy einen Befehl aus, der die Datenbank auf den aktuellen Stand bringt, ohne die Anwendung zu starten. Starten mehrere Aufrufe oder Instanzen gleichzeitig, passiert nichts Doppeltes und nichts geht kaputt.

**Why this priority**: Das ist der Kern von Backlog Punkt 2 und die Voraussetzung dafür, mehrere Instanzen sicher zu betreiben.

**Independent Test**: Leere Datenbank anlegen, den Migrationsbefehl ausführen, prüfen, dass das Schema vollständig ist und die Anwendung nicht gestartet wurde. Danach zwei Aufrufe gleichzeitig starten und prüfen, dass jede Migration genau einmal angewendet ist.

**Acceptance Scenarios**:

1. **Given** eine leere Datenbank, **When** ich den Migrationsbefehl ausführe, **Then** werden alle Migrationen in der vorgesehenen Reihenfolge angewendet, die Ausgabe nennt sie, und der Befehl endet mit Exit-Code 0, ohne dass Webserver, Agent-Schnittstelle oder Worker starten.
2. **Given** eine bereits aktuelle Datenbank, **When** ich den Befehl erneut ausführe, **Then** meldet er, dass nichts zu tun ist, und endet mit Exit-Code 0.
3. **Given** zwei gleichzeitig gestartete Aufrufe auf derselben Datenbank, **When** beide laufen, **Then** wendet genau einer jede Migration an, der andere wartet und findet nichts mehr zu tun, und beide enden mit Exit-Code 0.
4. **Given** eine Migration, die fehlschlägt, **When** ich den Befehl ausführe, **Then** bleibt die Datenbank bezüglich dieser Migration unverändert, die Ausgabe nennt die betroffene Migration und die Ursache, und der Befehl endet mit Exit-Code 1.
5. **Given** eine nicht erreichbare Datenbank, **When** ich den Befehl ausführe, **Then** endet er mit einer verständlichen Fehlermeldung und Exit-Code 1.
6. **Given** eine Datenbank mit veraltetem Schema, **When** ich die Anwendung ohne vorherige Migration starte, **Then** bricht sie beim Start mit einer Meldung ab, die den Migrationsbefehl nennt, und ändert die Datenbank nicht.

---

### User Story 2 - Konfiguration vor dem Deploy prüfen (Priority: P1)

Als Betreiber prüfe ich vor dem Deploy, ob die Konfiguration vollständig und gültig ist, und sehe alle Probleme auf einmal, ohne dass Geheimnisse in der Ausgabe stehen.

**Why this priority**: Das ist der Kern von Backlog Punkt 9. Fehler zeigen sich heute erst im Betrieb.

**Independent Test**: Eine Konfiguration mit mehreren fehlenden und einem ungültigen Wert prüfen. Die Ausgabe nennt alle Probleme, kein Geheimnis erscheint im Klartext, und der Exit-Code ist 1.

**Acceptance Scenarios**:

1. **Given** eine vollständige und gültige Konfiguration, **When** ich die Prüfung ausführe, **Then** meldet sie Erfolg und endet mit Exit-Code 0.
2. **Given** mehrere fehlende oder ungültige Werte, **When** ich die Prüfung ausführe, **Then** nennt sie jeden betroffenen Wert mit dem Grund (fehlt, ungültiges Format, nicht ganzzahlig, ...) in einem Durchlauf und endet mit Exit-Code 1.
3. **Given** Geheimnisse in der Konfiguration (Passwörter, Secrets, Schlüssel), **When** die Prüfung läuft, **Then** erscheint kein Geheimnis im Klartext in der Ausgabe, auch nicht in Fehlermeldungen.
4. **Given** leere SMTP-/Absender-, Management- oder Agent-Adress-Werte bei sonst gültiger Konfiguration, **When** ich die Prüfung ausführe, **Then** erscheinen sie als Warnungen mit dem Hinweis auf die betroffene Funktion, und der Exit-Code ist 0.
5. **Given** ein Verschlüsselungsschlüssel, der nicht 32 Byte in Base64 entspricht, **When** ich die Prüfung ausführe, **Then** erscheint er als Fehler (ohne den Wert zu zeigen) und der Exit-Code ist 1.
6. **Given** die Option für Online-Prüfung, **When** ich sie ausführe, **Then** prüft sie zusätzlich, ob Datenbank, Redis und der Logto-Endpunkt erreichbar sind, meldet das Ergebnis je Dienst und beendet jede Prüfung nach höchstens 5 Sekunden.
7. **Given** ein unbekannter Befehl oder eine falsche Option, **When** ich die CLI aufrufe, **Then** erscheint eine Hilfe mit den verfügbaren Befehlen und der Exit-Code ist 2.

---

### User Story 3 - Gesundheitszustand im Compose sehen (Priority: P2)

Als Betreiber sehe ich im Compose, ob `app` und `frontend` bereit sind, und abhängige Dienste warten, bis ihre Voraussetzung wirklich bereit ist.

**Why this priority**: Verbessert den Betrieb, ist aber unabhängig von den beiden anderen Stories nutzbar.

**Independent Test**: Das Compose starten und den Zustand abfragen: beide Dienste werden als gesund gemeldet. Postgres stoppen: `app` wird als ungesund gemeldet.

**Acceptance Scenarios**:

1. **Given** ein gestartetes Compose mit erreichbaren Abhängigkeiten, **When** die Dienste hochgefahren sind, **Then** melden `app` und `frontend` den Zustand "gesund".
2. **Given** ein laufendes Compose, **When** die Datenbank oder Redis ausfällt, **Then** meldet `app` den Zustand "ungesund", und er wird wieder "gesund", sobald die Abhängigkeit zurück ist.
3. **Given** das Frontend hängt vom Backend ab, **When** das Compose startet, **Then** startet das Frontend erst, wenn `app` als gesund gilt.
4. **Given** das Image dient beiden Rollen (Backend und Frontend), **When** ein Dienst gestartet wird, **Then** gilt für jeden Dienst sein eigener Gesundheitstest, nicht ein gemeinsamer Test des Images.

---

### Edge Cases

- Eine Migration bricht mittendrin ab: Die Änderungen dieser Migration werden zurückgenommen, bereits erfolgreich angewendete bleiben bestehen, der Folgeaufruf versucht es erneut.
- Der Migrationsbefehl läuft, während eine ältere Version der Anwendung noch läuft: Die Anwendung wird davon nicht beendet. Welche Schemaänderungen dabei sicher sind, ist Sache der Migrationen selbst (nicht Teil dieses Features).
- `migrate` braucht nur die Datenbankverbindung, nicht die gesamte Konfiguration (kein SMTP, kein Logto). Ein Fehler in anderen Werten verhindert die Migration nicht.
- Konfigurationswerte, die nur leer sind (Leerzeichen), zählen als fehlend.
- Die Online-Prüfung trifft auf einen nicht erreichbaren oder hängenden Dienst: Sie endet nach höchstens 5 Sekunden mit Fehler für diesen Dienst und prüft die übrigen weiter.
- Die Konfigurationsprüfung läuft ohne jede Umgebungsvariable: Sie nennt alle Pflichtwerte und endet mit Exit-Code 1.
- Ohne Argument oder mit `--help` zeigt die CLI die Hilfe, ohne dass Konfiguration vorhanden sein muss.
- Der Gesundheitstest von `frontend` prüft nur, ob die ausgelieferte Oberfläche antwortet, nicht ob das Backend erreichbar ist.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Das System MUSS einen Befehl bereitstellen, der alle noch nicht angewendeten Datenbankmigrationen in der vorgesehenen Reihenfolge ausführt, ohne die Anwendung (Webserver, Agent-Schnittstelle, Worker) zu starten.
- **FR-002**: Der Migrationsbefehl MUSS ausgeben, welche Migrationen angewendet wurden, oder dass nichts zu tun ist.
- **FR-003**: Gleichzeitige Aufrufe des Migrationsbefehls auf derselben Datenbank MÜSSEN sicher sein: Jede Migration wird genau einmal angewendet, ein wartender Aufruf endet erfolgreich, sobald er nichts mehr zu tun findet.
- **FR-004**: Schlägt eine Migration fehl, MUSS der Befehl deren Änderungen zurücknehmen, die betroffene Migration und die Ursache nennen und mit Exit-Code 1 enden.
- **FR-005**: Der Migrationsbefehl MUSS mit der Datenbankverbindung allein auskommen und DARF keine übrigen Konfigurationswerte verlangen.
- **FR-006**: Der Webprozess DARF beim Start keine Migrationen mehr ausführen. Er MUSS beim Start prüfen, ob alle Migrationen angewendet sind, und bei veraltetem Schema mit einer Meldung abbrechen, die den Migrationsbefehl nennt. Das Compose MUSS die Migration als einmaligen Schritt vor dem Start von `app` ausführen.
- **FR-007**: Das System MUSS einen Befehl bereitstellen, der die Konfiguration aus den Umgebungsvariablen prüft und alle fehlenden oder ungültigen Werte in einem Durchlauf nennt, jeweils mit Wert-Name und Grund.
- **FR-008**: Die Konfigurationsprüfung DARF Geheimnisse (Passwörter, Secrets, Schlüssel, Tokens) niemals im Klartext ausgeben.
- **FR-009**: Die Konfigurationsprüfung MUSS fehlende oder ungültige Pflichtwerte als Fehler melden, darunter einen Verschlüsselungsschlüssel, der nicht 32 Byte in Base64 entspricht, sowie nicht ganzzahlige Zahlenwerte und ungültige Adressen. Leere oder auf dem Entwicklungswert stehende SMTP-/Absender-, Management- und Agent-Adress-Werte MUSS sie als Warnung melden, mit Hinweis, welche Funktion dadurch nicht arbeitet. Warnungen ändern den Exit-Code nicht. Werte, die das Backend nicht verwendet (`BACKEND_LOGTO_APP_ID`, `BACKEND_LOGTO_APP_SECRET`), werden nicht geprüft.
- **FR-010**: Die Konfigurationsprüfung MUSS mit einer Option zusätzlich die Erreichbarkeit von Datenbank, Redis und Logto-Endpunkt prüfen, je Dienst das Ergebnis nennen und jede Prüfung nach höchstens 5 Sekunden beenden.
- **FR-011**: Die CLI MUSS Exit-Code 0 bei Erfolg, 1 bei einem Fehler der geprüften Sache und 2 bei falscher Benutzung (unbekannter Befehl, ungültige Option) liefern.
- **FR-012**: Die CLI MUSS eine Hilfe mit den verfügbaren Befehlen zeigen, die ohne vorhandene Konfiguration funktioniert.
- **FR-013**: Das Compose MUSS für `app` einen Gesundheitstest enthalten, der nur dann "gesund" meldet, wenn das Backend Anfragen bedienen kann (Datenbank und Redis erreichbar).
- **FR-014**: Das Compose MUSS für `frontend` einen Gesundheitstest enthalten, der meldet, ob die Oberfläche ausgeliefert wird.
- **FR-015**: Die Gesundheitstests MÜSSEN je Dienst im Compose definiert sein, nicht im gemeinsamen Image, weil das Image beide Rollen bedient.
- **FR-016**: Das Frontend MUSS im Compose erst starten, wenn `app` gesund ist.
- **FR-017**: Die Nutzung der CLI und der Zweck der Healthchecks MÜSSEN in der Dokumentation beschrieben sein (Betriebs- und Konfigurationsdoku).
- **FR-018**: Die erledigten Punkte (2 und 9, soweit vollständig gelöst) MÜSSEN nach der Umsetzung aus `docs/12-factor-backlog.md` entfernt werden, nicht gelöste Teile bleiben mit angepasster Beschreibung stehen.
- **FR-019**: Die CLI DARF die laufende Anwendung nicht beeinflussen und schreibt ihre Ausgabe auf die Standardausgabe bzw. Standardfehlerausgabe, nicht in Dateien.

### Key Entities

- **Migration**: Ein einzelner, benannter Schritt, der das Datenbankschema ändert. Hat Reihenfolge und den Vermerk, ob und wann sie angewendet wurde.
- **Konfigurationsbefund**: Ergebnis der Prüfung eines Konfigurationswerts: Name, Status (Warnung, Fehler), Grund und bei Warnungen die betroffene Funktion. Enthält nie den Wert eines Geheimnisses.
- **Erreichbarkeitsbefund**: Ergebnis der Online-Prüfung eines Dienstes (Datenbank, Redis, Logto): erreichbar oder nicht, mit kurzer Ursache.
- **Gesundheitszustand**: Von der Laufzeitumgebung erfasster Zustand eines Dienstes (startend, gesund, ungesund).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zwei gleichzeitig gestartete Migrationsaufrufe auf einer leeren Datenbank enden beide mit Exit-Code 0, und jede Migration ist danach genau einmal angewendet.
- **SC-002**: Der Migrationsbefehl bringt eine leere Datenbank auf den aktuellen Stand, ohne dass ein Webserver oder Worker startet.
- **SC-003**: Bei einer Konfiguration mit beliebig vielen fehlenden oder ungültigen Werten nennt ein einziger Prüflauf 100 % davon, sodass kein wiederholtes Beheben und Prüfen nötig ist.
- **SC-004**: In keiner Ausgabe der Konfigurationsprüfung erscheint ein vorgegebener Geheimniswert im Klartext (auch nicht bei Fehlern).
- **SC-005**: Nach dem Start des Compose melden `app` und `frontend` innerhalb von 90 Sekunden "gesund", wenn die Abhängigkeiten bereit sind, und `app` meldet "ungesund" innerhalb von 90 Sekunden nach Ausfall der Datenbank.
- **SC-006**: Die Backlog-Punkte 2 und 9 sind nach Abschluss entfernt oder auf den verbleibenden Rest reduziert.

## Assumptions

- Die vorhandenen Endpunkte `/healthz` (lebt) und `/readyz` (bereit: Datenbank und Redis erreichbar) sind die Grundlage für den Gesundheitstest von `app`. Für `app` zählt Bereitschaft, nicht nur Lebendigkeit.
- Das Basis-Image enthält ein kleines HTTP-Werkzeug für den Test, sodass kein eigener Befehl dafür nötig ist.
- Das Compose bekommt einen einmaligen Migrationsschritt vor `app`, damit lokale Entwicklung mit `docker compose up` weiterhin ohne manuellen Zwischenschritt startet. Läuft die App außerhalb des Compose, ruft die Person den Migrationsbefehl selbst auf.
- Backlog Punkt 9 wird damit teilweise gelöst: Pflichtwerte werden vor dem Deploy geprüft, optionale Funktionen erscheinen als Warnung. Der Teil "stille Entwicklungswerte beim Start des Webprozesses" bleibt außerhalb dieses Features und im Backlog stehen (FR-018). Die beiden ungenutzten Variablen aus dem Backlog-Eintrag werden dort als ungenutzt vermerkt. Ihr Entfernen aus der Konfiguration ist ein eigener Chore.
- Die Anzahl der Migrationen ist klein (heute einstellig bis niedrig zweistellig). Die Laufzeit des Migrationsbefehls ist unkritisch.
- Die CLI ist ein Betriebswerkzeug für die Person, die FluxIP betreibt, nicht für Endnutzer der Oberfläche. Eine Oberfläche dafür entsteht nicht.
- Weitere CLI-Befehle (Admin-Aktionen auf Konten, Zurücksetzen von Zuständen) sind nicht Teil dieses Features und können später ergänzt werden.
- Der Befehl zur Linting-Umstellung (Biome) ist ausdrücklich nicht Teil dieses Features.
