import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { motion, type Transition } from "framer-motion";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

const DEFAULT_TAP_TRANSITION: Transition = { type: "spring", stiffness: 500, damping: 30 };

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /**
   * Overrides the spring used for the tap-release bounce-back. The default
   * (damping: 30 at stiffness: 500) is underdamped on purpose - it overshoots
   * past scale(1) for a springy feel - which reads fine on buttons with room
   * around them. For a button sitting flush inside a tightly rounded
   * container (e.g. an icon button inset in a pill-shaped input), that
   * overshoot can visibly bulge past the container's edge. Pass a
   * critically-damped transition (damping >= ~2*sqrt(stiffness)) there.
   */
  tapTransition?: Transition;
}

// Plain `motion.button` for ordinary buttons, and a motion-wrapped Slot for
// the `asChild` case (e.g. a Button that's really rendering a Link) so tap
// feedback is consistent either way instead of only working half the time.
const MotionButton = motion.button;
const MotionSlot = motion(Slot);

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, tapTransition, ...props }, ref) => {
    const Comp = asChild ? MotionSlot : MotionButton;
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        whileTap={{ scale: 0.96 }}
        transition={tapTransition ?? DEFAULT_TAP_TRANSITION}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
