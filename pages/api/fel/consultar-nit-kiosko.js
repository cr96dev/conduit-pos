// pages/api/fel/consultar-nit-kiosko.js
//
// DEPRECADO 2026-06-01. El kiosko ya es un cajero autenticado, usa la ruta
// privada /api/fel/consultar-nit como cualquier otra terminal.

export default function handler(req, res) {
  return res.status(410).json({
    ok: false,
    error: 'Endpoint deprecado. Usar /api/fel/consultar-nit con sesión de cajero.',
  })
}
