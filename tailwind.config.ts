import type { Config } from 'tailwindcss'

const config: Config = {
  content: {
    files: [
      './src/**/*.{js,ts,jsx,tsx,mdx}',
    ],
  },
  theme: {
    extend: {},
  },
  plugins: [],
}
export default config