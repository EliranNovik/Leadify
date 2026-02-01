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
    themes: ["light", "dark"],
    darkTheme: "dark",
    base: true,
    styled: true,
    utils: true,
    rtl: false,
    prefix: "",
    logs: true,
  },
}
