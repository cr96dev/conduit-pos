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
        // Sustitutos libres (Google Fonts) cercanos a Adobe Caslon + Brown Sugar.
        body:    ['"Cormorant Garamond"', 'Georgia', 'serif'],
        display: ['"Cinzel"', '"Cormorant Garamond"', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
}
