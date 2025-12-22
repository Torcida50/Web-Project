import { useEffect, useMemo, useRef, useState } from "react";
import vegaEmbed from "vega-embed";

const API_BASE = "http://127.0.0.1:8000";

/**
 * Verfuegbare Visualisierungstypen
 * key   -> interner Wert
 * label -> Anzeige im Dropdown
 * fields-> welche Felder aus dem Backend visualisiert werden
 */
const VISUALISIERUNGEN = [
  { key: "direction", label: "Links / Rechts", fields: ["ltr", "rtl"] },
  { key: "age", label: "Erwachsene / Kinder", fields: ["adult", "child"] },
  { key: "total", label: "Total Fussgaenger", fields: ["total"] },
  { key: "zones", label: "Zonen 1-3", fields: ["zone1", "zone2", "zone3"] },
];

export default function VegaTimeseries({ standort }) {
  const [rows, setRows] = useState([]);
  const [visKey, setVisKey] = useState("direction");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Umschalten zwischen Linie und Balken
  const [chartMode, setChartMode] = useState("line"); // "line" | "bar"

  const chartRef = useRef(null);

  /* ===============================
     Daten vom Backend laden
     =============================== */
  useEffect(() => {
    if (!standort) return;

    let cancelled = false;

    setLoading(true);
    setError(null);
    setRows([]);

    const url = `${API_BASE}/api/timeseries/${encodeURIComponent(standort)}`;

    // Timeout, damit "Failed to fetch" nicht ewig haengt
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 8000);

    fetch(url, { signal: controller.signal, cache: "no-store" })
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} bei ${url}`);
        }
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setRows(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;

        const msg =
          err?.name === "AbortError"
            ? `Timeout nach 8000ms bei ${url}`
            : err?.message || `Fehler beim Laden (${url})`;

        setError(msg);
        setLoading(false);
      })
      .finally(() => clearTimeout(t));

    return () => {
      cancelled = true;
      clearTimeout(t);
      controller.abort();
    };
  }, [standort]);

  /* ===============================
     Ausgewaehlte Visualisierung
     =============================== */
  const selectedVis = useMemo(
    () => VISUALISIERUNGEN.find((v) => v.key === visKey) ?? VISUALISIERUNGEN[0],
    [visKey]
  );

  /* ===============================
     Vega-Lite Spec erzeugen

     Balkenmodus:
     - keine Addition (stack: null)
     - kleiner Wert soll oben sichtbar sein
       -> grosser wird zuerst gezeichnet, kleiner danach (order: value desc)
     =============================== */
  const spec = useMemo(() => {
    const fields = selectedVis.fields;
    const multipleSeries = fields.length > 1;
    const useBars = chartMode === "bar";

    return {
      $schema: "https://vega.github.io/schema/vega-lite/v5.json",
      width: 720,
      height: 320,
      background: "transparent",
      data: { values: rows },

      params: [
        {
          name: "zoom",
          select: { type: "interval", encodings: ["x"] },
          bind: "scales",
        },
      ],

      transform: multipleSeries
        ? [
            { fold: fields, as: ["serie", "value"] },
            {
              calculate:
                "datum.serie === 'ltr' ? 'Nach links' :" +
                "datum.serie === 'rtl' ? 'Nach rechts' :" +
                "datum.serie === 'adult' ? 'Erwachsene' :" +
                "datum.serie === 'child' ? 'Kinder' :" +
                "datum.serie === 'zone1' ? 'Zone 1' :" +
                "datum.serie === 'zone2' ? 'Zone 2' :" +
                "datum.serie === 'zone3' ? 'Zone 3' :" +
                "datum.serie === 'total' ? 'Total' : datum.serie",
              as: "serie_label",
            },
          ]
        : [],

      mark: useBars
        ? { type: "bar", stroke: null, size: 10, opacity: 1 }
        : { type: "line", interpolate: "monotone", strokeWidth: 1.6 },

      encoding: {
        x: {
          field: "timestamp",
          type: "temporal",
          title: "Zeit",
          axis: { labelOverlap: true },
        },

        y: {
          field: multipleSeries ? "value" : fields[0],
          type: "quantitative",
          title: "Anzahl Fussgaenger",
          axis: { format: ",.0f" },
          stack: null,
        },

        ...(multipleSeries
          ? {
              color: {
                field: "serie_label",
                type: "nominal",
                title: "Kategorie",
              },
              order: useBars
                ? { field: "value", type: "quantitative", sort: "descending" }
                : undefined,
              tooltip: [
                { field: "timestamp", type: "temporal", title: "Zeit" },
                { field: "serie_label", type: "nominal", title: "Kategorie" },
                {
                  field: "value",
                  type: "quantitative",
                  title: "Anzahl",
                  format: ",.0f",
                },
              ],
            }
          : {
              tooltip: [
                { field: "timestamp", type: "temporal", title: "Zeit" },
                {
                  field: fields[0],
                  type: "quantitative",
                  title: "Anzahl",
                  format: ",.0f",
                },
              ],
            }),
      },

      config: {
        background: "transparent",
        view: { stroke: "transparent" },
        line: { strokeWidth: 1.6 },
        bar: { stroke: null, strokeWidth: 0 },
      },
    };
  }, [rows, selectedVis, chartMode]);

  /* ===============================
     Chart rendern
     =============================== */
  useEffect(() => {
    if (!chartRef.current) return;
    vegaEmbed(chartRef.current, spec, { actions: true }).catch(console.error);
  }, [spec]);

  /* ===============================
     JSX
     =============================== */
  return (
    <div style={{ marginTop: "24px" }}>
      <h3>Interaktive Zeitreihe</h3>

      <div
        style={{
          display: "flex",
          gap: "16px",
          alignItems: "flex-start",
          flexWrap: "wrap",
        }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <div>
            Visualisierung:&nbsp;
            <select value={visKey} onChange={(e) => setVisKey(e.target.value)}>
              {VISUALISIERUNGEN.map((v) => (
                <option key={v.key} value={v.key}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>

          <div style={{ opacity: 0.85, fontWeight: 600 }}>
            Hinweis: Bitte hineinzoomen, damit die Vergleiche sichtbar werden.
          </div>
        </label>
      </div>

      <div style={{ marginTop: "10px" }}>
        <button
          type="button"
          onClick={() => setChartMode((m) => (m === "line" ? "bar" : "line"))}
          title="Diagrammtyp wechseln"
          style={{
            padding: "7px 12px",
            borderRadius: "8px",
            cursor: "pointer",
          }}
        >
          {chartMode === "line"
            ? "Zu Balkendiagramm wechseln"
            : "Zu Liniendiagramm wechseln"}
        </button>
      </div>

      <div
        style={{
          marginTop: "10px",
          display: "flex",
          gap: "12px",
          alignItems: "center",
          flexWrap: "wrap",
          opacity: 0.8,
        }}
      >
        <span>
          Tipp: Mausrad = Zoomen, Ziehen = Verschieben, Doppelklick =
          Zurücksetzen
        </span>

        {loading && <span>Daten werden geladen...</span>}
        {error && <span style={{ color: "red", opacity: 1 }}>{error}</span>}
        {!loading && !error && rows.length > 0 && (
          <span>Messpunkte: {rows.length}</span>
        )}
      </div>

      <div ref={chartRef} style={{ marginTop: "12px" }} />
    </div>
  );
}
