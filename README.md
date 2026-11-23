# Schafkopfrechner

Schafkopf mitzählen – als App fürs Handy (PWA). Vom Parkcafé Freising.

**App öffnen:** https://kleineruwe-dotcom.github.io/schafkopfrechner/

Android: Link in Chrome öffnen → Menü ⋮ → „App installieren“ / „Zum Startbildschirm hinzufügen“.
iPhone: Link in Safari öffnen → Teilen → „Zum Home-Bildschirm“.

Spielstände werden nur auf dem eigenen Gerät gespeichert (Sicherung über „Alles exportieren“).

Funktionen: Runden mit 3–8 Spielern, Sauspiel, Hochzeit, Farbsolo, Wenz, Geier, Farbwenz, Bettel,
Ramsch (Jungfrau, Durchmarsch), Tarif frei einstellbar, Schneider/Schwarz, Laufende, Tout/Sie,
Kontra/Re, Klopfen, Stock, Verlauf mit Korrigieren, Abrechnung „wer zahlt wem“, Statistik.

Entwicklung: `python3 build_pages.py` erzeugt `_site/`; Tests: `node --test tests/scoring.test.cjs`.
