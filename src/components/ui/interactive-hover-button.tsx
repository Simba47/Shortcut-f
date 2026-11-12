import React from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A button that fills on hover: at rest its label with a small dot before it; pointed at (or focused from
 * the keyboard) a circle grows from the middle and covers the whole button, the label stays exactly where it
 * was in the fill's colours and an arrow slides in after it. (Idea from 21st.dev's "interactive hover
 * button"; used by the Brand kit's Save & next / Save & finish — user, 2026-10-31.)
 *
 * (user, 2026-11-13: rebuilt — the old one scaled a rounded square, which left the button's colour showing in
 * the corners, and slid two different labels 48 px across each other, so the words jumped.) Both layers lay
 * out the same three slots — dot · label · arrow — with the one they don't show kept invisible, so the label
 * never moves. Styles: .ihb in globals.css. `fillClassName` colours the fill, `hoverTextClassName` the label
 * and arrow on it.
 */
interface InteractiveHoverButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  text?: string;
  /** The fill that covers the button on hover (its background colour) */
  fillClassName?: string;
  /** The label and arrow shown on the fill (their colour) */
  hoverTextClassName?: string;
}

const InteractiveHoverButton = React.forwardRef<
  HTMLButtonElement,
  InteractiveHoverButtonProps
>(({ text = "Button", className, fillClassName, hoverTextClassName, ...props }, ref) => {
  const slots = (dot: boolean, arrow: boolean) => (
    <span className="ihb-row">
      <span className="ihb-dot" style={dot ? undefined : { visibility: "hidden" }} />
      <span>{text}</span>
      <ArrowRight className="ihb-arrow" style={arrow ? undefined : { visibility: "hidden" }} aria-hidden />
    </span>
  );
  return (
    <button
      ref={ref}
      className={cn(
        "ihb group relative inline-flex cursor-pointer items-center justify-center overflow-hidden rounded-full font-semibold",
        className,
      )}
      {...props}
    >
      {slots(true, false)}
      <span aria-hidden className={cn("ihb-fill", fillClassName, hoverTextClassName)}>
        {slots(false, true)}
      </span>
    </button>
  );
});

InteractiveHoverButton.displayName = "InteractiveHoverButton";

export { InteractiveHoverButton };
