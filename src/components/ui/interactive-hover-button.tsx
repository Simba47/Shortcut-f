import React from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A button whose label slides out on hover while a dot grows to fill it and the label comes back in
 * with an arrow (from 21st.dev's "interactive hover button"). Used by the Brand kit's Next / Done
 * (user, 2026-10-31). The app has no shadcn colour tokens (primary, background), so the colours can be
 * passed in: `fillClassName` for the dot that fills it, `hoverTextClassName` for the label shown over the
 * fill. The defaults are shadcn's.
 */
interface InteractiveHoverButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  text?: string;
  /** The dot that grows to fill the button on hover */
  fillClassName?: string;
  /** The label and arrow shown over the fill */
  hoverTextClassName?: string;
}

const InteractiveHoverButton = React.forwardRef<
  HTMLButtonElement,
  InteractiveHoverButtonProps
>(({ text = "Button", className, fillClassName, hoverTextClassName, ...props }, ref) => {
  return (
    <button
      ref={ref}
      className={cn(
        "group relative w-32 cursor-pointer overflow-hidden rounded-full border bg-background p-2 text-center font-semibold",
        className,
      )}
      {...props}
    >
      <span className="inline-block translate-x-1 transition-all duration-300 group-hover:translate-x-12 group-hover:opacity-0">
        {text}
      </span>
      <div className={cn("absolute top-0 z-10 flex h-full w-full translate-x-12 items-center justify-center gap-2 text-primary-foreground opacity-0 transition-all duration-300 group-hover:-translate-x-1 group-hover:opacity-100", hoverTextClassName)}>
        <span>{text}</span>
        <ArrowRight />
      </div>
      <div className={cn("absolute left-[20%] top-[40%] h-2 w-2 scale-[1] rounded-lg bg-primary transition-all duration-300 group-hover:left-[0%] group-hover:top-[0%] group-hover:h-full group-hover:w-full group-hover:scale-[1.8] group-hover:bg-primary", fillClassName)}></div>
    </button>
  );
});

InteractiveHoverButton.displayName = "InteractiveHoverButton";

export { InteractiveHoverButton };
