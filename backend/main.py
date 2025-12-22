from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
import csv
from functools import lru_cache
from typing import List

# pandas wird gebraucht (to_datetime). Wenn es fehlt, lieber klar crashen mit Message.
try:
    import pandas as pd
except ModuleNotFoundError as e:
    raise ModuleNotFoundError(
        "pandas fehlt. Installiere es mit: pip install pandas"
    ) from e

app = FastAPI(
    title="Bahnhofstrasse API",
    description="API fuer den Gesamtdatensatz (CSV)",
)

# CORS: Frontend darf zugreifen (localhost UND 127.0.0.1)
# (5173 ist Vite Standard, 3000 ist optional)
origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Dateipfad fuer den Gesamtdatensatz (CSV)
DATA_DIR = Path(__file__).parent / "data"
GESAMT_PATH = DATA_DIR / "Gesamtdatensatz.csv"


def load_gesamtdaten():
    """Laedt den gesamten Datensatz aus der CSV-Datei und gibt ihn als Liste von Dicts zurueck."""
    if not GESAMT_PATH.exists():
        return []

    rows = []
    with GESAMT_PATH.open(encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(row)
    return rows


# Hilfsfunktion: Wert in Integer umwandeln (mit Default)
def to_int(value, default=0):
    try:
        if value is None or value == "":
            return default
        return int(float(value))
    except Exception:
        return default


# -------------------------
# Basis-Endpunkte
# -------------------------

@app.get("/")
def root():
    return {"message": "Bahnhofstrasse Backend (Gesamtdatensatz) laeuft."}


@app.get("/health")
def health():
    return {"status": "ok"}


# -------------------------
# Daten-Endpunkte (CSV)
# -------------------------

@app.get("/daten")
def daten_gesamt():
    """Gibt den gesamten Datensatz zurueck."""
    return load_gesamtdaten()


@app.get("/daten/preview")
def daten_gesamt_preview():
    """Gibt nur die ersten 10 Zeilen zurueck (Preview)."""
    data = load_gesamtdaten()
    return data[:10]


@app.get("/debug/columns")
def debug_columns():
    """Zeigt die Spaltennamen der CSV."""
    if not GESAMT_PATH.exists():
        return {"error": f"CSV nicht gefunden: {GESAMT_PATH}"}

    with GESAMT_PATH.open("r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        return {"columns": reader.fieldnames}


# -------------------------
# Analysis-Endpunkte
# -------------------------

@app.get("/analysis/erwachsene")
def analyse_erwachsene():
    """
    Beispiel-Analyse (nur falls eure CSV wirklich 'altersgruppe'/'richtung' hat).
    Achtung: Das ist bei euch evtl. nicht mehr relevant.
    """
    data = load_gesamtdaten()

    links = 0
    rechts = 0

    for row in data:
        if row.get("altersgruppe") == "Erwachsene":
            if row.get("richtung") == "links":
                links += 1
            elif row.get("richtung") == "rechts":
                rechts += 1

    return {"links": links, "rechts": rechts}


# -------------------------
# Standorte (gecached)
# Cache wird automatisch invalidiert, wenn sich die CSV aendert
# -------------------------

@lru_cache(maxsize=8)
def cached_standorte(file_mtime: float):
    # file_mtime ist nur da, um den Cache bei Datei-Aenderung zu invalidieren
    if not GESAMT_PATH.exists():
        return []

    standorte = set()
    with GESAMT_PATH.open("r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            name = (row.get("location_name") or "").strip()
            if name:
                standorte.add(name)

    return sorted(standorte)


# ✅ HIER ist die wichtige Aenderung:
@app.get("/analysis/standorte", response_model=List[str])
def list_standorte():
    """Gibt alle eindeutigen location_name zurueck (gecached)."""
    if not GESAMT_PATH.exists():
        return []
    mtime = GESAMT_PATH.stat().st_mtime
    return cached_standorte(mtime)


@app.get("/analysis/standorte/refresh")
def refresh_standorte():
    cached_standorte.cache_clear()
    return {"status": "cache cleared"}


@app.get("/analysis/erwachsene/{standort}")
def analyse_erwachsene_standort(standort: str):
    """Summiert adult_ltr/adult_rtl fuer einen Standort ueber den ganzen Datensatz."""
    if not GESAMT_PATH.exists():
        return {"error": f"CSV nicht gefunden: {GESAMT_PATH}"}

    sum_ltr = 0
    sum_rtl = 0

    with GESAMT_PATH.open("r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if (row.get("location_name") or "").strip() == standort:
                sum_ltr += to_int(row.get("adult_ltr_pedestrians_count"))
                sum_rtl += to_int(row.get("adult_rtl_pedestrians_count"))

    return {
        "standort": standort,
        "adult_ltr": sum_ltr,
        "adult_rtl": sum_rtl,
        "more_to_right": sum_rtl > sum_ltr,
    }


# -------------------------
# Letzte 7 Tage (ALLE Standorte)
# Cache wird automatisch invalidiert, wenn sich die CSV aendert
# -------------------------

def _compute_last7_all():
    """
    Letzte 7 Tage (basierend auf letztem Datum im Datensatz),
    aggregiert ueber alle Standorte: Erwachsene links/rechts + delta pro Tag.
    Optimiert: 2 CSV-Durchlaeufe, kein pandas DataFrame.
    """
    if not GESAMT_PATH.exists():
        return {"rows": [], "error": f"CSV nicht gefunden: {GESAMT_PATH}"}

    # 1) Letztes Datum finden
    last_date = None
    with GESAMT_PATH.open("r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            ts = row.get("timestamp")
            if not ts:
                continue
            try:
                d = pd.to_datetime(ts, utc=True).date()
            except Exception:
                continue

            if last_date is None or d > last_date:
                last_date = d

    if last_date is None:
        return {"rows": []}

    start_date = (pd.Timestamp(last_date) - pd.Timedelta(days=6)).date()

    # 2) Aggregieren (nur letzte 7 Tage)
    sums = {}  # date -> {"adult_ltr": x, "adult_rtl": y}

    with GESAMT_PATH.open("r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            ts = row.get("timestamp")
            if not ts:
                continue
            try:
                d = pd.to_datetime(ts, utc=True).date()
            except Exception:
                continue

            if d < start_date or d > last_date:
                continue

            if d not in sums:
                sums[d] = {"adult_ltr": 0, "adult_rtl": 0}

            sums[d]["adult_ltr"] += to_int(row.get("adult_ltr_pedestrians_count"))
            sums[d]["adult_rtl"] += to_int(row.get("adult_rtl_pedestrians_count"))

    out_rows = []
    for d in sorted(sums.keys()):
        adult_ltr = sums[d]["adult_ltr"]
        adult_rtl = sums[d]["adult_rtl"]
        out_rows.append(
            {
                "date": str(d),
                "adult_ltr": int(adult_ltr),
                "adult_rtl": int(adult_rtl),
                "delta": int(adult_rtl - adult_ltr),
            }
        )

    return {"rows": out_rows}


@lru_cache(maxsize=8)
def cached_last7_all(file_mtime: float):
    # file_mtime ist nur da, um den Cache bei Datei-Aenderung zu invalidieren
    return _compute_last7_all()


@app.get("/analysis/erwachsene_last7_all")
def analyse_erwachsene_last7_all():
    if not GESAMT_PATH.exists():
        return {"rows": [], "error": f"CSV nicht gefunden: {GESAMT_PATH}"}
    mtime = GESAMT_PATH.stat().st_mtime
    return cached_last7_all(mtime)


@app.get("/analysis/erwachsene_last7_all/refresh")
def refresh_erwachsene_last7_all():
    cached_last7_all.cache_clear()
    return {"status": "cache cleared"}


# -------------------------
# Timeseries-Endpunkt fuer VegaTimeseries
# -------------------------

@app.get("/api/timeseries/{standort}")
def timeseries_standort(standort: str):
    """
    Zeitreihe pro Standort:
    timestamp + verschiedene Zaehlungen (total, ltr, rtl, adult, child, zones...)
    """
    if not GESAMT_PATH.exists():
        return []

    result = []
    with GESAMT_PATH.open("r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if (row.get("location_name") or "").strip() != standort:
                continue

            result.append(
                {
                    "timestamp": row.get("timestamp"),
                    "total": to_int(row.get("pedestrians_count")),
                    "ltr": to_int(row.get("ltr_pedestrians_count")),
                    "rtl": to_int(row.get("rtl_pedestrians_count")),
                    "adult": to_int(row.get("adult_pedestrians_count")),
                    "child": to_int(row.get("child_pedestrians_count")),
                    "zone1": to_int(row.get("zone_1_pedestrians_count")),
                    "zone2": to_int(row.get("zone_2_pedestrians_count")),
                    "zone3": to_int(row.get("zone_3_pedestrians_count")),
                }
            )

    result.sort(key=lambda x: x["timestamp"] or "")
    return result


# -------------------------
# Optional: Start per "python main.py"
# -------------------------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="127.0.0.1", port=8000, reload=True)
