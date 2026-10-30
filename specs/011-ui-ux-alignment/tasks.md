---

description: "Task list for UI/UX-Angleichung an Constitution Prinzip III"
---

# Tasks: UI/UX-Angleichung an Constitution Prinzip III

**Input**: Design documents from `/specs/011-ui-ux-alignment/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ui-components.md, quickstart.md (alle vorhanden)

**Tests**: Enthalten. plan.md und research.md R8 legen zwei Ebenen fest: Vitest (`frontend/tests/unit`) für Struktur und Verträge, Playwright (`frontend/tests/e2e`) für Geometrie. Die E2E-Tests brauchen den gespeicherten Anmeldezustand (`frontend/tests/e2e/README.md`), sonst laufen nur Routen ohne Anmeldung.

**Organization**: Aufgaben sind nach User Story gruppiert (spec.md: US1 bis US3 P1, US4 und US5 P2, US6 P3). Pfade sind relativ zum Repository-Root.

**Commits**: Keine Aufgabe enthält einen Commit. Commits entstehen nur auf ausdrückliche Anweisung (Constitution, Prinzip I).

**Annahmen dieser Task-Liste**: Nur `frontend/` und Doku ändern sich. Routen, API-Aufrufe und Texte der Aktionen bleiben unverändert (FR-013). Der Account-Kreis zeigt nur ein neutrales Symbol, Initialen und Avatar stehen in `docs/backlog.md` (research.md R6). `docs/backlog.md` existiert bereits.

## Format: `[ID] [P?] [Story] Beschreibung`

- **[P]**: parallel ausführbar (andere Dateien, keine Abhängigkeit von offenen Aufgaben)
- **[Story]**: zugehörige User Story (US1 … US6)

## Path Conventions

- Frontend: `frontend/src/`, Unit-Tests `frontend/tests/unit/`, E2E `frontend/tests/e2e/`
- Doku im Repository-Root (`docs/`)
- Keine Änderung an `backend/`, `agent/`, `proto/`, `docker-compose.yml`.

---

## Phase 1: Setup

Entfällt. Es gibt keine neuen Abhängigkeiten und keine neue Konfiguration.

---

## Phase 2: Foundational (Blocker für alle Stories)

**Purpose**: Die zentrale Touch-Regel, auf der alle neuen Bausteine aufsetzen (research.md R1, R2).

- [x] T001 [P] Utility `.touch-target` (`max-md:min-h-11 max-md:min-w-11`, Breakpoint 768px) in einem `@layer components`-Block in `frontend/src/app.css` ergänzen
- [x] T002 [P] Mobile Mindestgrößen in `frontend/src/components/ui/button.tsx` ergänzen: `max-md:min-h-11` für alle Größen, `max-md:min-w-11` für `icon`. Desktop-Maße und Varianten unverändert (contracts/ui-components.md, „Button“)

**Checkpoint**: Buttons sind mobil mindestens 44px hoch, `.touch-target` steht für alle weiteren Komponenten bereit.

---

## Phase 3: User Story 1 - Breadcrumbs und Tabs auf Detailseiten (Priority: P1) 🎯 MVP

**Goal**: Geräte-Seiten zeigen Breadcrumbs und eine Tab-Leiste (Actions, History, Settings), keine redundante Überschrift.

**Independent Test**: Ein Gerät öffnen und durch alle drei Bereiche wechseln. Breadcrumb `Devices / Gerätename`, Tab-Leiste mit aktivem Zustand, keine sichtbare Überschrift, die den Tab wiederholt. Siehe quickstart.md Schritt 2.

### Tests für User Story 1

- [x] T003 [P] [US1] Test für `NavTabs` und `DeviceLayout` in `frontend/tests/unit/device-layout.test.tsx`: drei Links Actions/History/Settings, `aria-current="page"` genau am aktiven Tab (je Pfad), Kind-Inhalt wird unterhalb gerendert, `<nav>` hat `aria-label`
- [x] T004 [P] [US1] `frontend/tests/unit/breadcrumbs.test.tsx` anpassen: Actions, History und Settings liefern jeweils `Devices / Gerätename` (Gerätename ohne Link), `/actions/:actionId/executions` behält `Devices / Gerät / Update history` (research.md R5)

### Implementierung für User Story 1

- [x] T005 [P] [US1] `frontend/src/components/ui/nav-tabs.tsx` anlegen: `NavTabs` mit `items: { href, label }[]`, `<nav aria-label>`, `<A>`-Links mit `aria-current="page"` und sichtbarem aktivem Stil (Unterstrich plus Farbe), horizontal scrollbar (`overflow-x-auto`), jeder Eintrag mit `.touch-target`
- [x] T006 [P] [US1] `frontend/src/components/layout/PageHeader.tsx` anlegen: `<h1 class="sr-only">` mit `title`, rechtsbündiger Slot (`flex justify-end`) für Kinder, keine sichtbare Zeile ohne Kinder (contracts/ui-components.md, „PageHeader“)
- [x] T007 [US1] `frontend/src/lib/breadcrumbs.ts` ändern: Routen `actions`, `history` und `settings` zeigen `Devices / Gerätename` mit Gerätename als aktueller Seite (hängt von T004 ab)
- [x] T008 [US1] `frontend/src/components/layout/DeviceLayout.tsx` anlegen: rendert `NavTabs` für `/ip-clients/:ipClientId/{actions,history,settings}` und darunter `props.children` (hängt von T005 ab)
- [x] T009 [US1] `frontend/src/App.tsx`: Routen `actions`, `history`, `settings` unter eine verschachtelte Route `/ip-clients/:ipClientId` mit `DeviceLayout` stellen. URLs bleiben unverändert (hängt von T008 ab)
- [x] T010 [US1] `frontend/src/pages/Actions.tsx`: sichtbare `<h1>` und die Buttons „History“ und „Settings“ entfernen, Seitenkopf über `PageHeader` (title „Actions“). „Add an action“ bleibt vorerst als Kind des `PageHeader` (hängt von T006 ab)
- [x] T011 [P] [US1] `frontend/src/pages/DeviceHistory.tsx`: sichtbare `<h1>` durch `PageHeader` mit sr-only-Titel `Gerätename – History` ersetzen (hängt von T006 ab)
- [x] T012 [P] [US1] `frontend/src/pages/DeviceSettings.tsx`: sichtbare `<h1>` durch `PageHeader` mit sr-only-Titel `Gerätename – Settings` ersetzen (hängt von T006 ab)
- [x] T013 [P] [US1] `frontend/src/pages/ExecutionHistory.tsx`: sichtbare `<h1>` durch `PageHeader` (title „Update history“) ersetzen. Der Button „Re-run“ bleibt im Slot (hängt von T006 ab)
- [x] T014 [US1] `frontend/tests/unit/device-history-page.test.tsx` und weitere betroffene Unit-Tests anpassen, falls sie die sichtbare Überschrift erwarten; danach `pnpm --filter fluxip-frontend test` ausführen

**Checkpoint**: US1 ist allein nutzbar: Tabs und Breadcrumbs auf allen Geräte-Seiten, keine redundanten Titel.

---

## Phase 4: User Story 2 - Haupt-CTA oben rechts, mobil als Floating Action Button (Priority: P1)

**Goal**: Jede Seite mit Hauptaktion zeigt sie ab 768px oben rechts und darunter als unten fixierten Button.

**Independent Test**: Jede Listenseite bei 1280px und bei 390px öffnen und die Position der Hauptaktion prüfen. Siehe quickstart.md Schritt 3.

### Tests für User Story 2

- [x] T015 [P] [US2] Test in `frontend/tests/unit/primary-action.test.tsx`: genau ein Button wird gerendert, trägt die Klassen für Desktop (rechtsbündig) und Mobile (`max-md:fixed`, unten rechts), Klick löst `onClick` aus, `as="a"` rendert einen Link
- [x] T016 [P] [US2] E2E-Test `frontend/tests/e2e/primary-action.spec.ts`: ab 768px liegt die Hauptaktion am oberen rechten Rand des Inhaltsbereichs, darunter ist sie am unteren Rand des Viewports fixiert, bleibt beim Scrollen sichtbar und verdeckt den letzten Inhalt nicht

### Implementierung für User Story 2

- [x] T017 [US2] `frontend/src/components/layout/PrimaryAction.tsx` anlegen: ein einziger `Button`, Desktop rechtsbündig im Header, unter 768px `fixed bottom-4 right-4 z-30` mit Schatten, mindestens 56px, Abstand `max(1rem, env(safe-area-inset-bottom))`, Attribut `data-primary-action` (contracts/ui-components.md, „PrimaryAction“)
- [x] T018 [US2] `frontend/src/components/layout/AppShell.tsx`: `<main>` bekommt unter 768px zusätzlichen unteren Innenabstand, wenn eine `PrimaryAction` gerendert ist (`max-md:has-[[data-primary-action]]:pb-24`) (hängt von T017 ab)
- [x] T019 [US2] ENTFALLEN (Analyse I1): Die Buttons im Leerzustand bleiben unverändert, damit Texte und Funktionen gleich bleiben (FR-013). `EmptyState.tsx` ändert sich nicht
- [x] T020 [P] [US2] `frontend/src/pages/IpClients.tsx`: „Add a device“ als `PrimaryAction` im `PageHeader` (title „Devices“), `EmptyState` unverändert (hängt von T017 ab)
- [x] T021 [P] [US2] `frontend/src/pages/Credentials.tsx`: „Add credential“ als `PrimaryAction` im `PageHeader` (title „Credentials“), `EmptyState` unverändert (hängt von T017 ab)
- [x] T022 [P] [US2] `frontend/src/pages/TraefikProviders.tsx`: „Add an agent“ als `PrimaryAction` im `PageHeader` (title „Agents“), `EmptyState` unverändert (hängt von T017 ab)
- [x] T023 [US2] `frontend/src/pages/Actions.tsx`: „Add an action“ als `PrimaryAction` im `PageHeader`, `EmptyState` unverändert (hängt von T010, T017, T019 ab)
- [x] T024 [P] [US2] ENTFALLEN (Analyse I2): „Re-run“ löst sofort eine Ausführung aus und bleibt ein normaler Button im Kopfbereich statt eines schwebenden Buttons
- [x] T025 [P] [US2] `frontend/src/pages/NotificationSettings.tsx` und `frontend/src/pages/Account.tsx`: sichtbare `<h1>` durch `PageHeader` mit sr-only-Titel ersetzen, keine Hauptaktion, `EmptyState` in `NotificationSettings.tsx` ohne eigene Aktion, falls dort ein Formular dieselbe Aufgabe erfüllt (hängt von T006 ab)
- [x] T026 [US2] Betroffene Unit-Tests anpassen (`frontend/tests/unit/credentials-page.test.tsx`, `frontend/tests/unit/traefik-providers-page.test.tsx`), danach `pnpm --filter fluxip-frontend test` ausführen

**Checkpoint**: US1 und US2 funktionieren unabhängig voneinander. Jede Seite hat höchstens eine primäre CTA.

---

## Phase 5: User Story 3 - Sichere und destruktive Aktionen getrennt (Priority: P1)

**Goal**: Auf Karten und Zeilen stehen sichere Aktionen links, destruktive rechts in Danger-Farbe, mit mindestens 12px Abstand.

**Independent Test**: Eine Aktionskarte mit Edit, Disable und Detach bei 1280px und 320px ansehen. Siehe quickstart.md Schritt 4.

### Tests für User Story 3

- [x] T027 [P] [US3] Test in `frontend/tests/unit/card-actions.test.tsx`: `safe`-Inhalt liegt vor dem `danger`-Inhalt im DOM, Container tragen `gap-3`, der Danger-Container `ml-auto`, ein `destructive`-Button außerhalb des Danger-Containers wird als Fehler erkannt, jeder Slot funktioniert allein

### Implementierung für User Story 3

- [x] T028 [US3] `frontend/src/components/ui/card-actions.tsx` anlegen: `CardActions` mit Props `safe` und `danger`, `flex flex-wrap items-center gap-3`, Danger-Bereich mit `ml-auto` (contracts/ui-components.md, „CardActions“)
- [x] T029 [P] [US3] `frontend/src/pages/Actions.tsx`: Edit und Disable/Enable in `safe`, Detach (`variant="destructive"`) in `danger` (hängt von T028 ab)
- [x] T030 [P] [US3] `frontend/src/pages/Credentials.tsx`: Löschen in `danger` (hängt von T028 ab)
- [x] T031 [P] [US3] `frontend/src/pages/TraefikProviders.tsx`: „New token“ und „Rename“ in `safe`, Löschen in `danger` (hängt von T028 ab)
- [x] T032 [P] [US3] `frontend/src/pages/DeviceSettings.tsx`: Aktivieren/Deaktivieren und Zugangsdaten erneuern in `safe`, Decommission in `danger` (hängt von T028 ab)
- [x] T033 [P] [US3] `frontend/src/pages/NotificationSettings.tsx`: geprüft und unverändert gelassen. „Remove“ löscht nur die Benachrichtigungsadressen (jederzeit neu anlegbar), ist also nicht destruktiv im Sinne von Prinzip III und steht inline in einer Zeile, nicht am Kartenende (Analyse U1)
- [x] T034 [P] [US3] `frontend/src/pages/Account.tsx`: „Change password“ in `safe`, „Delete my account“ in `danger` der jeweiligen Karte (hängt von T028 ab)
- [x] T035 [US3] Betroffene Unit-Tests anpassen und `pnpm --filter fluxip-frontend test` ausführen

- [x] T035a [US3] Kontrast des Danger-Tokens im Dunkelmodus (Analyse U2): `--destructive` in `frontend/src/app.css` von 30.6 % auf 45 % Helligkeit angehoben (rund 3:1 gegen den Hintergrund, rund 6:1 gegen den Vordergrund)

**Checkpoint**: Alle Aktionsgruppen folgen FR-008 bis FR-010. US1 bis US3 sind zusammen der P1-Umfang.

---

## Phase 6: User Story 4 - Touch-gerechte Bedienelemente (Priority: P2)

**Goal**: Auf mobilen Viewports ist jedes interaktive Element mindestens 44x44px groß.

**Independent Test**: Bei 390px und 360px alle Seiten und Dialoge vermessen. Siehe quickstart.md Schritt 5.

### Tests für User Story 4

- [x] T036 [US4] E2E-Test `frontend/tests/e2e/touch-targets.spec.ts`: auf den mobilen Playwright-Projekten alle sichtbaren `a`, `button`, `[role=button]`, `input`, `select` je Route messen (`boundingBox`) und Breite sowie Höhe >= 44 prüfen. Ausnahme: Links im Fließtext, die als solche markiert sind

### Implementierung für User Story 4

- [x] T037 [P] [US4] `frontend/src/components/ui/breadcrumb.tsx` und `frontend/src/components/layout/Breadcrumbs.tsx`: Links mit `.touch-target` und vertikaler Zentrierung
- [x] T038 [P] [US4] `frontend/src/components/ui/dialog.tsx`: Schließen-Button mit `.touch-target` (mobil 44x44px)
- [x] T039 [P] [US4] `frontend/src/components/ui/text-field.tsx`, `frontend/src/components/ui/select.tsx`, `frontend/src/components/ui/checkbox.tsx`: Eingabefelder, Select-Trigger und Checkbox-Zeile mobil mindestens 44px hoch
- [x] T040 [P] [US4] `frontend/src/components/feedback/CopyButton.tsx` und einzelne Textlinks (z. B. „View history“ in `frontend/src/pages/Actions.tsx`): mobil auf 44px Höhe bringen, per `Button variant="link"` oder `.touch-target`
- [x] T041 [US4] Verbleibende Verstöße aus dem Lauf von T036 beheben (Tabellenzeilen-Links in `frontend/src/components/ui/table.tsx`, Seiten-Buttons in `frontend/src/pages/DeviceHistory.tsx` u. a.) und den Test grün bekommen

**Checkpoint**: SC-003 erfüllt, Desktop-Darstellung unverändert kompakt.

---

## Phase 7: User Story 5 - Wizards auf dem Smartphone (Priority: P2)

**Goal**: Alle vier Wizards sind ab 320px Breite ohne horizontales Scrollen durchlaufbar, die Navigation liegt in Daumenreichweite.

**Independent Test**: Jeden Wizard bei 320px vollständig durchlaufen. Siehe quickstart.md Schritt 6.

### Tests für User Story 5

- [x] T042 [P] [US5] `frontend/playwright.config.ts`: Projekte `mobile-320-light` und `mobile-320-dark` mit Viewport 320x700 ergänzen
- [x] T043 [US5] `frontend/tests/e2e/responsive.spec.ts` und die Wizard-Specs (`device-wizard.spec.ts`, `action-wizard.spec.ts`, `traefik-provider.spec.ts`, `onboarding.spec.ts`) erweitern. Umgesetzt: Routen ergänzt und ein Test für den Geräte-Wizard (Überlauf, Abbrechen/Weiter erreichbar und mindestens 44px) in `responsive.spec.ts`. Die übrigen Wizards sind nicht einzeln in E2E abgedeckt (hängt von T042 ab)

### Implementierung für User Story 5

- [x] T044 [P] [US5] `frontend/src/flows/wizard/WizardShell.tsx`: Fußzeile mit `gap-3`, Umbruch bei schmaler Breite, Weiter rechts unten, Abbrechen klar von Weiter getrennt, alle Buttons mit Touch-Größe
- [x] T045 [P] [US5] `frontend/src/components/ui/dialog.tsx`: `max-h-dvh`, innen scrollbar, `DialogFooter` mit `gap-3` statt `space-x-2`, damit die Fußzeile bei geöffneter Bildschirmtastatur erreichbar bleibt (research.md R9)
- [x] T046 [P] [US5] Schritte unter `frontend/src/flows/device-wizard/steps/` und `frontend/src/flows/action-wizard/steps/` bei 320px durchsehen und Überläufe beheben (Raster, lange Werte, Selects)
- [x] T047 [P] [US5] Schritte unter `frontend/src/flows/traefik-provider-wizard/` (inklusive `SetupResult.tsx`) und `frontend/src/flows/onboarding/` bei 320px durchsehen und Überläufe beheben
- [x] T048 [US5] Bestehende Wizard-Unit-Tests (`traefik-provider-wizard.test.tsx`, `useWizard.test.ts` u. a.) ausführen und anpassen

**Checkpoint**: SC-005 erfüllt, alle Wizards bei 320px nutzbar.

---

## Phase 8: User Story 6 - Klare Top-Navigation (Priority: P3)

**Goal**: Top-Bar mit Devices, Credentials, Agents, Notifications, rechts ein Kreis (neutrales Symbol) zu Account und der unveränderte Abmelden-Button.

**Independent Test**: Alle Navigationsziele bei 1280px und 360px erreichen. Siehe quickstart.md Schritt 1.

### Tests für User Story 6

- [x] T049 [P] [US6] Test in `frontend/tests/unit/app-shell.test.tsx`: vier Hauptlinks in dieser Reihenfolge, Link `/account` mit `aria-label="Account"` und `aria-current="page"` auf der Account-Seite, Abmelden-Button direkt rechts neben dem Kreis, kein Link „Account“ oder Textlink „Notifications“ mehr außerhalb der Hauptnavigation

### Implementierung für User Story 6

- [x] T050 [P] [US6] `frontend/src/components/layout/UserBadge.tsx` anlegen: Link zu `/account`, Kreis (mobil 44x44px, Desktop 40px) mit Inline-SVG-Personen-Symbol, aktiver Zustand auf der Account-Seite (contracts/ui-components.md, „UserBadge“)
- [x] T051 [US6] `frontend/src/components/layout/AppShell.tsx`: `NAV_LINKS` auf Devices, Credentials, Agents, Notifications reduzieren, rechts `UserBadge` und der unveränderte Abmelden-Button; unter 768px erste Zeile Logo und rechte Gruppe, zweite Zeile Links horizontal scrollbar, Links mit `.touch-target`; Name und Version neben dem Logo unter 640px ausblenden (hängt von T050, T018 ab)
- [ ] T052 [US6] Bei 320px prüfen (noch offen, braucht angemeldete Sitzung; Routen in `responsive.spec.ts` sind ergänzt), dass die Leiste ohne horizontales Scrollen der Seite auskommt, und `frontend/tests/e2e/responsive.spec.ts` um die Routen `/credentials`, `/agents` ergänzen

**Checkpoint**: Alle sechs Stories sind einzeln und zusammen lauffähig.

---

## Phase 9: Polish und übergreifende Punkte

- [x] T053 [P] `docs/development.md`: kurzen Abschnitt „UI-Konventionen“ ergänzen (Verweis auf Constitution Prinzip III, die Bausteine `PrimaryAction`, `CardActions`, `NavTabs`, `PageHeader`, Regel „Touch-Größe zentral“)
- [x] T054 [P] Prüfen, ob `README.md` oder `docs/architecture.md` Screenshots oder Beschreibungen der alten Navigation enthalten, und diese anpassen
- [x] T055 (Frontend: Lint und 101 Unit-Tests grün; das Backend-Lint scheitert unverändert an den bekannten Parse-Fehlern) `pnpm run lint` und `pnpm --filter fluxip-frontend test` ausführen und Fehler beheben (bekannte Lint-Parse-Fehler im Backend siehe Memory „Backend test baseline failures“ sind nicht Teil dieser Arbeit)
- [ ] T056 `pnpm --filter fluxip-frontend test:e2e` auf allen Projekten (320/360px, Desktop, hell/dunkel) ausführen, einschließlich axe-Prüfung
- [ ] T057 [P] Manuelle Abnahme nach `specs/011-ui-ux-alignment/quickstart.md` (Schritte 1 bis 8) durchführen und Abweichungen festhalten

---

## Dependencies & Execution Order

### Phase-Abhängigkeiten

- Phase 2 (Foundational) blockiert alle Stories.
- US1 bis US6 hängen sonst nur lose zusammen. Gemeinsame Dateien erzwingen eine Reihenfolge:
  - `PageHeader` (T006, US1) wird von US2 genutzt: US2 beginnt nach T006.
  - `frontend/src/pages/Actions.tsx`: T010 (US1) → T023 (US2) → T029 (US3) → T040 (US4).
  - `frontend/src/pages/Credentials.tsx`, `TraefikProviders.tsx`: US2 → US3.
  - `frontend/src/components/layout/AppShell.tsx`: T018 (US2) → T051 (US6).
  - `frontend/src/components/ui/dialog.tsx`: T038 (US4) und T045 (US5) nacheinander.
- Phase 9 (Polish) folgt, wenn die gewünschten Stories fertig sind.

### Innerhalb einer Story

- Tests zuerst schreiben und fehlschlagen sehen, dann implementieren.
- Gemeinsame Komponente vor den Seiten, die sie verwenden.

### Parallele Möglichkeiten

- Foundational: T001 und T002.
- US1: T003, T004, T005, T006 zusammen; danach T011, T012, T013 zusammen.
- US2: T015 und T016 zusammen; danach T020, T021, T022, T024, T025 zusammen.
- US3: T029 bis T034 zusammen (verschiedene Dateien).
- US4: T037 bis T040 zusammen.
- US5: T042, T044, T045, T046, T047 zusammen.
- US6: T049 und T050 zusammen.
- Polish: T053, T054, T057.

---

## Implementation Strategy

### MVP zuerst

1. Phase 2 (Foundational) abschließen.
2. US1 (Tabs und Breadcrumbs) ausliefern und prüfen. Das ist die Grundlage für die übrigen Seitenänderungen.
3. US2 und US3 (P1) ergänzen und je einzeln prüfen.

### Schrittweise Auslieferung

- Nach jeder Story ist die UI lauffähig und alle Tests grün. Dazwischen kann gemergt werden.
- US4 und US5 (P2) folgen, US6 (P3) zuletzt.
- Jede Story bleibt für sich testbar, auch wenn spätere noch fehlen.

---

## Notes

- Keine Änderung an Backend, Agent oder Protokoll. Alle Tests liegen unter `frontend/`.
- Die E2E-Tests mit Anmeldung brauchen den manuell erzeugten Zustand `playwright/.auth/user.json`.
- Bleibt `@axe-core/playwright` rot wegen fehlender `<h1>`, ist der `PageHeader` falsch eingebunden (research.md R10).
