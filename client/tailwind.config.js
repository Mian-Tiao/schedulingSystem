/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        production: '#2878d4',
        setup: '#e89a20',
        cleaning: '#20a47a',
        maintenance: '#8b98a7',
        late: '#df4b55',
      },
      boxShadow: {
        panel: '0 1px 2px rgba(15, 23, 42, 0.04), 0 12px 28px rgba(15, 23, 42, 0.06)',
      },
    },
  },
  plugins: [],
};
