/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        production: '#3b82f6',
        setup: '#f59e0b',
        cleaning: '#10b981',
        maintenance: '#94a3b8',
        late: '#ef4444',
      },
    },
  },
  plugins: [],
};
