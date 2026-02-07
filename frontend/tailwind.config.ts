import type { Config } from 'tailwindcss';
import tailwindAnimate from 'tailwindcss-animate';

const config: Config = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        'resilience-high': 'hsl(var(--resilience-high))',
        'resilience-medium': 'hsl(var(--resilience-medium))',
        'resilience-low': 'hsl(var(--resilience-low))',
        'severity-critical': 'hsl(var(--severity-critical))',
        'severity-high': 'hsl(var(--severity-high))',
        'severity-medium': 'hsl(var(--severity-medium))',
        'severity-low': 'hsl(var(--severity-low))',
        'node-database': 'hsl(var(--node-database))',
        'node-compute': 'hsl(var(--node-compute))',
        'node-network': 'hsl(var(--node-network))',
        'node-storage': 'hsl(var(--node-storage))',
        'node-serverless': 'hsl(var(--node-serverless))',
        'node-external': 'hsl(var(--node-external))',
        'node-down': 'hsl(var(--node-down))',
        'node-degraded': 'hsl(var(--node-degraded))',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      keyframes: {
        'pulse-slow': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
      },
      animation: {
        'pulse-slow': 'pulse-slow 2s ease-in-out infinite',
      },
    },
  },
  plugins: [tailwindAnimate],
};

export default config;
