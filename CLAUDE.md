# CLAUDE.md

Kontext für Claude Code zum Projekt **swissalpine** (`MicCalo/swissalpine`).
Status: Work in Progress (~60%).

## Zweck

Vorhersage-Tool für den **Swissalpine K78** (78.2 km, ~4500 hm, Flims, 18. Juli).
Liest die GPX-Strecke ein, segmentiert sie, und nimmt später Live-GPS-Positionen
entgegen, um den Fortschritt entlang der Strecke einem Streckensegment zuzuordnen
(ETA/Tracking-Grundlage). Ablösung/Weiterentwicklung des bisherigen
GitHub-Pages-`ist.txt`-Ansatzes — diesmal mit echtem Backend statt statischem Polling.

## Architektur

- **Backend:** Python, FastAPI (`server.py`), `slowapi` für Rate-Limiting,
  `uvicorn` als ASGI-Server.
- **Frontend:** Jinja2-Templates (`templates/`) + Vanilla JS/CSS (`static/`).
  Kein SPA-Framework.
- **Live-Updates:** SSE (Server-Sent Events) für GPS-Punkte — bereits implementiert.
  Backend liefert beim initialen Laden Route/Segmente/Altpunkte, danach pusht es neue
  Punkte über SSE. Frontend hängt sie an den In-Memory-Punkte-Array an (siehe
  "Live-Tracking-Akkumulation" unten).
- **Domänenmodell:** `data_model/` — `Coord`/`distance()` (Geo-Distanzberechnung),
  `Track` (lädt GPX, iterierbar über Segmente mit `.id` und `.coord`,
  Export via `points_as_csv()` / `segments_as_csv()`).
- **Daten:**
  - `t808746431_k78-78.2-km.gpx` — Original-Streckendaten (Quelle der Wahrheit für die Route).
  - `segments.csv` — abgeleitete/exportierte Segmentierung des Tracks.
  - `fit.txt` — Soll-Zeiten (Vorhersage-Basis, analog zur früheren Marschtabelle).
  - `ist.txt` — Ist-Daten (vermutlich Vorgänger/Vergleichsformat zum Live-Tracking).
  - `log.txt` — Append-only Log eingehender GPS-Punkte (`lat;lon;alt;ts;bat;mz`).
- **`old/`** — Vorgänger-/Altcode, nicht aktiv. Nicht als aktuelle Referenz nutzen.

## Kernlogik (server.py)

- Beim Start wird der `Track` einmalig aus der GPX-Datei geladen (Modul-Singleton,
  kein Reload zur Laufzeit).
- `GET /` — rendert `test.html.jinja` mit dem Track-Objekt im Context.
- `GET /track.points.csv` / `GET /track.segments.csv` — Streaming-CSV-Export
  des Tracks (Punkte bzw. Segmente).
- `GET /log?c=lat,lon,alt,ts,bat,mz` — GPS-Ingest-Endpunkt:
  - Rate-Limit: 30/Minute pro Client (`slowapi`).
  - Input wird auf druckbare ASCII-Zeichen bereinigt (`safe_c`) bevor geloggt wird.
  - Erwartet exakt 6 kommaseparierte Felder: `lat,lon,alt,ts,bat,mz`.
  - Validiert lat ∈ [-90,90], lon ∈ [-180,180]; `ts` ist Unix-Timestamp.
  - Nächstgelegenes Segment wird per linearer Suche (`find()`) über alle
    Segmente per `distance()` ermittelt — kein Spatial Index (bei 78 km
    Strecke aktuell unproblematisch, aber kein O(log n)).
  - Jeder valide Punkt wird an `log.txt` angehängt (`;`-separiert statt `,`).
- Hardcoded Host/Port im `__main__`-Block (`192.168.178.90:8016`) — vermutlich
  feste lokale IP für Empfang im Feld; beim Deployment/Testen ggf. anpassen.

## Live-Tracking-Akkumulation (Frontend/Backend-Split)

Design-Entscheidung: Backend bleibt dummer Akkumulator, alle Vorhersagelogik
(GAP-Modell, Fatigue, ETA) bleibt im Frontend (JS).

- **Backend:** speichert jeden eingehenden Punkt append-only (`log.txt`), keine
  eigene Prediction-Logik, kein Zustand über "wer schaut gerade zu". Liefert beim
  initialen Laden die volle Historie (Route, Segmente, bisherige Punkte), danach
  neue Punkte per SSE.
- **Frontend:** baut beim Laden/Reload den In-Memory-Punkte-Array aus der initialen
  Historie auf, läuft die Prediction einmal initial, hängt danach SSE-Punkte an und
  rechnet inkrementell neu. Das deckt späte Beitreter und Reloads ohne
  Sonderbehandlung ab — sie bekommen einfach dieselbe volle Historie wie alle.
- **Ordering/Dedupe:** Timestamp wird zur Sortierung und Duplikaterkennung verwendet
  (kein server-seitiger inkrementeller Cursor/ID nötig). Ein verpasster Punkt ist
  unkritisch (kein Hard-Requirement auf Vollständigkeit).
- Mehrere Läufer (separate Tracks) sind aktuell nicht vorgesehen — falls später
  relevant, müsste eine Runner-ID-Dimension in Storage/SSE nachgezogen werden.

## Start-Zeit-Handling

Anforderung: Renn-Offizielles Startzeitfenster ist 5:00 Uhr, geplant am 18. Juli.
Genauigkeit auf Minutenebene ist irrelevant — relevant ist nur eine grobe
Korrektur, falls der Start z.B. eine Stunde früher oder 15 Min. später als geplant
stattfindet (Ansage durch Veranstalter).

- **Default:** Hardcodierte geplante Startzeit (`2026-07-18T05:00:00+02:00`) wird
  im Frontend für alle Vorhersagen verwendet, solange keine Korrektur gesetzt wurde.
- **Override-Mechanismus:** Separate, unstyled Seite (`start_override.html`,
  bereits als Entwurf vorhanden, noch nicht ins Backend integriert) mit:
  - Eingabefeld für eine konkrete Zeit (z.B. bei vorab bekannter Verzögerung).
  - "Start Now"-Button (zum spontanen Setzen, falls am Start selbst korrigiert
    werden muss).
  - Beide nutzen denselben Endpunkt: `POST /start {start_time: <ISO 8601>}`.
- **Backend-seitig noch offen:** Endpunkt `/start` muss noch implementiert werden
  (Speichern/Überschreiben der aktiven Startzeit, Ausgabe davon beim initialen
  Laden bzw. via SSE, analog zu Route/Segmenten/Punkten). Kein Auth/Secret bisher
  vorgesehen — ggf. nachrüsten, falls die Seite öffentlich erreichbar ist.
- **Verworfene Alternative:** automatische Starterkennung über GPS-Crossing eines
  Referenzpunkts (z.B. 200 m nach Start) wurde diskutiert, aber wegen unsicherer
  Ping-Dichte direkt nach dem Start (Lücken durch Sendeintervall, Gedränge im
  Startbereich) zugunsten des manuellen Buttons verworfen. Könnte als Fallback
  ergänzt werden, ist aber nicht priorisiert.

## Konventionen / Stolperfallen

- **Kein State außer `log.txt` und dem In-Memory-`Track`.** Keine Datenbank.
- Das GPS-Logformat `lat,lon,alt,ts,bat,mz` stammt vermutlich aus GPSLogger
  (Android) — Feldreihenfolge ist fix, nicht selbst erweitern ohne Rücksprache
  mit dem Logger-Setup.
- `find()` ordnet einen Punkt dem nächsten Segment zu rein über Distanz —
  noch keine Berücksichtigung der Lauf-/Zeitrichtung auf der Strecke
  (kein "wo auf der Route bin ich fortschreitend" — nur "wo bin ich räumlich am nächsten").

## Verwandte Projekte (separat, nicht in diesem Repo)

- C#/WPF Pace-ETA-App mit GAP-Modell (`TerrainSegmenter`, Zwei-Polynom-Modell
  für Auf-/Abstieg, MathNet.Numerics).
- Vorgänger-Live-Tracking via GitHub Pages + `ist.txt`-Polling.

Bei Fragen zur Renn-/Fueling-/Trainingsstrategie: nicht Teil dieses Codes,
das ist reines Tracking/Vorhersage-Backend.
