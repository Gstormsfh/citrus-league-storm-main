import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border-2 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide transition-all focus:outline-none focus:ring-2 focus:ring-citrus-orange focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-citrus-forest/30 bg-citrus-sage text-citrus-forest hover:bg-citrus-sage/80 shadow-sm",
        secondary:
          "border-citrus-orange/30 bg-citrus-peach text-citrus-forest hover:bg-citrus-peach/80 shadow-sm",
        destructive:
          "border-destructive/40 bg-destructive text-citrus-cream hover:bg-destructive/80 shadow-sm",
        outline: "text-citrus-forest border-citrus-sage bg-transparent hover:bg-citrus-sage/20",
        varsity: "border-citrus-forest bg-citrus-orange text-citrus-cream font-varsity shadow-patch hover:translate-y-0.5",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
