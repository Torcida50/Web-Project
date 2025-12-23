from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
import csv
from functools import lru_cache
from typing import List, Optional, Dict, Any

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
origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
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


def to_int(value, default=0) -> int:
    try:
        if value is None or value == "":
            return default
        return int(float(value))
    except Exception:
        return default


# -------------------------
# CSV Cache (Performance) - OHNE Preprocessing
# -------------------------
_cached_rows: Optional[List[Dict[str, Any]]] = None
_cached_mtime: Optional[float] = None


def invalidate_all_caches():
    """Wenn CSV neu geladen wird: alle abgeleiteten LRU-Caches leeren."""
    cached_standorte.cache_clear()
    cached_timeseries.cache_clear()
    cached_lastN_all.cache_clear()


def get_rows_cached() -> List[Dict[str, Any]]:
    """Laedt CSV nur neu, wenn sie sich geaendert hat (mtime). OHNE teures Preprocessing."""
    global _cached_rows, _cached_mtime

    if not GESAMT_PATH.exists():
        _cached_rows = []
        _cached_mtime = None
        invalidate_all_caches()
        return []

    mtime = GESAMT_PATH.stat().st_mtime
    if _cached_rows is None or _cached_mtime != mtime:
        rows: List[Dict[str, Any]] = []
        with GESAMT_PATH.open(encoding="utf-8", newline="") as f:
            reader = csv.DictReader(f)
            for row in reader:
                rows.append(row)

        _cached_rows = rows
        _cached_mtime = mtime
        invalidate_all_caches()

    return _cached_rows


# Backward-compatible Wrapper
def load_gesamtdaten():
    return get_rows_cached()


# -------------------------
# Standorte (gecached)
# -------------------------
@lru_cache(maxsize=8)
def cached_standorte(file_mtime: float):
    rows = get_rows_cached()
    standorte = set()
    for r in rows:
        name = (r.get("location_name") or "").strip()
        if name:
            standorte.add(name)
    return sorted(standorte)


# -------------------------
# Letzte N Tage (ALLE Standorte) (gecached)
# Cache-Key: (file_mtime, days)
#
# FIX: nicht mehr 2x ueber alle DictRows iterieren + pd.to_datetime pro Zeile,
#      sondern CSV einmal in DataFrame lesen und vektorisiert aggregieren. -> viel schneller.
# -------------------------
@lru_cache(maxsize=64)
def cached_lastN_all(file_mtime: float, days: int):
    if not GESAMT_PATH.exists():
        return {"rows": []}

    # CSV einmal laden (nur benoetigte Spalten)
    df = pd.read_csv(
        GESAMT_PATH,
        usecols=[
            "timestamp",
            "adult_ltr_pedestrians_count",
            "adult_rtl_pedestrians_count",
        ],
    )

    if df.empty or "timestamp" not in df.columns:
        return {"rows": []}

    # Timestamp einmal parsen (fehlerhafte -> NaT)
    ts = pd.to_datetime(df["timestamp"], utc=True, errors="coerce")
    df = df[ts.notna()].copy()
    df["date"] = ts[ts.notna()].dt.date

    if df.empty:
        return {"rows": []}

    last_date = df["date"].max()
    start_date = (pd.Timestamp(last_date) - pd.Timedelta(days=days - 1)).date()

    df = df[(df["date"] >= start_date) & (df["date"] <= last_date)]

    # Counts robust in int umwandeln
    df["adult_ltr_pedestrians_count"] = pd.to_numeric(
        df["adult_ltr_pedestrians_count"], errors="coerce"
    ).fillna(0).astype(int)

    df["adult_rtl_pedestrians_count"] = pd.to_numeric(
        df["adult_rtl_pedestrians_count"], errors="coerce"
    ).fillna(0).astype(int)

    agg = (
        df.groupby("date", as_index=False)[
            ["adult_ltr_pedestrians_count", "adult_rtl_pedestrians_count"]
        ]
        .sum()
        .sort_values("date")
    )

    out_rows = []
    for _, r in agg.iterrows():
        ltr = int(r["adult_ltr_pedestrians_count"])
        rtl = int(r["adult_rtl_pedestrians_count"])
        out_rows.append(
            {
                "date": str(r["date"]),
                "adult_ltr": ltr,
                "adult_rtl": rtl,
                "delta": rtl - ltr,
            }
        )

    return {"rows": out_rows}


# -------------------------
# Timeseries Cache (pro Standort)
# -------------------------
@lru_cache(maxsize=256)
def cached_timeseries(file_mtime: float, standort: str):
    rows = get_rows_cached()
    standort = (standort or "").strip()

    result = []
    for r in rows:
        if (r.get("location_name") or "").strip() != standort:
            continue

        result.append(
            {
                "timestamp": r.get("timestamp"),
                "total": to_int(r.get("pedestrians_count")),
                "ltr": to_int(r.get("ltr_pedestrians_count")),
                "rtl": to_int(r.get("rtl_pedestrians_count")),
                "adult": to_int(r.get("adult_pedestrians_count")),
                "child": to_int(r.get("child_pedestrians_count")),
                "zone1": to_int(r.get("zone_1_pedestrians_count")),
                "zone2": to_int(r.get("zone_2_pedestrians_count")),
                "zone3": to_int(r.get("zone_3_pedestrians_count")),
            }
        )

    result.sort(key=lambda x: x["timestamp"] or "")
    return result


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
# Daten-Endpunkte (CSV)  (Pagination!)
# -------------------------
@app.get("/daten")
def daten_gesamt(
    limit: int = Query(500, ge=1, le=5000),
    offset: int = Query(0, ge=0),
):
    rows = get_rows_cached()
    return {
        "total": len(rows),
        "limit": limit,
        "offset": offset,
        "rows": rows[offset: offset + limit],
    }


@app.get("/daten/preview")
def daten_gesamt_preview():
    rows = get_rows_cached()
    return rows[:10]


@app.get("/debug/columns")
def debug_columns():
    """Zeigt die Spaltennamen der CSV."""
    if not GESAMT_PATH.exists():
        return {"error": f"CSV nicht gefunden: {GESAMT_PATH}"}

    with GESAMT_PATH.open("r", encoding="utf-8", newline="") as f:
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
    data = get_rows_cached()

    links = 0
    rechts = 0

    for row in data:
        if row.get("altersgruppe") == "Erwachsene":
            if row.get("richtung") == "links":
                links += 1
            elif row.get("richtung") == "rechts":
                rechts += 1

    return {"links": links, "rechts": rechts}


@app.get("/analysis/standorte", response_model=List[str])
def list_standorte():
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

    rows = get_rows_cached()
    standort = (standort or "").strip()

    sum_ltr = 0
    sum_rtl = 0

    for r in rows:
        if (r.get("location_name") or "").strip() == standort:
            sum_ltr += to_int(r.get("adult_ltr_pedestrians_count"))
            sum_rtl += to_int(r.get("adult_rtl_pedestrians_count"))

    return {
        "standort": standort,
        "adult_ltr": sum_ltr,
        "adult_rtl": sum_rtl,
        "more_to_right": sum_rtl > sum_ltr,
    }


@app.get("/analysis/erwachsene_last7_all")
def erwachsene_last7_all(days: int = Query(7, ge=1, le=60)):
    if not GESAMT_PATH.exists():
        return {"rows": [], "error": f"CSV nicht gefunden: {GESAMT_PATH}"}
    mtime = GESAMT_PATH.stat().st_mtime
    return cached_lastN_all(mtime, days)


@app.get("/analysis/erwachsene_last7_all/refresh")
def refresh_erwachsene_last7_all():
    cached_lastN_all.cache_clear()
    return {"status": "cache cleared"}


# -------------------------
# Timeseries-Endpunkt (gecached pro Standort)
# -------------------------
@app.get("/timeseries/{standort}")
def timeseries_standort(standort: str):
    if not GESAMT_PATH.exists():
        return []
    mtime = GESAMT_PATH.stat().st_mtime
    return cached_timeseries(mtime, standort)


@app.get("/timeseries/refresh")
def refresh_timeseries_cache():
    cached_timeseries.cache_clear()
    return {"status": "cache cleared"}


# -------------------------
# Optional: Start per "python main.py"
# -------------------------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
