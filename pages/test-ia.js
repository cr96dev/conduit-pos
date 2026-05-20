import { useState } from "react";

export default function TestIA() {
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const test = async () => {
    setLoading(true);
    setResult("");
    setError("");

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Dame un resumen ejecutivo de estos datos de ventas.",
          data: { ventas: 150, clientes: 30, mes: "abril", meta: 200 }
        })
      });

      const json = await res.json();

      if (!res.ok) {
        setError(json.analysis);
      } else {
        setResult(json.analysis);
      }
    } catch (err) {
      setError(`Error de conexión: ${err.message}`);
    }

    setLoading(false);
  };

  const renderMarkdown = (text) => {
    return text
      .replace(/##\s(.+)/g, "<h3 style='margin:12px 0 4px'>$1</h3>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\|(.+)\|/g, "<span style='display:block;padding:4px 0'>$1</span>")
      .replace(/\n/g, "<br/>");
  };

  return (
    <div style={{ padding: 24, fontFamily: "sans-serif", maxWidth: 600 }}>
      <h2>🤖 Prueba de IA</h2>

      <button
        onClick={test}
        disabled={loading}
        style={{
          padding: "12px 24px",
          backgroundColor: loading ? "#ccc" : "#0070f3",
          color: "white",
          border: "none",
          borderRadius: 8,
          fontSize: 16,
          cursor: loading ? "not-allowed" : "pointer"
        }}
      >
        {loading ? "Analizando..." : "Probar IA"}
      </button>

      {error && (
        <div style={{
          marginTop: 16,
          padding: 16,
          backgroundColor: "#fff0f0",
          borderRadius: 8,
          color: "red"
        }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {result && (
        <div style={{
          marginTop: 16,
          padding: 16,
          backgroundColor: "#f0f7ff",
          borderRadius: 8,
          lineHeight: 1.6
        }}>
          <strong>Análisis:</strong>
          <div dangerouslySetInnerHTML={{ __html: renderMarkdown(result) }} />
        </div>
      )}
    </div>
  );
}
