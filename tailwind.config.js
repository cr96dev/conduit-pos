/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Manual de marca Julia Bakery — acento principal
        julia: {
          red:      '#C62127',
          'red-dk': '#9F1A1F',
          cream:    '#EFDEB3',
        },
        // Escala de superficies (mapeadas a CSS vars via globals.css)
        surface: {
          DEFAULT: 'var(--surface)',
          2: 'var(--surface-2)',
          3: 'var(--surface-3)',
        },
        ink: {
          DEFAULT:  'var(--ink)',
          muted:    'var(--ink-muted)',
          subtle:   'var(--ink-subtle)',
          disabled: 'var(--ink-disabled)',
        },
      },
      fontFamily: {
        body:    ['"Inter"', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['"Cinzel"', 'Georgia', 'serif'],
        sans:    ['"Inter"', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono:    ['"IBM Plex Mono"', '"JetBrains Mono"', 'Menlo', 'monospace'],
      },
      boxShadow: {
        xs: 'var(--shadow-xs)',
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        modal: 'var(--shadow-modal)',
      },
      borderRadius: {
        // Standard del sistema
        DEFAULT: '10px',
        sm: '6px',
        md: '10px',
        lg: '14px',
        xl: '18px',
      },
      fontSize: {
        // Scale custom: tech-leaning, base 14px
        '2xs': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.02em' }],
      },
      transitionTimingFunction: {
        'out-soft': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
}
