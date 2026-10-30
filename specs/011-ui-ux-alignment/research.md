# Research: UI/UX-Angleichung

Alle offenen Punkte des Technical Context sind entschieden. Es gibt keine `NEEDS CLARIFICATION`-Marker.

## R1: Wie wird "unter 768px" umgesetzt?

- **Decision**: Tailwinds Standard-Breakpoint `md` (768px) mit der Variante `max-md:` für alle mobilen Regeln. Kein JavaScript, kein `matchMedia`.
- **Rationale**: `md` entspricht exakt der Grenze aus Prinzip III. Reines CSS reagiert ohne Neuladen auf Drehen oder Fenstergröße (Edge Case der Spec) und ist in jsdom über Klassen prüfbar. Tailwind 3.4 kennt `max-md:`.
- **Alternatives considered**: `matchMedia`-Signal in Solid (mehr Code, Flackern beim ersten Rendern). Mobile-first mit `md:`-Überschreibungen (würde die vorhandenen Desktop-Klassen aller Seiten umschreiben).

## R2: Touch-Mindestgröße zentral

- **Decision**: In `button.tsx` bekommt jede Größe eine mobile Mindesthöhe (`max-md:min-h-11`, 44px), `icon` zusätzlich `max-md:min-w-11`. Eingabefelder, Select-Trigger, Checkbox-Zeile, Dialog-Schließen-Button, Breadcrumb-Links, Nav-Links und reine Textlinks erhalten dieselbe Regel über eine Utility `.touch-target` in `app.css`. Seiten setzen keine eigenen Größen.
- **Rationale**: Eine Regel pro Komponente stellt FR-011 für künftige Seiten sicher. Desktop bleibt kompakt, weil die Regel nur unter 768px gilt.
- **Alternatives considered**: Alle Größen global erhöhen (verändert die Desktop-Optik, verletzt die Randbedingung). Größenprüfung nur per Review (nicht dauerhaft durchsetzbar). E2E-Geometrieprüfung (R8) fängt Abweichungen trotzdem ab.

## R3: Haupt-CTA oben rechts / Floating Action Button

- **Decision**: `PrimaryAction` rendert genau einen `Button`. Ab 768px sitzt er rechtsbündig im `PageHeader`. Unter 768px erhält derselbe Button `fixed bottom-4 right-4 z-30`, Schatten, Mindestgröße 56px sowie Rand unten gemäß `env(safe-area-inset-bottom)`. `<main>` bekommt unter 768px zusätzlichen unteren Innenabstand, wenn eine `PrimaryAction` gerendert wird, damit nichts verdeckt wird.
- **Rationale**: Ein einziges DOM-Element mit zwei CSS-Formen vermeidet doppelte Fokusziele und Zustandsabgleich. `fixed` hängt am Viewport, solange kein Vorfahre `transform` setzt (im AppShell der Fall nicht).
- **Alternatives considered**: Zwei Elemente (Desktop-Button, mobiler FAB) mit `hidden`/`md:hidden` (doppelter Eintrag für Screenreader, doppelte Logik). Bottom-Navigation (nicht gefordert).

## R4: Tabs für die Gerätebereiche

- **Decision**: Eine verschachtelte Route `/ip-clients/:ipClientId` mit `DeviceLayout` als Elternkomponente. Sie rendert unter den Breadcrumbs eine Link-basierte Tab-Leiste (`nav-tabs.tsx`: `<nav aria-label>`, `<A>` mit `aria-current="page"` und sichtbarem aktivem Stil) und `props.children` für Actions, History, Settings. Die URLs bleiben unverändert.
- **Rationale**: Die Tabs sind echte Navigation (eigene URLs, Zurück-Taste, Deep-Links). Kobalte `Tabs` modelliert Panels auf einer Seite und passt dazu nicht. Die Leiste ist horizontal scrollbar (`overflow-x-auto`), jeder Tab hat die Touch-Größe.
- **Alternatives considered**: Kobalte `Tabs` mit Routing-Synchronisierung (mehr Zustand, doppelte Wahrheit). Tab-Leiste pro Seite wiederholen (Duplikation).

## R5: Breadcrumbs der Gerätebereiche

- **Decision**: Actions, History und Settings zeigen übereinstimmend `Devices / Gerätename` (Gerätename ist die aktuelle Seite, kein Link). Den Bereich nennt die Tab-Leiste. `/actions/:actionId/executions` behält `Devices / Gerät / Update history`, wobei Gerät auf die Aktionen führt.
- **Rationale**: Prinzip III verlangt `Devices / [Device-ID]` und Tabs für den Bereich. Ein dritter Breadcrumb-Eintrag würde den Tab wiederholen.
- **Alternatives considered**: Bereich zusätzlich im Breadcrumb (redundant zum aktiven Tab).

## R6: Inhalt des Benutzerkreises

- **Decision**: `UserBadge` zeigt vorerst ein neutrales Personen-Symbol (Inline-SVG), keine Initialen. Es ist ein Link zu `/account` mit `aria-label="Account"`. Initialen, Avatar und Account-Details werden als eigenes Feature in [docs/backlog.md](../../docs/backlog.md) geführt (Entscheidung 2026-10-30).
- **Rationale**: Das Frontend kennt heute nur `sub`. Die Anmeldung fordert nur `openid` und `offline_access` an (laut `auth.ts` ist `profile` für diese Anwendung nicht freigegeben), und `GET /account` liefert nur `accountId`. Name oder E-Mail bereitzustellen braucht Logto-Konfiguration, ein erneutes Anmelden oder einen Backend-Endpunkt und verlässt den Scope „nur Frontend“.
- **Konsequenz**: Kein Code für Claims, kein Zugriff auf das ID-Token, keine Scope-Änderung. Position, Größe und Ziel des Kreises sind festgelegt, ein späteres Feature ersetzt nur den Inhalt.
- **Alternatives considered**: Initialen aus ID-Token-Claims ableiten (mit der heutigen Konfiguration nie befüllt, toter Code). `email`-Scope jetzt anfordern (Logto-Freigabe ungeprüft, Re-Login). Neuer Backend-Endpunkt (Backend-Änderung).

## R7: Aktionsgruppen in Karten und Zeilen

- **Decision**: `CardActions` hat zwei benannte Bereiche, `safe` (links) und `danger` (rechts). Layout: `flex flex-wrap items-center gap-3`, der Danger-Bereich bekommt `ml-auto`. Bricht die Zeile um, steht der Danger-Bereich rechtsbündig in einer eigenen Zeile mit 12px Zeilenabstand. Buttons im Danger-Bereich verwenden `variant="destructive"`. Ein Test stellt sicher, dass `destructive`-Buttons ausschließlich im Danger-Bereich liegen.
- **Rationale**: Struktur statt Konvention macht FR-008 bis FR-010 testbar. `gap-3` ist genau 12px.
- **Alternatives considered**: Pro Seite eigenes Flex-Layout (Wiederholung, Abweichungen unbemerkt). Trennlinie zwischen den Gruppen (zusätzliche Optik, nicht gefordert).

## R8: Wie wird die Einhaltung geprüft?

- **Decision**: Zwei Ebenen. Vitest prüft Struktur und Verträge der neuen Komponenten (Reihenfolge, Slots, `aria-current`, Klassen, Breadcrumbs). Playwright prüft Geometrie auf mobilen Projekten: jedes sichtbare `a, button, [role=button], input, select` hat mindestens 44x44px, die Haupt-CTA liegt ab 768px oben rechts und darunter am unteren Rand, kein horizontaler Überlauf bei 320px und 360px. `@axe-core/playwright` läuft weiter.
- **Rationale**: jsdom berechnet kein Layout, Größen lassen sich dort nicht verlässlich messen. Die E2E-Tests brauchen laut `tests/e2e/README.md` einen manuell erzeugten Anmeldezustand; ohne ihn laufen sie wie bisher nur für nicht angemeldete Routen.
- **Alternatives considered**: Nur manuelle Prüfung (nicht wiederholbar). Visuelle Regressionstests (keine bestehende Infrastruktur).

## R9: Wizards auf dem Smartphone

- **Decision**: Die Wizards laufen in `Dialog` bzw. Seite mit `WizardShell`. Geändert werden die Fußzeile (`gap-3`, Touch-Größe, Umbruch ab 320px so, dass Weiter am rechten unteren Rand bleibt) und der Dialog (maximale Höhe `dvh`, innen scrollbar, damit die Fußzeile bei geöffneter Tastatur erreichbar bleibt). Inhalte der Schritte bleiben unverändert. Gefundene Überläufe in einzelnen Schritten werden beim Durchlauf behoben.
- **Rationale**: Der gemeinsame `WizardShell` ist der einzige Ort für die Navigation aller Wizards.
- **Alternatives considered**: Wizards als Vollbildseiten (größere Änderung von Routen und Verhalten, widerspricht FR-013).

## R10: Seitenüberschriften und Barrierefreiheit

- **Decision**: `PageHeader` rendert eine `sr-only`-`<h1>` mit dem Seitennamen. Auf Geräte-Tabs lautet sie `Gerätename – Bereich`.
- **Rationale**: FR-005 untersagt die sichtbare Wiederholung, aber die axe-Regel „page-has-heading-one“ und Screenreader-Navigation brauchen eine Hauptüberschrift.
- **Alternatives considered**: Ganz ohne `<h1>` (verletzt Barrierefreiheit).
