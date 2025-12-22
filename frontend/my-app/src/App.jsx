import { useState, useEffect } from "react";
import VegaTimeseries from "./components/VegaTimeseries";
import VegaFokusLast7All from "./components/VegaFokusLast7All";
import "./App.css";

const API_BASE = "http://127.0.0.1:8000";

async function fetchJson(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} bei ${url}`);
    }
    return await res.json();
  } catch (e) {
    if (e?.name === "AbortError") {
      throw new Error(`Timeout nach ${timeoutMs}ms bei ${url}`);
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

export default function App() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [activatePage, setActivatePage] = useState("uebersicht");

  // Standorte + Auswahl + Analyse-Ergebnis
  const [standorte, setStandorte] = useState([]);
  const [selectedStandort, setSelectedStandort] = useState("");
  const [analyseResult, setAnalyseResult] = useState(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState(null);

  // Daten Preview
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchJson(`${API_BASE}/daten/preview`);
        if (cancelled) return;
        setRows(Array.isArray(data) ? data : []);
      } catch (e) {
        if (cancelled) return;
        console.error("Fehler beim Laden der Daten:", e);
        setError(e.message || "Fehler beim Laden");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Standorte laden
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setAnalysisError(null);
      try {
        const data = await fetchJson(`${API_BASE}/analysis/standorte`);
        if (cancelled) return;
        const list = Array.isArray(data) ? data : [];
        setStandorte(list);
        if (list.length > 0) setSelectedStandort(list[0]);
      } catch (e) {
        if (cancelled) return;
        console.error("Fehler beim Laden der Standorte:", e);
        setStandorte([]);
        setSelectedStandort("");
        setAnalysisError(e.message || "Standorte konnten nicht geladen werden");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Analyse fuer Standort laden
  useEffect(() => {
    if (!selectedStandort) return;

    let cancelled = false;

    (async () => {
      setAnalysisLoading(true);
      setAnalysisError(null);
      setAnalyseResult(null);

      const url = `${API_BASE}/analysis/erwachsene/${encodeURIComponent(
        selectedStandort
      )}`;

      try {
        const data = await fetchJson(url);
        if (cancelled) return;
        setAnalyseResult(data);
      } catch (e) {
        if (cancelled) return;
        setAnalysisError(e.message || "Analyse konnte nicht geladen werden");
      } finally {
        if (!cancelled) setAnalysisLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedStandort]);

  return (
    <div className="app">
      <aside className="sidebar">
        <img src="/logo-fhnw.png" className="sidebar-logo" />

        <h1 className="sidebar-title">Menü:</h1>
        <div className="sidebar-menu">
          <button
            className="sidebar-button"
            onClick={() => setActivatePage("uebersicht")}
          >
            Übersicht
          </button>
          <button
            className="sidebar-button"
            onClick={() => setActivatePage("daten")}
          >
            Daten
          </button>
          <button
            className="sidebar-button"
            onClick={() => setActivatePage("visualisierungen")}
          >
            Visualisierungen
          </button>
        </div>
      </aside>

      <div className="right-side">
        <header className="page-header">
          <h1>Bahnhofstrasse Projekt</h1>
        </header>

        <main className="main">
          {activatePage === "uebersicht" && (
            <>
              <h2>Projektübersicht</h2>
              <p>
                In diesem Projekt analysieren wir die Passantenfrequenzen
                entlang der Bahnhofstrasse in Zürich, einer der bekanntesten
                Einkaufs- und Verkehrsachsen der Schweiz. Die Stadt Zürich
                erfasst diese Daten seit 2021 mithilfe moderner Laserscanner,
                welche anonymisierte Informationen über die Anzahl der
                vorbeigehenden Personen, ihre Gehrichtung (nach links oder nach
                rechts) sowie ihre Zugehörigkeit zur Kategorie „Erwachsene“ oder
                „Kinder“ liefern. Zusätzlich werden Wetterdaten wie Temperatur
                und Niederschlag berücksichtigt, um mögliche Zusammenhänge
                zwischen Wetterbedingungen und Fussgängerbewegungen zu erkennen.
                Ziel unseres Projekts ist es, diese vielfältigen Daten
                systematisch aufzubereiten, visuell darzustellen und
                verständlich zu interpretieren. Dadurch sollen Muster, zeitliche
                Trends und räumliche Unterschiede sichtbar werden, die wichtige
                Einblicke in das Verhalten der Passanten entlang der
                Bahnhofstrasse ermöglichen.
              </p>

              <h3>Unsere Fokusfrage</h3>
              <p>
                Wann gibt es an einem ausgewählten Standort mehr erwachsene
                Fussgänger, die nach rechts gehen, als solche, die nach links
                gehen?
              </p>

              <h3>Statische Visualisierung zur Fokusfrage (letzte 7 Tage)</h3>
              <VegaFokusLast7All />

              <p style={{ marginTop: "10px", opacity: 0.9 }}>
                Dargestellt ist die Differenz (Delta) der erwachsenen Fussgänger
                der letzten sieben Tage im Datensatz:{" "}
                <strong>
                  Erwachsene nach rechts minus Erwachsene nach links
                </strong>
                . Werte über 0 bedeuten, dass an diesem Tag mehr Erwachsene nach
                rechts gingen; Werte unter 0 bedeuten entsprechend mehr nach
                links. Die Null-Linie dient als Referenz.
              </p>
            </>
          )}

          {activatePage === "daten" && (
            <>
              <h2>Daten</h2>
              <p>Zeige Preview der Daten:</p>

              {loading && <p>Daten werden geladen...</p>}

              {error && (
                <p style={{ color: "red" }}>
                  Fehler beim Laden der Daten: {error}
                </p>
              )}

              {!loading && !error && (
                <>
                  <p>Zeilen im Preview: {rows.length}</p>

                  {rows.length > 0 ? (
                    <table className="data-table">
                      <thead>
                        <tr>
                          {Object.keys(rows[0]).map((key) => (
                            <th key={key}>{key}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row, index) => (
                          <tr key={index}>
                            {Object.keys(rows[0]).map((key) => (
                              <td key={key}>{row[key]}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p>Keine Daten gefunden.</p>
                  )}
                </>
              )}
            </>
          )}

          {activatePage === "visualisierungen" && (
            <>
              <h2>Visualisierungen</h2>

              {standorte.length === 0 ? (
                <p style={{ color: "red" }}>
                  Keine Standorte geladen. Prüfe: {API_BASE}/analysis/standorte
                </p>
              ) : (
                <label>
                  Standort:{" "}
                  <select
                    value={selectedStandort}
                    onChange={(e) => setSelectedStandort(e.target.value)}
                  >
                    {standorte.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <div style={{ marginTop: "16px" }}>
                {analysisLoading && <p>Analyse wird geladen...</p>}

                {analysisError && (
                  <p style={{ color: "red" }}>
                    Fehler bei der Analyse: {analysisError}
                  </p>
                )}

                {!analysisLoading && !analysisError && analyseResult && (
                  <>
                    <h3>Ergebnis</h3>
                    <p>
                      Erwachsene nach links:{" "}
                      <strong>{analyseResult.adult_ltr}</strong>
                    </p>
                    <p>
                      Erwachsene nach rechts:{" "}
                      <strong>{analyseResult.adult_rtl}</strong>
                    </p>
                    <p>
                      Ergebnis:{" "}
                      <strong>
                        {analyseResult.more_to_right
                          ? "Mehr Erwachsene gehen nach rechts."
                          : "Mehr Erwachsene gehen nach links oder gleich viele."}
                      </strong>
                    </p>
                  </>
                )}
              </div>

              <h3>Zeitreihe</h3>
              <VegaTimeseries standort={selectedStandort} />
            </>
          )}
        </main>
      </div>
    </div>
  );
}
