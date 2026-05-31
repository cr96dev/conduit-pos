/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Manual de marca Julia Bakery
        julia: {
          red:   '#C62127',  // rojo carmesi principal
          cream: '#EFDEB3',  // crema/marfil
        },
      },
      fontFamily: {
        // Body: Inter (sans-serif tecnica/sobria) para UI/POS/operacion.
        body:    ['"Inter"', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        // Display: Cinzel SOLO para .font-display (branding, marketing).
        display: ['"Cinzel"', 'Georgia', 'serif'],
        // Sans alias por si algun componente usa explicitamente font-sans.
        sans:    ['"Inter"', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
