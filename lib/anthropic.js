export async function analyzeData(data, prompt) {
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data, prompt }),
  });
  return res.json();
}
