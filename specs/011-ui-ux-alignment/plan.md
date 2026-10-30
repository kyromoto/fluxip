# Implementation Plan: UI/UX-Angleichung an Constitution Prinzip III

**Branch**: `011-ui-ux-alignment` | **Date**: 2026-10-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/011-ui-ux-alignment/spec.md`

## Summary

Das Frontend bekommt eine kleine Menge gemeinsamer Bausteine, die Prinzip III der Constitution an einer Stelle durchsetzen, statt jede Seite einzeln anzupassen: eine Touch-Mindestgröße in den gemeinsamen UI-Komponenten (`max-md:` ab 768px abwärts), eine `PrimaryAction`-Komponente (oben rechts, mobil als Floating Action Button, rein per CSS), eine `CardActions`-Komponente (sicher links, destruktiv rechts, 12px Abstand), ein `DeviceLayout` als verschachtelte Route mit Tab-Leiste für Actions/History/Settings und ein `UserBadge` (neutraler Kreis zu Account) in der Top-Bar. Die großen sichtbaren `<h1>`-Titel entfallen, für Hilfstechnologien bleibt eine `sr-only`-Überschrift. Alle Seiten und die Wizard-Navigation werden auf diese Bausteine umgestellt.

Im Plan zeigte sich: Die Anmeldung fordert nur die Scopes `openid` und `offline_access` an, der Token enthält nur `sub`, und `GET /account` liefert nur `accountId`. Das Frontend kennt also weder Name noch E-Mail-Adresse. Der Kreis zeigt deshalb vorerst nur ein neutrales Personen-Symbol (siehe research.md R6). Initialen, Avatar und Account-Details sind ein späteres Feature im [Backlog](../../docs/backlog.md).

Es gibt keine neue Abhängigkeit, keine neue gespeicherte Entität und keine Backend-, Agent- oder Protokolländerung.

## Technical Context

**Language/Version**: TypeScript 5.7, SolidJS 1.9, `@solidjs/router` 0.15 (bestehend, `frontend/`). Kein Backend-, kein Go-Code.

**Primary Dependencies**: Tailwind 3.4 (Breakpoint `md` = 768px, Variante `max-md:`), Kobalte (Dialog, Progress), `class-variance-authority`. Keine neuen Pakete.

**Storage**: N/A. Kein persistenter UI-Zustand, kein `localStorage`.

**Testing**: Vitest + `@solidjs/testing-library` (jsdom) für Struktur, Reihenfolge, Klassen und Zustände. Playwright (`tests/e2e`, Projekte 360px/Desktop, hell/dunkel, mit `@axe-core/playwright`) für Geometrie: Touch-Größen, Position der Haupt-CTA, kein horizontales Scrollen. jsdom kann kein Layout messen, deshalb liegen Größen- und Positionsprüfungen im E2E.

**Target Platform**: Moderne Browser, Desktop und Smartphone (ab 320px Breite), helles und dunkles Schema (`prefers-color-scheme`).

**Project Type**: Web-Anwendung (`backend/`, `frontend/`), hier nur `frontend/` plus Doku.

**Performance Goals**: Keine Verschlechterung. Der Wechsel zwischen Desktop- und Mobilform der CTA geschieht per CSS ohne JavaScript und ohne Neuladen.

**Constraints**: Routen, API-Aufrufe, Texte der Aktionen und Funktionen bleiben unverändert (FR-013). Kompakte Desktop-Darstellung bleibt erhalten (Touch-Größe nur unter 768px). Danger-Token (`--destructive`) bleibt die einzige Quelle für Rot.

**Scale/Scope**: 9 Seiten, 4 Wizards, 5 gemeinsame UI-Komponenten, 5 neue Komponenten, 1 neue Route-Ebene.

## Constitution Check

*GATE: Muss vor Phase 0 bestehen, nach Phase 1 erneut prüfen.*

| Prinzip | Bewertung |
|---|---|
| I. Explicit Commit Authorization | Es wird nicht automatisch committet. |
| II. Twelve-Factor | Berührt nur Frontend-Darstellung. Keine Konfiguration, Logs, Prozesse oder Migrationen betroffen. Keine Verschlechterung der Punkte in `docs/12-factor-backlog.md`. |
| III.1 Zugänglich / Wizard | Bestehende Wizards bleiben die Einrichtungsabläufe. Es kommt kein neues Einzelformular hinzu. |
| III.1 Mobile-First | Siehe Touch-Größe, FAB und Wizard-Prüfung ab 320px (FR-007, FR-011, FR-012). |
| III.1 Aktionen isolieren | `CardActions` trennt sicher und destruktiv strukturell (FR-008 bis FR-010). |
| III.2 Navigation | Top-Bar, Breadcrumbs, Tabs statt Titel (FR-001 bis FR-005). Notifications als vierter Eintrag widerspricht dem Beispielsatz des Prinzips nicht. |
| III.3 Platzierung | `PrimaryAction` oben rechts bzw. FAB unter 768px (FR-006, FR-007). |
| III.4 Touch und Abstand | Zentrale 44px-Regel in den gemeinsamen Komponenten, `gap-3` (12px) als Mindestabstand (FR-010, FR-011). |

Ergebnis: bestanden, keine Abweichung, kein Eintrag unter Complexity Tracking. Nach Phase 1 unverändert bestanden.

## Project Structure

### Documentation (this feature)

```text
specs/011-ui-ux-alignment/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── ui-components.md
├── checklists/
│   └── requirements.md
└── tasks.md             # /speckit-tasks, nicht Teil von /speckit-plan
```

### Source Code (repository root)

```text
frontend/
├── src/
│   ├── app.css                              # geändert: Utility .touch-target, Safe-Area für FAB
│   ├── App.tsx                              # geändert: verschachtelte Route /ip-clients/:ipClientId (DeviceLayout)
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppShell.tsx                 # geändert: 4 Nav-Links, UserBadge + Abmelden rechts, mobiler Umbruch
│   │   │   ├── DeviceLayout.tsx             # neu: Tab-Leiste + <Outlet/> für Actions/History/Settings
│   │   │   ├── PageHeader.tsx               # neu: sr-only <h1>, Slot für PrimaryAction
│   │   │   ├── PrimaryAction.tsx            # neu: Button oben rechts, unter md als FAB
│   │   │   ├── UserBadge.tsx                # neu: neutraler Kreis (Symbol), Link zu /account
│   │   │   ├── Breadcrumbs.tsx              # geändert: Touch-Größe der Links
│   │   │   └── EmptyState.tsx               # geändert: doppelte CTA vermeiden
│   │   └── ui/
│   │       ├── button.tsx                   # geändert: max-md Mindestgrößen je Größe
│   │       ├── card-actions.tsx             # neu: CardActions mit slots safe/danger
│   │       ├── breadcrumb.tsx, dialog.tsx,
│   │       │   text-field.tsx, select.tsx,
│   │       │   checkbox.tsx                 # geändert: Touch-Größe, Dialog-Schließen-Button
│   │       └── nav-tabs.tsx                 # neu: Link-basierte Tab-Leiste mit aria-current
│   ├── flows/wizard/WizardShell.tsx         # geändert: gap-3, Touch-Größe, Mobil-Layout der Fußzeile
│   ├── lib/
│   │   ├── breadcrumbs.ts                   # geändert: Gerätebereiche zeigen "Devices / Gerät"
│   └── pages/                               # geändert: h1 → PageHeader, CTA → PrimaryAction,
│       Actions, Credentials, DeviceHistory,    # Aktionsgruppen → CardActions
│       DeviceSettings, ExecutionHistory,
│       IpClients, NotificationSettings,
│       TraefikProviders, Account
└── tests/
    ├── unit/
    │   ├── app-shell.test.tsx               # neu
    │   ├── device-layout.test.tsx           # neu
    │   ├── card-actions.test.tsx            # neu
    │   ├── primary-action.test.tsx          # neu
    │   └── breadcrumbs.test.tsx             # geändert
    └── e2e/
        ├── touch-targets.spec.ts            # neu: alle interaktiven Elemente >= 44x44px (mobil)
        ├── primary-action.spec.ts           # neu: Position Desktop, FAB unter 768px
        └── responsive.spec.ts               # geändert: Projekt 320px, mehr Routen

docs/development.md                          # geändert: kurzer Abschnitt "UI-Konventionen" mit Verweis auf Constitution III
docs/backlog.md                              # neu: Produkt-Backlog, erster Eintrag Account-Details/Initialen/Avatar
```

**Structure Decision**: Bestehende Web-Anwendung mit `frontend/`. Gemeinsame Bausteine liegen neben den vorhandenen Layout- und UI-Komponenten (`components/layout`, `components/ui`). Die Regeln werden in diesen Bausteinen kodiert, die Seiten verwenden sie nur. So bleibt eine künftige Abweichung auf einer einzelnen Seite sichtbar.

## Complexity Tracking

Keine Abweichungen von der Constitution.
