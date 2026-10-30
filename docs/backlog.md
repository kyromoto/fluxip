# Backlog

Funktionale Ideen und Folge-Features, die bewusst nicht Teil des aktuellen Features sind. Abweichungen von den Twelve-Factor-Regeln stehen separat in [12-factor-backlog.md](12-factor-backlog.md). Erledigte Einträge werden hier entfernt.

| Thema | Beschreibung | Herkunft |
|---|---|---|
| Account-Details, Initialen, Benutzer-Avatar | Das Frontend kennt heute weder Name noch E-Mail-Adresse: Die Anmeldung fordert nur `openid` und `offline_access` an, und `GET /account` liefert nur `accountId`. Für die Anzeige von Account-Details sowie von Initialen oder Avatar im Kreis der Top-Bar braucht es Name/E-Mail (Logto-Scope `profile`/`email` oder ein Backend-Endpunkt) und einen Plan, wie Avatar-Bilder gespeichert werden. Der Kreis in der Top-Bar ist bereits vorhanden (neutrales Symbol, Link zu Account) und wird dann nur gefüllt. | Spec [011-ui-ux-alignment](../specs/011-ui-ux-alignment/spec.md) |
