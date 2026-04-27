
import type { Config } from "tailwindcss";

export default {
	darkMode: ["class"],
	content: [
		"./pages/**/*.{ts,tsx}",
		"./components/**/*.{ts,tsx}",
		"./app/**/*.{ts,tsx}",
		"./src/**/*.{ts,tsx}",
	],
	prefix: "",
	theme: {
		container: {
			center: true,
			padding: '2rem',
			screens: {
				'2xl': '1400px'
			}
		},
		extend: {
			colors: {
				border: 'hsl(var(--border))',
				input: 'hsl(var(--input))',
				ring: 'hsl(var(--ring))',
				background: 'hsl(var(--background))',
				foreground: 'hsl(var(--foreground))',
				primary: {
					DEFAULT: 'hsl(var(--primary))',
					foreground: 'hsl(var(--primary-foreground))'
				},
				secondary: {
					DEFAULT: 'hsl(var(--secondary))',
					foreground: 'hsl(var(--secondary-foreground))'
				},
				destructive: {
					DEFAULT: 'hsl(var(--destructive))',
					foreground: 'hsl(var(--destructive-foreground))'
				},
				muted: {
					DEFAULT: 'hsl(var(--muted))',
					foreground: 'hsl(var(--muted-foreground))'
				},
				accent: {
					DEFAULT: 'hsl(var(--accent))',
					foreground: 'hsl(var(--accent-foreground))'
				},
				popover: {
					DEFAULT: 'hsl(var(--popover))',
					foreground: 'hsl(var(--popover-foreground))'
				},
				card: {
					DEFAULT: 'hsl(var(--card))',
					foreground: 'hsl(var(--card-foreground))'
				},
				sidebar: {
					DEFAULT: 'hsl(var(--sidebar-background))',
					foreground: 'hsl(var(--sidebar-foreground))',
					primary: 'hsl(var(--sidebar-primary))',
					'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
					accent: 'hsl(var(--sidebar-accent))',
					'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
					border: 'hsl(var(--sidebar-border))',
					ring: 'hsl(var(--sidebar-ring))'
				},
				// Digital Starter Jacket - Physical Vintage Artifact Colors - PASTEL CREAMY VIBES
				citrus: {
					cream: '#E8EED9',       // Greenish cream - blends with background
					sage: '#A4C4A0',        // Soft Pastel Sage - CREAMY
					'sage-light': '#C8DCC4', // Very light sage for subtle elements
					'green-light': '#B8D4A8',  // Pastel green - SOFT
					'green-medium': '#98BA88', // Muted medium green - CREAMY
					'green-dark': '#7A9E73',   // Soft darker green - still pastel
					peach: '#F5D5C8',       // Super light peachy cream
					orange: '#F4A460',      // Sandy Orange - softer
					charcoal: '#5C5C5C',    // Soft charcoal
					forest: '#4A5F4D',      // Soft forest - NOT too dark
				},
				// ==========================================
				// PREMIUM REDESIGN TOKENS — additive, do not modify existing citrus-* or fantasy-* tokens
				// Used by /preview-redesign route only. Slapshot Editorial design system.
				// ==========================================
				premium: {
					// Surface hierarchy — forest-black with subtle green undertone (preserves Citrus brand memory)
					bg: '#0F1411',           // surface — base canvas
					'bg-deep': '#0A0F0C',    // surface-container-lowest — utility bars
					surface: '#181D1A',      // surface-container-low — sectioning
					'surface-high': '#1C211D', // surface-container — primary cards
					'surface-higher': '#262B28', // surface-container-high — interactive elements
					'surface-highest': '#313632', // surface-container-highest — active states
					'surface-bright': '#353A37',  // bright variant
					// Text & content
					text: '#DFE4DE',         // on-surface — primary text
					'text-muted': '#A8B0A6', // secondary text
					'text-dim': '#6B7368',   // tertiary text
					// The signature accent — citrus orange
					orange: '#FF6B1A',       // primary-container — surgical laser
					'orange-soft': '#FFB596', // primary — softer variant
					'orange-deep': '#581E00', // on-primary — text on orange
					// Cool data accent for opposing/comparison data
					ice: '#8DCDFF',          // tertiary
					'ice-deep': '#00A2EB',   // tertiary-container
					// Border / outline
					border: 'rgba(255, 255, 255, 0.08)',     // ghost border default
					'border-strong': 'rgba(255, 255, 255, 0.15)', // ghost border accessible
				},
				// ==========================================
				// PASTEL VIBRANT TOKENS — additive, for /preview-redesign only
				// Citrus brand: warm cream/peach pastel base, vibrant orange punches.
				// Glossier × Casper × Notion register.
				// ==========================================
				pastel: {
					cream: '#FFF8F0',           // base bg upper
					'cream-warm': '#FFEDDB',    // base bg mid
					peach: '#FFE0CC',           // base bg lower / soft accent
					'peach-deep': '#FFB591',    // deeper peach accent
					sage: '#84A57D',            // sage green for live/success
					'sage-soft': '#C8DCC4',     // pale sage for chips/borders
					forest: '#1B3022',          // deep forest text
					'forest-soft': '#3E5A3E',   // muted forest text
					'forest-dim': '#6B7B6B',    // tertiary text
					orange: '#FF6B1A',          // vibrant primary CTA
					'orange-soft': '#FF9F66',   // softer warm orange
					'orange-deep': '#C04A0E',   // deep orange (text on light)
				},
				// Citrus fantasy sports theme colors - High-Contrast Citrus Palette
				fantasy: {
					primary: '#F9E076',     // Bright Lemon Peel (Center)
					secondary: '#459345',   // Deep Lime Green (Left Wing)
					tertiary: '#F9A436',     // Zesty Tangerine (Right Wing)
					'dark-orange': '#B75302', // Dark Orange Rind
					'grapefruit-red': '#FF6F80', // Grapefruit Ruby Red
					light: '#FFF1DB',      // Light cream
					dark: '#1E293B',       // Slate dark
					muted: '#94A3B8',      // Slate gray
					border: '#E2E8F0',     // Light border
					danger: '#ef4444',     // Red for negative
					positive: '#22c55e',   // Green for positive
					neutral: '#f59e0b',    // Amber for neutral
					surface: '#FFFFFF',    // White surface
					background: '#F8FAFC'  // Light background
				}
			},
			borderRadius: {
				lg: 'var(--radius)',
				md: 'calc(var(--radius) - 2px)',
				sm: 'calc(var(--radius) - 4px)',
				'varsity': '2rem',        // Aggressively rounded for that "patch" look
			},
			boxShadow: {
				'patch': '0 4px 0 0 rgba(27, 48, 34, 0.1)',  // Soft, tactile lift
				'varsity': '0 6px 0 0 rgba(27, 48, 34, 0.15), 0 2px 8px rgba(0, 0, 0, 0.1)',  // Enhanced depth
			},
			keyframes: {
				'accordion-down': {
					from: {
						height: '0'
					},
					to: {
						height: 'var(--radix-accordion-content-height)'
					}
				},
				'accordion-up': {
					from: {
						height: 'var(--radix-accordion-content-height)'
					},
					to: {
						height: '0'
					}
				},
				"fade-in": {
          "0%": {
            opacity: "0",
            transform: "translateY(10px)"
          },
          "100%": {
            opacity: "1",
            transform: "translateY(0)"
          }
        },
        "slide-in": {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(0)" }
        },
        "slide-down": {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(0)" }
        },
        "bounce-subtle": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-5px)" }
        },
        "float-slow": {
          "0%, 100%": { transform: "translateY(0px) rotate(0deg)" },
          "50%": { transform: "translateY(-12px) rotate(1.5deg)" }
        },
        "float-medium": {
          "0%, 100%": { transform: "translateY(0px) rotate(0deg)" },
          "50%": { transform: "translateY(-8px) rotate(-1deg)" }
        },
        "marquee": {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" }
        },
        "live-pulse": {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.5", transform: "scale(1.3)" }
        }
			},
			animation: {
				'accordion-down': 'accordion-down 0.2s ease-out',
				'accordion-up': 'accordion-up 0.2s ease-out',
				"fade-in": "fade-in 0.6s ease-out",
        "slide-in": "slide-in 0.4s ease-out",
        "slide-down": "slide-down 0.4s ease-out",
        "bounce-subtle": "bounce-subtle 2s ease-in-out infinite",
        "float-slow": "float-slow 7s ease-in-out infinite",
        "float-medium": "float-medium 5s ease-in-out infinite",
        "marquee": "marquee 80s linear infinite",
        "live-pulse": "live-pulse 1.6s ease-in-out infinite"
			},
			fontFamily: {
				sans: ['Inter', 'Montserrat', 'sans-serif'],         // Clean body text
				display: ['Montserrat', 'sans-serif'],               // Secondary headers
				varsity: ['Graduate', 'Alfa Slab One', 'serif'],     // Bold varsity lettering
				script: ['Pacifico', 'Bangers', 'cursive'],          // Surfer script accent
				// Premium redesign — additive, used only on /preview-redesign
				'editorial': ['"Playfair Display"', 'Georgia', 'serif'],   // Editorial serif headlines
				'caps': ['"Bebas Neue"', '"Arial Narrow"', 'sans-serif'],   // Condensed caps section labels
				'premium-body': ['Inter', 'system-ui', 'sans-serif'],      // Premium body text (Inter at heavier weights)
				// Pastel-vibrant redesign — Citrus warm-character serif + clean body + tabular mono
				'calistoga': ['Calistoga', 'Georgia', 'serif'],            // Warm display serif — Citrus voice with human warmth
				'jbmono': ['"JetBrains Mono"', 'ui-monospace', 'monospace'], // Tabular numbers + mono labels
			}
		}
	},
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	plugins: [require("tailwindcss-animate")],
} satisfies Config;
