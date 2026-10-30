# Feature Specification: UI/UX-Angleichung an Constitution Prinzip III

**Feature Branch**: `011-ui-ux-alignment`

**Created**: 2026-10-30

**Status**: Draft

**Input**: User description: "Align the existing web UI with Constitution Principle III (Web UI UX Standards, v1.2.0): Top-Navigation, Breadcrumbs plus Tabs auf Detailseiten ohne redundante Seitentitel, Haupt-CTAs oben rechts bzw. mobil als Floating Action Button, Aktionen in Karten nach sicher/destruktiv getrennt, Touch-Targets von mindestens 44x44px mobil, Wizards auf Mobile prüfen. Nur Frontend."

## Kontext und Ziel

Die Constitution (Prinzip III, Version 1.2.0) legt Regeln für Navigation, Platzierung von Aktionen und Touch-Bedienbarkeit der Web-UI fest. Der bestehende Stand weicht in mehreren Punkten ab:

- Jede Seite zeigt eine große Überschrift. Auf Detailseiten eines Geräts (Aktionen, Verlauf, Einstellungen) wiederholt sie den Namen des aktuellen Bereichs, und die Bereiche sind über einzelne Buttons statt über Tabs erreichbar.
- Hauptaktionen wie „Add action“ stehen in einer Button-Reihe neben anderen Buttons, ohne feste Position und ohne mobile Sonderform.
- Auf Karten und Zeilen stehen sichere und destruktive Aktionen (Edit, Disable, Detach) in einer Reihe nebeneinander.
- Schaltflächen, Links und Navigationseinträge sind auf Touch-Geräten kleiner als 44x44px.
- Die Top-Navigation führt neben Devices, Credentials und Agents auch Notifications und Account als Textlinks. Account wird künftig über einen Kreis mit Personen-Symbol erreicht.

Ziel: Die bestehende UI erfüllt Prinzip III vollständig, auf Desktop und Mobile, ohne neue Funktionen und ohne Änderungen an Backend oder Agent.

## Clarifications

### Session 2026-10-30

- Q: Wie sollen Notifications, Account und Abmelden in der Top-Bar erscheinen? → A: Hauptnavigation enthält Devices, Credentials, Agents und Notifications. Rechts in der Leiste steht ein Kreis mit einem neutralen Personen-Symbol, der zur Seite Account führt (später Initialen bzw. Benutzer-Avatar zusammen mit den Account-Details, eigenes Feature im Backlog). Rechts daneben bleibt der Abmelden-Button unverändert bestehen. Es gibt kein Nutzermenü.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Orientierung auf Detailseiten über Breadcrumbs und Tabs (Priority: P1)

Als Nutzer sehe ich auf den Seiten eines Geräts immer, wo ich bin, und wechsle zwischen Aktionen, Verlauf und Einstellungen über eine Tab-Leiste direkt unter den Breadcrumbs, ohne eine Überschrift, die nur den Tab-Namen wiederholt.

**Why this priority**: Die Struktur betrifft alle Detailseiten und ist die Grundlage für die Platzierung der übrigen Elemente.

**Independent Test**: Ein Gerät öffnen, durch alle drei Bereiche wechseln und prüfen, dass Breadcrumbs, Tab-Leiste mit aktivem Zustand und kein redundanter Seitentitel vorhanden sind.

**Acceptance Scenarios**:

1. **Given** die Aktionsseite eines Geräts, **When** ich sie öffne, **Then** sehe ich Breadcrumbs (Devices / Gerätename) und darunter eine Tab-Leiste mit Actions, History und Settings, wobei Actions als aktiv markiert ist.
2. **Given** die Aktionsseite, **When** ich den Tab History wähle, **Then** wechselt der Inhalt, der Tab History ist aktiv, und die Breadcrumbs bleiben konsistent.
3. **Given** eine beliebige Geräte-Detailseite, **When** ich sie ansehe, **Then** gibt es keine große Überschrift, die den Namen des aktiven Tabs wiederholt.
4. **Given** ein Smartphone-Viewport, **When** die Tab-Leiste breiter als der Bildschirm ist, **Then** bleibt sie horizontal bedienbar und alle Tabs sind erreichbar.
5. **Given** die Update-Historie einer Aktion (Unterseite des Geräts), **When** ich sie öffne, **Then** zeigt die Breadcrumb-Kette den Weg zurück zum Gerät.

---

### User Story 2 - Haupt-CTA an festem Platz, mobil als Floating Action Button (Priority: P1)

Als Nutzer finde ich die Hauptaktion einer Seite (z. B. „Add action“, Gerät, Credential oder Agent hinzufügen) immer oben rechts im Inhaltsbereich, und auf dem Smartphone liegt sie als schwebender Button am unteren Rand, den ich mit dem Daumen erreiche.

**Why this priority**: Das ist die häufigste Aktion der Listenseiten und der Kern der mobilen Daumenbedienung.

**Independent Test**: Jede Listenseite auf Desktop-Breite und auf unter 768px öffnen und die Position der Hauptaktion prüfen.

**Acceptance Scenarios**:

1. **Given** eine Seite mit Hauptaktion und ein Viewport ab 768px, **When** ich die Seite öffne, **Then** steht die Hauptaktion am oberen rechten Rand des Inhaltsbereichs.
2. **Given** derselbe Inhalt und ein Viewport unter 768px, **When** ich die Seite öffne, **Then** erscheint die Hauptaktion als am unteren Rand fixierter Button, der beim Scrollen sichtbar bleibt.
3. **Given** die mobile Ansicht mit schwebendem Button, **When** ich ans Seitenende scrolle, **Then** verdeckt der Button keinen Inhalt und keine Aktion dauerhaft.
4. **Given** die Hauptaktion, **When** ich sie auslöse, **Then** startet der bisherige Wizard bzw. Dialog unverändert.

---

### User Story 3 - Sichere und destruktive Aktionen klar getrennt (Priority: P1)

Als Nutzer erkenne ich auf Karten und Listenzeilen sofort, welche Aktionen gefahrlos sind und welche Infrastruktur trennen oder löschen, und tippe nicht versehentlich die falsche.

**Why this priority**: Fehlbedienung destruktiver Aktionen hat Auswirkungen auf DNS, Firewall und Zugriffslisten.

**Independent Test**: Eine Aktionskarte mit Edit, Disable und Detach auf Desktop und Mobile ansehen und Position, Farbe und Abstände prüfen.

**Acceptance Scenarios**:

1. **Given** eine Karte mit sicheren und destruktiven Aktionen, **When** ich sie ansehe, **Then** stehen sichere Aktionen (Edit, Disable) links unten und destruktive Aktionen (Detach, Delete) rechts unten.
2. **Given** dieselbe Karte, **When** ich sie ansehe, **Then** sind destruktive Aktionen mit der Danger-Farbe gekennzeichnet und sichere nicht.
3. **Given** dieselbe Karte auf einem schmalen Viewport, **When** der Platz knapp wird, **Then** grenzt keine destruktive Aktion direkt an eine normale Aktion, und der Abstand zwischen benachbarten Buttons beträgt mindestens 12px.
4. **Given** Listenzeilen anderer Seiten (Credentials, Agents, Geräte) mit destruktiven Aktionen, **When** ich sie ansehe, **Then** gelten dieselben Regeln.

---

### User Story 4 - Touch-gerechte Bedienelemente (Priority: P2)

Als Nutzer mit dem Smartphone treffe ich Buttons, Links, Tabs und Navigationseinträge zuverlässig, ohne daneben zu tippen.

**Why this priority**: Erhöht die Bedienbarkeit auf allen Seiten, hängt aber an den gemeinsamen Komponenten und lässt sich nach den Strukturänderungen prüfen.

**Independent Test**: Auf einem mobilen Viewport alle interaktiven Elemente jeder Seite vermessen.

**Acceptance Scenarios**:

1. **Given** ein mobiler Viewport, **When** ich irgendeine Seite ansehe, **Then** ist jedes interaktive Element (Buttons, Links, Tabs, Navigationseinträge, Icon-Buttons) mindestens 44x44px groß.
2. **Given** ein Desktop-Viewport, **When** ich die Seiten ansehe, **Then** bleibt die bisherige kompakte Darstellung erhalten.
3. **Given** die Top-Navigation auf einem schmalen Viewport, **When** ich sie ansehe, **Then** sind alle Einträge erreichbar und treffbar, ohne dass die Leiste unbedienbar überläuft.

---

### User Story 5 - Wizards auf dem Smartphone nutzbar (Priority: P2)

Als Nutzer lege ich Geräte, Aktionen und Agents auch auf dem Smartphone über die bestehenden Wizards an.

**Why this priority**: Wizards sind das vorgeschriebene Muster für komplexe Einrichtung und müssen mobil funktionieren.

**Independent Test**: Jeden Wizard auf einem schmalen Viewport vollständig durchlaufen.

**Acceptance Scenarios**:

1. **Given** ein mobiler Viewport, **When** ich einen Wizard (Gerät, Aktion, Traefik-Provider, Onboarding) durchlaufe, **Then** sind alle Schritte ohne horizontales Scrollen lesbar und alle Bedienelemente treffbar.
2. **Given** einen offenen Wizard, **When** ich Weiter, Zurück oder Abbrechen wähle, **Then** liegen diese Aktionen in Daumenreichweite und entsprechen den Abstandsregeln.
3. **Given** ein Wizard mit einer abbrechenden oder verwerfenden Aktion, **When** ich ihn ansehe, **Then** ist sie von der Weiter-Aktion klar getrennt.

---

### User Story 6 - Klare Top-Navigation (Priority: P3)

Als Nutzer erreiche ich Devices, Credentials, Agents und Notifications jederzeit über die feste Leiste oben, gelange über einen Kreis mit Personen-Symbol zu meinem Account und melde mich über den gewohnten Button ab.

**Why this priority**: Die Hauptnavigation existiert bereits und funktioniert. Es geht um Ordnung und Touch-Tauglichkeit.

**Independent Test**: Alle Navigationsziele auf Desktop und Mobile erreichen.

**Acceptance Scenarios**:

1. **Given** eine beliebige Seite, **When** ich sie ansehe, **Then** ist eine horizontale Top-Bar mit Devices, Credentials, Agents und Notifications sichtbar, und der aktuelle Bereich ist hervorgehoben.
2. **Given** dieselbe Seite, **When** ich die rechte Seite der Leiste ansehe, **Then** sehe ich einen Kreis mit neutralem Personen-Symbol und rechts daneben den unveränderten Abmelden-Button.
3. **Given** den Account-Kreis, **When** ich ihn anklicke oder antippe, **Then** öffne ich die Seite Account, und der Kreis zeigt auf der Account-Seite einen aktiven Zustand.
4. **Given** einen schmalen Viewport, **When** ich die Leiste nutze, **Then** sind alle Ziele erreichbar und treffbar.

---

### Edge Cases

- Sehr lange Gerätenamen in Breadcrumbs und Tabs: Der Name wird gekürzt, ohne dass die Tab-Leiste oder die Hauptaktion verdrängt wird.
- Seiten ohne Hauptaktion (z. B. Account): Es erscheint weder ein leerer Platzhalter noch ein schwebender Button.
- Leere Listen: Die Hauptaktion bleibt erreichbar. Der Leerzustand behält seine bisherige Aktion mit unverändertem Text (FR-013).
- Mehrere Hauptaktionen auf einer Seite: Genau eine ist die primäre CTA (oben rechts bzw. Floating Action Button); weitere sind Sekundäraktionen.
- Wechsel der Viewportbreite über 768px (Drehen des Geräts, Fenstergröße ändern): Die CTA wechselt ohne Neuladen zwischen beiden Formen.
- Tastaturöffnung auf dem Smartphone in einem Wizard: Der schwebende Button bzw. die Wizard-Navigation bleibt bedienbar.
- Bestätigungsdialoge für destruktive Aktionen: Die Trennung von sicheren und destruktiven Aktionen gilt auch dort.
- Ein späteres Feature (Initialen bzw. Benutzer-Avatar mit Account-Details) ersetzt den Inhalt des Kreises; Position, Größe und Ziel bleiben gleich.
- Breadcrumb-Namen können nicht geladen werden: Es erscheint die bisherige Rückfalldarstellung.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Die UI MUST eine dauerhaft sichtbare horizontale Top-Bar mit den Einträgen Devices, Credentials, Agents und Notifications zeigen, der aktuelle Bereich MUST hervorgehoben sein.
- **FR-002**: Notifications MUST zur Hauptnavigation gehören (neben Devices, Credentials und Agents). Rechts in der Top-Bar MUST ein Kreis mit einem neutralen Personen-Symbol stehen, der zur Seite Account führt, daneben der bestehende, unveränderte Abmelden-Button. Ein Nutzermenü ist nicht vorgesehen.
- **FR-003**: Jede Detail- und Unterseite MUST eine Breadcrumb-Kette zeigen, die zum übergeordneten Objekt zurückführt.
- **FR-004**: Die Bereiche eines Geräts (Actions, History, Settings) MUST als horizontale Tab-Leiste direkt unter den Breadcrumbs erscheinen, der aktive Tab MUST sichtbar markiert sein.
- **FR-005**: Seiten MUST keine große Überschrift zeigen, die den Namen des aktiven Tabs oder den letzten Breadcrumb-Eintrag wiederholt. Für Hilfstechnologien MUST jede Seite weiterhin eine sinnvolle Seitenüberschrift besitzen.
- **FR-006**: Die Hauptaktion einer Seite MUST ab 768px Breite am oberen rechten Rand des Inhaltsbereichs stehen.
- **FR-007**: Unter 768px Breite MUST die primäre CTA zum Start eines Wizards als am unteren Rand fixierter Button dargestellt werden und beim Scrollen sichtbar bleiben, ohne Inhalt dauerhaft zu verdecken.
- **FR-008**: Sichere Aktionen (Edit, Disable) MUST links unten in Karten und Listenelementen stehen, destruktive (Detach, Delete) rechts unten.
- **FR-009**: Destruktive Aktionen MUST die semantische Danger-Farbe verwenden. Diese Farbe MUST für sichere Aktionen unbenutzt bleiben.
- **FR-010**: Zwischen benachbarten Buttons MUST mindestens 12px Abstand liegen. Eine destruktive Aktion MUST NOT direkt an ein normales Bedienelement angrenzen, auch nicht bei schmalen Viewports.
- **FR-011**: Auf mobilen Viewports MUST jedes interaktive Element (Buttons, Links, Tabs, Navigationseinträge, Icon-Buttons) mindestens 44x44px groß sein. Die gemeinsamen Komponenten MUST dies zentral sicherstellen, nicht einzelne Seiten.
- **FR-012**: Alle bestehenden Wizards (Gerät, Aktion, Traefik-Provider, Onboarding) MUST auf Viewports ab 320px Breite ohne horizontales Scrollen vollständig durchlaufbar sein, ihre Navigationsaktionen MUST FR-010 und FR-011 erfüllen.
- **FR-013**: Bestehende Funktionen, Texte der Aktionen, Routen und Datenflüsse MUST unverändert bleiben. Nur Struktur, Platzierung, Größe und Darstellung ändern sich.
- **FR-014**: Die Änderungen MUST für helles und dunkles Erscheinungsbild gleichermaßen gelten.

### Key Entities

Keine neuen Daten. Betroffen sind die bestehenden Seiten und Oberflächenelemente: Top-Navigation, Breadcrumbs, Tab-Leiste eines Geräts, Hauptaktion, Karten/Listenzeilen mit Aktionsgruppen, Wizards.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100 % der Detailseiten (Aktionen, Verlauf, Einstellungen, Update-Historie) zeigen Breadcrumbs, und 100 % der Geräte-Bereiche sind über eine Tab-Leiste erreichbar. Keine Seite zeigt einen Titel, der den aktiven Tab wiederholt.
- **SC-002**: 100 % der Seiten mit Hauptaktion zeigen sie ab 768px oben rechts und darunter als unten fixierten Button.
- **SC-003**: 0 interaktive Elemente unter 44x44px auf mobilen Viewports in einer Prüfung aller Seiten und Wizards.
- **SC-004**: 100 % der Karten und Listenzeilen mit destruktiven Aktionen platzieren sie rechts, in Danger-Farbe und mit mindestens 12px Abstand zu benachbarten Bedienelementen.
- **SC-005**: Alle vier Wizards lassen sich auf einem 320px breiten Viewport vollständig und ohne horizontales Scrollen abschließen.
- **SC-006**: Nutzer erreichen in einer Prüfung mit dem Daumen auf einem Smartphone die Hauptaktion und die wichtigste Aktion jeder Karte ohne Umgreifen.
- **SC-007**: Alle bestehenden Frontend-Tests und Lint-Prüfungen laufen nach der Änderung weiterhin durch, die Funktionalität ist unverändert.

## Assumptions

- Gültig ist der Wortlaut von Prinzip III der Constitution in Version 1.2.0. Sollte er sich ändern, ändert sich auch diese Spec.
- Die Breakpoint-Grenze ist 768px, wie im Prinzip festgelegt. Als „mobil“ gilt alles darunter.
- Der Account-Kreis ist ein reiner Link zu Account und zeigt vorerst nur ein neutrales Symbol. Initialen, Benutzer-Avatar und Account-Details (Name, E-Mail) sind ein späteres, eigenes Feature und stehen in [docs/backlog.md](../../docs/backlog.md). Das Frontend kennt heute weder Name noch E-Mail-Adresse.
- Die Seite Account bleibt als Seite erhalten und wird nur nicht mehr als Textlink geführt.
- Die Tab-Leiste gehört zu den Geräte-Seiten Actions, History und Settings. Die Update-Historie einer Aktion ist eine Unterseite des Geräts mit eigener Breadcrumb-Kette und keiner eigenen Tab-Leiste.
- Auf Seiten ohne Detailkontext (Credentials, Agents, Notifications, Account) ersetzt die Breadcrumb-Zeile die Seitenüberschrift. Eine visuell verborgene Überschrift für Hilfstechnologien bleibt erlaubt.
- Aktionen, die sofort etwas ausführen (z. B. „Re-run“ in der Update-Historie), sind keine primäre CTA im Sinne von FR-006/FR-007 und bleiben normale Buttons im Kopfbereich.
- Pro Seite gibt es höchstens eine primäre CTA. Welche das ist, legt der Plan je Seite fest.
- Sekundäre Seitenaktionen, die heute neben der Hauptaktion stehen (z. B. Verlauf, Einstellungen), werden durch Tabs ersetzt oder zu gewöhnlichen Sekundäraktionen.
- Nur Frontend. Backend, Agent, Protokoll, Routen und API bleiben unverändert.
- Die Touch-Größe gilt für mobile Viewports. Auf dem Desktop darf die kompaktere Darstellung bleiben.
- Das Erscheinungsbild folgt weiter dem bestehenden Designsystem (Farben, Danger-Token, helles/dunkles Schema).
