# UI-Komponentenverträge

Interne Verträge der neuen und geänderten Bausteine. Kein Netzwerk- oder Agent-Vertrag ändert sich.

## PageHeader

`<PageHeader title="Credentials">{primary action}</PageHeader>`

- Rendert eine `<h1 class="sr-only">` mit `title`. Keine sichtbare Überschrift.
- Der Kind-Slot nimmt höchstens eine `PrimaryAction` auf. Ohne Kind rendert die Komponente keine sichtbare Zeile.
- Sichtbare Zeile: `flex justify-end`.

## PrimaryAction

`<PrimaryAction onClick={...}>Add credential</PrimaryAction>` (auch als Link über `as="a"`)

- Genau ein `Button`, ein DOM-Element.
- Ab 768px: Teil der Header-Zeile, rechtsbündig.
- Unter 768px: `position: fixed`, unten rechts, mindestens 56px hoch, Abstand `max(1rem, env(safe-area-inset-bottom))`, über dem Seiteninhalt, unter Dialogen.
- Sorgt dafür, dass `<main>` unten ausreichend Innenabstand hat, damit der letzte Inhalt nicht verdeckt wird.
- Pro Seite höchstens eine Instanz.

## CardActions

`<CardActions safe={<>…</>} danger={<>…</>} />`

- `safe` (links) und `danger` (rechts, `ml-auto`) sind getrennte Container.
- Abstand zwischen Buttons und zwischen den Zeilen bei Umbruch: `gap-3` (12px).
- Danger-Buttons verwenden `variant="destructive"`; `destructive`-Buttons außerhalb von `danger` sind nicht zulässig (Test).
- Beide Slots sind optional; fehlt einer, bleibt der andere an seiner Seite.

## NavTabs / DeviceLayout

`<NavTabs items={[{ href, label }]} />`, `<DeviceLayout>` mit Routen `actions`, `history`, `settings`

- `<nav aria-label="…">` mit Links. Aktiver Eintrag: `aria-current="page"` und sichtbarer Stil (Unterstrich plus Farbe, nicht Farbe allein).
- Horizontal scrollbar, jeder Eintrag mit Touch-Größe.
- `DeviceLayout` rendert die Leiste unter den Breadcrumbs und darunter den Seiteninhalt. URLs bleiben `/ip-clients/:ipClientId/{actions,history,settings}`.

## UserBadge

`<UserBadge />`

- Link `/account` mit `aria-label="Account"` und `aria-current="page"` auf der Account-Seite.
- Kreis, mindestens 44x44px mobil (40px Desktop), zeigt ein neutrales Personen-Symbol (Inhalt später austauschbar, Position, Größe und Ziel bleiben).
- Sitzt links neben dem unveränderten Abmelden-Button.

## Button (geändert)

- Alle Größen: `max-md:min-h-11`. Größe `icon`: zusätzlich `max-md:min-w-11`. Desktop-Maße unverändert.
- Varianten und Props bleiben abwärtskompatibel.

## Top-Navigation (AppShell, geändert)

- Links: Devices, Credentials, Agents, Notifications. Aktiver Eintrag hervorgehoben.
- Rechts: `UserBadge`, dann der Abmelden-Button.
- Unter 768px: Logo und rechte Gruppe in der ersten Zeile, Links in der zweiten Zeile, horizontal scrollbar. Name und Version neben dem Logo entfallen unter 640px.
