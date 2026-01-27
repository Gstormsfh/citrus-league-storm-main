import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-varsity uppercase tracking-tighter border-4 border-solid transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-citrus-sage focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: cn(
          "bg-citrus-sage text-citrus-forest border-citrus-sage-light rounded-[2rem]",
          "shadow-[inset_0_2px_4px_rgba(0,0,0,0.05),0_3px_0_rgba(164,196,160,0.3)]",
          "hover:translate-y-[1px] hover:shadow-[inset_0_2px_4px_rgba(0,0,0,0.05),0_2px_0_rgba(164,196,160,0.3)] hover:bg-citrus-green-light"
        ),
        destructive: cn(
          "bg-destructive text-[#E8EED9] border-citrus-forest rounded-[2rem]",
          "shadow-[inset_0_2px_4px_rgba(0,0,0,0.1),0_4px_0_rgba(27,48,34,0.2)]",
          "hover:translate-y-[2px] hover:shadow-[inset_0_2px_4px_rgba(0,0,0,0.1),0_2px_0_rgba(27,48,34,0.2)]"
        ),
        outline: cn(
          "bg-transparent text-citrus-forest border-citrus-sage rounded-[2rem]",
          "hover:bg-citrus-sage/30 hover:translate-y-[1px] transition-all"
        ),
        secondary: cn(
          "bg-citrus-peach text-citrus-forest border-citrus-forest rounded-[2rem]",
          "shadow-[inset_0_2px_4px_rgba(0,0,0,0.1),0_4px_0_rgba(27,48,34,0.2)]",
          "hover:translate-y-[2px] hover:shadow-[inset_0_2px_4px_rgba(0,0,0,0.1),0_2px_0_rgba(27,48,34,0.2)]"
        ),
        ghost: "border-0 hover:bg-citrus-sage/20 hover:text-citrus-forest rounded-xl text-citrus-forest font-display normal-case tracking-normal",
        link: "border-0 text-citrus-sage underline-offset-4 hover:underline font-display normal-case tracking-normal",
        varsity: cn(
          "bg-citrus-sage text-citrus-forest border-citrus-sage-light rounded-[2rem] font-bold",
          "shadow-[inset_0_2px_4px_rgba(0,0,0,0.05),0_3px_0_rgba(164,196,160,0.3)]",
          "hover:translate-y-[1px] hover:shadow-[inset_0_2px_4px_rgba(0,0,0,0.05),0_2px_0_rgba(164,196,160,0.3)] hover:bg-citrus-green-light"
        ),
        patch: cn(
          "bg-citrus-sage/20 text-citrus-forest border-citrus-sage rounded-[2rem]",
          "shadow-sm",
          "hover:translate-y-0.5 hover:shadow transition-all"
        ),
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
