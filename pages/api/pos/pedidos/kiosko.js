// pages/api/pos/pedidos/kiosko.js
//
// DEPRECADO 2026-06-01. El kiosko ahora es un cajero normal con PIN propio
// (flag `es_kiosko` en perfiles) y factura directo desde /pos. Ya no se
// crean pedidos "kiosko" para que otro cajero los recoja.
//
// Se mantiene la ruta y devuelve 410 Gone para detectar clientes con cache
// vieja del flujo anterior.

export default function handler(req, res) {
  return res.status(410).json({
    ok: false,
    error: 'Endpoint deprecado. El kiosko ahora se loguea con PIN de cajero en /cajero-login.',
  })
}
