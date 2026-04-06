const daisyui = require('daisyui')

module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: '#3b28c7',
        'primary-content': '#fff',
        'purple-700': '#3b28c7',
        'gray-900': '#18181b',
        'gray-700': '#404040',
        'gray-500': '#6b7280',
        'gray-100': '#f3f4f6',
        'yellow-50': '#fefce8',
        'yellow-400': '#facc15',
        'green-600': '#16a34a',
        'red-400': '#f87171',
        // Add any other colors you use in your app here
      },
      keyframes: {
        'fade-in': {
          '0%': {
            opacity: '0',
            transform: 'translateY(10px)',
          },
          '100%': {
            opacity: '1',
            transform: 'translateY(0)',
          },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.5s ease-out',
      },
    },
  },
  plugins: [daisyui],
  daisyui: {
    themes: [
      'light',
      'dark',
      {
        dark2: {
          'color-scheme': 'dark',
          primary: '#8b7fd6',
          'primary-content': '#0a0a0a',
          secondary: '#404040',
          'secondary-content': '#e5e5e5',
          accent: '#3f3f46',
          'accent-content': '#f4f4f5',
          neutral: '#27272a',
          'neutral-content': '#e4e4e7',
          'base-100': '#000000',
          'base-200': '#18181b',
          'base-300': '#27272a',
          'base-content': '#e4e4e7',
          info: '#3b82f6',
          'info-content': '#eff6ff',
          success: '#22c55e',
          'success-content': '#052e16',
          warning: '#eab308',
          'warning-content': '#422006',
          error: '#ef4444',
          'error-content': '#450a0a',
        },
      },
    ],
    darkTheme: "dark",
    base: true,
    styled: true,
    utils: true,
    rtl: false,
    prefix: "",
    logs: true,
  },
}
