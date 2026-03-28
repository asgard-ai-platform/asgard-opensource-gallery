/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Space Grotesk"', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        background: '#020306',
        foreground: '#e8f5e9',
        card: '#0a0d12',
        'card-foreground': '#e8f5e9',
        primary: '#4ade80',
        'primary-foreground': '#052e16',
        secondary: '#121418',
        'secondary-foreground': '#e8f5e9',
        muted: '#121418',
        'muted-foreground': '#86a68a',
        accent: '#1a1d24',
        'accent-foreground': '#e8f5e9',
        border: 'rgba(74, 222, 128, 0.12)',
        input: 'rgba(74, 222, 128, 0.05)',
        ring: '#4ade80',
        // Status colors (kept for StatusBadge)
        status: {
          released: '#22c55e',
          coming: '#f59e0b',
          planned: '#6b7280',
        },
      },
      borderRadius: {
        xl: '0.75rem',
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
      animation: {
        'glow-pulse': 'glow-pulse 4s ease-in-out infinite',
        'glow-pulse-delayed': 'glow-pulse 4s ease-in-out 1s infinite',
        'glow-pulse-delayed-2': 'glow-pulse 4s ease-in-out 2s infinite',
      },
      keyframes: {
        'glow-pulse': {
          '0%, 100%': { opacity: '0.15' },
          '50%': { opacity: '0.3' },
        },
      },
    },
  },
  plugins: [],
};
