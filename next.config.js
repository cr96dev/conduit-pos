/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },

  // Conduit POS — routing público
  //   /        → landing de marketing (public/landing.html)
  //   /login   → login del POS (cajeros y admins)
  //   /pos     → operación de venta (heredado de Julia, requiere session)
  //   /dashboard etc → admin (requiere session)
  //
  // Rewrites sirven el contenido SIN cambiar la URL en el browser:
  // conduitgt.net/ muestra el landing pero la URL queda como "/".
  async rewrites() {
    return [
      { source: '/', destination: '/landing.html' },
    ]
  },
}
module.exports = nextConfig
