// pages/api/fel/consultar-cui-kiosko.js
//
// DEPRECADO 2026-06-01. El kiosko ya es un cajero autenticado, usa la ruta
// privada /api/fel/consultar-cui como cualquier otra terminal.

export default function handler(req, res) {
  return res.status(410).json({
    ok: false,
    error: 'Endpoint deprecado. Usar /api/fel/consultar-cui con sesión de cajero.',
  })
}
