import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-display font-semibold ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-citrus-orange focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-citrus-sage text-citrus-forest border-2 border-citrus-forest/20 rounded-2xl hover:bg-citrus-sage/80 hover:border-citrus-forest/40 shadow-md hover:shadow-patch active:translate-y-0.5",
        destructive:
          "bg-destructive text-citrus-cream border-2 border-destructive/40 rounded-2xl hover:bg-destructive/90 shadow-md hover:shadow-patch active:translate-y-0.5",
        outline:
          "border-3 border-citrus-sage bg-transparent text-citrus-forest rounded-2xl hover:bg-citrus-sage/20 hover:border-citrus-sage/60 active:translate-y-0.5",
        secondary:
          "bg-citrus-peach text-citrus-forest border-2 border-citrus-orange/20 rounded-2xl hover:bg-citrus-peach/80 hover:border-citrus-orange/40 shadow-md hover:shadow-patch active:translate-y-0.5",
        ghost: "hover:bg-citrus-sage/20 hover:text-citrus-orange rounded-xl text-citrus-forest",
        link: "text-citrus-orange underline-offset-4 hover:underline hover:text-citrus-orange/80",
        varsity: "bg-citrus-sage border-4 border-citrus-forest rounded-varsity font-varsity uppercase tracking-wide shadow-patch hover:translate-y-0.5 active:translate-y-1 text-citrus-forest",
        patch: "bg-citrus-orange border-4 border-citrus-charcoal rounded-varsity font-varsity uppercase tracking-wide shadow-patch hover:translate-y-0.5 active:translate-y-1 text-citrus-cream",
      },
      size: {
        default: "h-10 px-6 py-2",
        sm: "h-9 px-4 text-xs",
        lg: "h-12 px-8 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
