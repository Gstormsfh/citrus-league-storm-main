
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
				// Digital Starter Jacket - Physical Vintage Artifact Colors
				citrus: {
					cream: '#FFFDF2',       // Warm Cream (base) - Pure white FORBIDDEN
					sage: '#789561',        // Vintage Apple/Sage (primary green)
					peach: '#E6A99F',       // Muted Coral (secondary)
					orange: '#DF7536',      // Miami Varsity Orange (accents)
					charcoal: '#333333',    // Warm soft dark
					forest: '#1B3022',      // Deep Forest Green (text anchor)
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
        }
			},
			animation: {
				'accordion-down': 'accordion-down 0.2s ease-out',
				'accordion-up': 'accordion-up 0.2s ease-out',
				"fade-in": "fade-in 0.6s ease-out",
        "slide-in": "slide-in 0.4s ease-out",
        "slide-down": "slide-down 0.4s ease-out",
        "bounce-subtle": "bounce-subtle 2s ease-in-out infinite"
			},
			fontFamily: {
				sans: ['Inter', 'Montserrat', 'sans-serif'],         // Clean body text
				display: ['Montserrat', 'sans-serif'],               // Secondary headers
				varsity: ['Graduate', 'Alfa Slab One', 'serif'],     // Bold varsity lettering
				script: ['Pacifico', 'Bangers', 'cursive'],          // Surfer script accent
			}
		}
	},
	plugins: [require("tailwindcss-animate")],
} satisfies Config;
