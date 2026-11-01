/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        tweak: {
          canvas: "#0B0C10",
          purple: "#8A2BE2",
          blue: "#00D2FF",
          light: "#F8F9FA",
          slate: "#1A1A1A",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
