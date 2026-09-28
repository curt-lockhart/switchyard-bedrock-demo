import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        nvidia: {
          green: "#76b900",
          dark:  "#1a1a1a",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
