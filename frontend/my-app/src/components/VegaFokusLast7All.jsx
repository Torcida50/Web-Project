import { useEffect, useMemo, useRef, useState } from "react";
import vegaEmbed from "vega-embed";

const API_BASE = "/api";

const ENDPOINT = "/analysis/erwachsene_last7_all";

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

export default function VegaFokusLast7All() {
  const chartRef = useRef(null);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Daten laden (mit Timeout + begrenztem Retry)
  useEffect(() => {
    let cancelled = false;
    let retryTimer = null;

    const MAX_RETRIES = 10;
    const RETRY_MS = 2000;
    const TIMEOUT_MS = 300000;
    let attempts = 0;

    async function loadOnce() {
      attempts += 1;
      setLoading(true);
      setError(null);

      const url = `${API_BASE}${ENDPOINT}`;
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), TIMEOUT_MS);

      try {
        const res = await fetch(url, {
          signal: controller.signal,
          cache: "no-store",
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status} bei ${url}`);
        }

        const data = await res.json();
        const rawRows = Array.isArray(data?.rows) ? data.rows : [];

        // normalisieren, damit Vega nie Infinity/NaN bekommt
        const nextRows = rawRows
          .map((r) => ({
            date: r?.date ? String(r.date) : null,
            adult_ltr: toNum(r?.adult_ltr),
            adult_rtl: toNum(r?.adult_rtl),
            delta: toNum(r?.delta),
          }))
          .filter((r) => r.date); // date muss vorhanden sein

        if (cancelled) return;

        setRows(nextRows);
        setLoading(false);

        if (nextRows.length === 0 && attempts < MAX_RETRIES) {
          retryTimer = setTimeout(loadOnce, RETRY_MS);
        }

        if (nextRows.length === 0 && attempts >= MAX_RETRIES) {
          setError(
            `Keine Daten erhalten oder Daten ungueltig (rows leer). Prüfe: ${url}`
          );
        }
      } catch (e) {
        if (cancelled) return;

        const msg =
          e?.name === "AbortError"
            ? `Timeout nach ${TIMEOUT_MS}ms bei ${url}`
            : e?.message || `Fehler beim Laden (${url})`;

        setError(msg);
        setRows([]);
        setLoading(false);

        if (attempts < MAX_RETRIES) {
          retryTimer = setTimeout(loadOnce, RETRY_MS);
        } else {
          setError(`${msg} (abgebrochen nach ${MAX_RETRIES} Versuchen)`);
        }
      } finally {
        clearTimeout(t);
      }
    }

    loadOnce();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, []);

  // Vega-Lite Spec (statisch)
  const spec = useMemo(() => {
    return {
      $schema: "https://vega.github.io/schema/vega-lite/v5.json",
      width: 720,
      height: 260,
      background: "transparent",
      data: { values: rows },
      layer: [
        { mark: { type: "rule" }, encoding: { y: { datum: 0 } } },
        {
          mark: { type: "bar", size: 16 },
          encoding: {
            x: {
              field: "date",
              type: "temporal",
              title: "Datum",
              axis: { labelAngle: 0 },
            },
            y: {
              field: "delta",
              type: "quantitative",
              title: "Delta (Erwachsene rechts - links)",
              stack: null,
            },
            tooltip: [
              { field: "date", type: "temporal", title: "Datum" },
              {
                field: "adult_ltr",
                type: "quantitative",
                title: "Erwachsene links",
              },
              {
                field: "adult_rtl",
                type: "quantitative",
                title: "Erwachsene rechts",
              },
              { field: "delta", type: "quantitative", title: "Delta" },
            ],
          },
        },
      ],
      config: {
        background: "transparent",
        view: { stroke: "transparent" },
      },
    };
  }, [rows]);

  // Render Chart (nur wenn rows vorhanden)
  useEffect(() => {
    if (!chartRef.current) return;

    // Container leeren (verhindert mehrere SVGs übereinander)
    chartRef.current.innerHTML = "";

    if (!rows || rows.length === 0) return;

    vegaEmbed(chartRef.current, spec, {
      actions: false,
      renderer: "svg",
    }).catch((e) => {
      console.error(e);
      setError("Vega konnte nicht gerendert werden");
    });
  }, [spec, rows]);

  return (
    <div style={{ marginTop: "16px" }}>
      {loading && <p>Daten werden geladen...</p>}
      {error && <p style={{ color: "red" }}>{error}</p>}

      {!loading && !error && rows.length === 0 && (
        <p style={{ color: "red" }}>
          Keine Daten vom Backend erhalten (rows ist leer/ungueltig). Prüfe:{" "}
          {API_BASE}
          {ENDPOINT}
        </p>
      )}

      <div ref={chartRef} style={{ marginTop: "8px", minHeight: "280px" }} />
    </div>
  );
}
