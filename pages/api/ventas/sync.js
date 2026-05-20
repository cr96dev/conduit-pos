export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const secret = req.headers["x-bridge-secret"];
  const EXPECTED = process.env.BRIDGE_SECRET || "hidrocom2026";
  if (!secret || secret !== EXPECTED) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const body = req.body;
  if (!body || !body.date) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || "https://rlthkqqeeepqqrmeoiun.supabase.co",
      process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJsdGhrcXFlZWVwcXFybWVvaXVuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTc1NTIzMiwiZXhwIjoyMDkxMzMxMjMyfQ.b1nFB0SiLvvBH-aD7HbzKUUWIPM9jvU5UjG6N3n83s0"
    );

    const { data, error } = await supabase
      .from("ventas")
      .upsert(
        {
          estacion_id: body.estacion_id,
          fecha: body.date,
          regular_litros: body.totals?.regular_litros || null,
          regular_ingresos: body.totals?.regular_ingresos || null,
          premium_litros: body.totals?.premium_litros || null,
          premium_ingresos: body.totals?.premium_ingresos || null,
          diesel_litros: body.totals?.diesel_litros || null,
          diesel_ingresos: body.totals?.diesel_ingresos || null,
          diesel_plus_litros: body.totals?.diesel_plus_litros || null,
          diesel_plus_ingresos: body.totals?.diesel_plus_ingresos || null,
        },
        { onConflict: "estacion_id,fecha" }
      )
      .select();

    if (error) throw error;

    return res.status(200).json({
      success: true,
      message: `Ventas del ${body.date} guardadas para ${body.site_name}`,
      record: data[0],
    });
  } catch (err) {
    console.error("Error guardando en Supabase:", err);
    return res.status(500).json({ error: err.message });
  }
}
