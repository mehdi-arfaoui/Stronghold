import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: 'hsl(var(--card))',
        elevated: 'hsl(var(--elevated))',
        overlay: 'hsl(var(--overlay))',
        sidebar: 'hsl(var(--sidebar))',
        border: 'hsl(var(--border))',
        'border-strong': 'hsl(var(--border-strong))',
        muted: 'hsl(var(--muted))',
        input: 'hsl(var(--input))',
        'muted-foreground': 'hsl(var(--muted-foreground))',
        'subtle-foreground': 'hsl(var(--subtle-foreground))',
        accent: 'hsl(var(--accent))',
        'accent-foreground': 'hsl(var(--accent-foreground))',
        'accent-emphasis': 'hsl(var(--accent-emphasis))',
        'accent-disabled': 'hsl(var(--accent-disabled))',
        'accent-soft': 'hsl(var(--accent-soft))',
        'accent-soft-foreground': 'hsl(var(--accent-soft-foreground))',
        success: 'hsl(var(--success))',
        'success-soft': 'hsl(var(--success-soft))',
        'success-foreground': 'hsl(var(--success-foreground))',
        warning: 'hsl(var(--warning))',
        'warning-soft': 'hsl(var(--warning-soft))',
        'warning-foreground': 'hsl(var(--warning-foreground))',
        danger: 'hsl(var(--danger))',
        'danger-soft': 'hsl(var(--danger-soft))',
        'danger-foreground': 'hsl(var(--danger-foreground))',
      },
      boxShadow: {
        panel: 'var(--panel-shadow)',
      },
      fontFamily: {
        sans: ['"Space Grotesk"', '"IBM Plex Sans"', '"Segoe UI"', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
