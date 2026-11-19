import React from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 21st.dev's "Interactive Hover Button", as published (user, 2026-11-17: "keep this style and shape"): a pill
 * with its label and a small dot; pointed at, the label slides right and fades, the same label with an arrow
 * slides in from the right, and the dot grows to fill the button. Used by the Brand kit's Save & next.
 *
 * Two additions, so the colours can be our own (this project has no shadcn colour tokens): `dotClassName`
 * colours the dot and the fill it grows into, `hoverTextClassName` the label and arrow on it. Both default to
 * the original's.
 */
interface InteractiveHoverButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  text?: string;
  dotClassName?: string;
  hoverTextClassName?: string;
}

const InteractiveHoverButton = React.forwardRef<
  HTMLButtonElement,
  InteractiveHoverButtonProps
>(({ text = "Button", className, dotClassName = "bg-primary", hoverTextClassName = "text-primary-foreground", ...props }, ref) => {
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
      <div className={cn("absolute top-0 z-10 flex h-full w-full translate-x-12 items-center justify-center gap-2 opacity-0 transition-all duration-300 group-hover:-translate-x-1 group-hover:opacity-100", hoverTextClassName)}>
        <span>{text}</span>
        <ArrowRight />
      </div>
      <div className={cn("absolute left-[20%] top-[40%] h-2 w-2 scale-[1] rounded-lg transition-all duration-300 group-hover:left-[0%] group-hover:top-[0%] group-hover:h-full group-hover:w-full group-hover:scale-[1.8]", dotClassName)}></div>
    </button>
  );
});

InteractiveHoverButton.displayName = "InteractiveHoverButton";

export { InteractiveHoverButton };
