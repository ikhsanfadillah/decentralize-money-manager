import * as React from "react";
import { Drawer as DrawerPrimitive } from "vaul";
import { cn } from "../../lib/utils";

const DrawerRepositionContext = React.createContext(false);

const KEYBOARD_OVERLAP_THRESHOLD_PX = 100;
const VIEWPORT_TOP_GAP_PX = 16;
const NON_TEXT_INPUT_TYPES = new Set([
  "checkbox",
  "radio",
  "range",
  "color",
  "file",
  "image",
  "button",
  "submit",
  "reset",
]);

function isTextEditableElement(
  target: EventTarget | null
): target is HTMLElement {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target instanceof HTMLInputElement) {
    return !NON_TEXT_INPUT_TYPES.has(target.type) && !target.readOnly;
  }
  return target instanceof HTMLTextAreaElement || target.isContentEditable;
}

function scrollFocusedFieldIntoNearestDrawerBody(
  drawerEl: HTMLElement,
  focusedEl: HTMLElement
) {
  let parent = focusedEl.parentElement;
  while (parent && parent !== drawerEl) {
    const computed = window.getComputedStyle(parent);
    if (
      /(auto|scroll)/.test(computed.overflowY) &&
      parent.scrollHeight > parent.clientHeight
    ) {
      const parentRect = parent.getBoundingClientRect();
      const targetRect = focusedEl.getBoundingClientRect();
      if (targetRect.bottom > parentRect.bottom - 8) {
        parent.scrollTop += targetRect.bottom - parentRect.bottom + 12;
      } else if (targetRect.top < parentRect.top + 8) {
        parent.scrollTop -= parentRect.top - targetRect.top + 12;
      }
      break;
    }
    parent = parent.parentElement;
  }
}

const Drawer = ({
  shouldScaleBackground = false,
  repositionInputs = false,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Root>) => (
  <DrawerRepositionContext.Provider value={repositionInputs}>
    <DrawerPrimitive.Root
      shouldScaleBackground={shouldScaleBackground}
      repositionInputs={repositionInputs}
      {...props}
    />
  </DrawerRepositionContext.Provider>
);
Drawer.displayName = "Drawer";

const DrawerNested = ({
  shouldScaleBackground = false,
  repositionInputs = false,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.NestedRoot>) => (
  <DrawerRepositionContext.Provider value={repositionInputs}>
    <DrawerPrimitive.NestedRoot
      shouldScaleBackground={shouldScaleBackground}
      repositionInputs={repositionInputs}
      {...props}
    />
  </DrawerRepositionContext.Provider>
);
DrawerNested.displayName = "DrawerNested";

const DrawerTrigger = DrawerPrimitive.Trigger;
const DrawerPortal = DrawerPrimitive.Portal;
const DrawerClose = DrawerPrimitive.Close;

const DrawerOverlay = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/60 backdrop-blur-xs",
      className
    )}
    {...props}
  />
));
DrawerOverlay.displayName = DrawerPrimitive.Overlay.displayName;

const DrawerContent = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Content> & {
    hideOverlay?: boolean;
    overlayClassName?: string;
  }
>(
  (
    {
      className,
      children,
      hideOverlay = false,
      overlayClassName,
      onPointerDownOutside,
      onInteractOutside,
      onFocusOutside,
      style,
      ...props
    },
    ref
  ) => {
    const useVaulReposition = React.useContext(DrawerRepositionContext);
    const externalRef = React.useRef(ref);
    externalRef.current = ref;
    const styleRef = React.useRef(style);
    styleRef.current = style;
    const [contentNode, setContentNode] =
      React.useState<HTMLDivElement | null>(null);
    const hasAppliedKeyboardAdjustRef = React.useRef(false);

    const composedRef = React.useCallback((node: HTMLDivElement | null) => {
      setContentNode(node);
      const currentRef = externalRef.current;
      if (typeof currentRef === "function") {
        currentRef(node);
      } else if (currentRef) {
        currentRef.current = node;
      }
    }, []);

    React.useEffect(() => {
      if (useVaulReposition || !contentNode || typeof window === "undefined") {
        return;
      }
      const vv = window.visualViewport;
      if (!vv) {
        return;
      }

      let rafId: number | null = null;

      const restoreDrawerViewportStyles = () => {
        if (!hasAppliedKeyboardAdjustRef.current) {
          return;
        }
        const baseStyle = styleRef.current;
        if (baseStyle?.bottom !== undefined) {
          contentNode.style.bottom = String(baseStyle.bottom);
        } else {
          contentNode.style.removeProperty("bottom");
        }
        if (baseStyle?.maxHeight !== undefined) {
          contentNode.style.maxHeight = String(baseStyle.maxHeight);
        } else {
          contentNode.style.removeProperty("max-height");
        }
        hasAppliedKeyboardAdjustRef.current = false;
      };

      const syncViewportPosition = () => {
        rafId = null;
        const layoutHeight = window.innerHeight;
        if (layoutHeight <= 0 || vv.height <= 0) {
          restoreDrawerViewportStyles();
          return;
        }

        const scale = vv.scale && vv.scale > 0 ? vv.scale : 1;
        const visibleLayoutHeight = vv.height * scale;
        const heightReduction = Math.max(0, layoutHeight - visibleLayoutHeight);
        const hasKeyboardOverlay =
          heightReduction > KEYBOARD_OVERLAP_THRESHOLD_PX;

        if (!hasKeyboardOverlay) {
          restoreDrawerViewportStyles();
          return;
        }

        const active = document.activeElement;
        const isEditableInsideDrawer =
          active instanceof HTMLElement &&
          contentNode.contains(active) &&
          isTextEditableElement(active);

        if (!isEditableInsideDrawer && !hasAppliedKeyboardAdjustRef.current) {
          return;
        }

        const keyboardSpaceBelow = Math.max(
          0,
          layoutHeight - (vv.height + vv.offsetTop)
        );
        const maxAllowedHeight = Math.max(
          160,
          Math.floor(vv.height - VIEWPORT_TOP_GAP_PX)
        );

        contentNode.style.bottom = `${Math.round(keyboardSpaceBelow)}px`;
        contentNode.style.maxHeight = `${maxAllowedHeight}px`;
        hasAppliedKeyboardAdjustRef.current = true;

        if (isEditableInsideDrawer) {
          scrollFocusedFieldIntoNearestDrawerBody(contentNode, active);
        }
      };

      const scheduleSync = () => {
        if (rafId !== null) {
          window.cancelAnimationFrame(rafId);
        }
        rafId = window.requestAnimationFrame(syncViewportPosition);
      };

      vv.addEventListener("resize", scheduleSync);
      vv.addEventListener("scroll", scheduleSync);
      window.addEventListener("resize", scheduleSync);
      document.addEventListener("focusin", scheduleSync);
      document.addEventListener("focusout", scheduleSync);

      scheduleSync();

      return () => {
        if (rafId !== null) {
          window.cancelAnimationFrame(rafId);
        }
        vv.removeEventListener("resize", scheduleSync);
        vv.removeEventListener("scroll", scheduleSync);
        window.removeEventListener("resize", scheduleSync);
        document.removeEventListener("focusin", scheduleSync);
        document.removeEventListener("focusout", scheduleSync);
        restoreDrawerViewportStyles();
      };
    }, [contentNode, useVaulReposition]);

    return (
      <DrawerPortal>
        {!hideOverlay && <DrawerOverlay className={overlayClassName} />}
        <DrawerPrimitive.Content
          ref={composedRef}
          style={style}
          onPointerDownOutside={(e) => {
            if (
              e.target instanceof Element &&
              e.target.closest('[data-calculator-drawer="true"]')
            ) {
              e.preventDefault();
            }
            onPointerDownOutside?.(e);
          }}
          onInteractOutside={(e) => {
            if (
              e.target instanceof Element &&
              e.target.closest('[data-calculator-drawer="true"]')
            ) {
              e.preventDefault();
            }
            onInteractOutside?.(e);
          }}
          onFocusOutside={(e) => {
            if (
              e.target instanceof Element &&
              e.target.closest('[data-calculator-drawer="true"]')
            ) {
              e.preventDefault();
            }
            onFocusOutside?.(e);
          }}
          data-floating-surface="true"
          className={cn(
            "floating-surface fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-3xl border-t border-border text-foreground focus:outline-none overscroll-contain",
            className
          )}
          {...props}
        >
          <div className="mx-auto mt-3 h-1.5 w-12 shrink-0 rounded-full bg-muted-foreground/30" />
          {children}
        </DrawerPrimitive.Content>
      </DrawerPortal>
    );
  }
);
DrawerContent.displayName = "DrawerContent";

const DrawerHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "grid gap-1.5 border-b border-border p-4 text-left",
      className
    )}
    {...props}
  />
);
DrawerHeader.displayName = "DrawerHeader";

const DrawerFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "mt-auto flex flex-col gap-2 border-t border-border bg-muted/20 p-4",
      className
    )}
    {...props}
  />
);
DrawerFooter.displayName = "DrawerFooter";

const DrawerTitle = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Title
    ref={ref}
    className={cn(
      "text-sm font-semibold tracking-tight text-foreground",
      className
    )}
    {...props}
  />
));
DrawerTitle.displayName = DrawerPrimitive.Title.displayName;

const DrawerDescription = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Description
    ref={ref}
    className={cn("text-xs text-muted-foreground", className)}
    {...props}
  />
));
DrawerDescription.displayName = DrawerPrimitive.Description.displayName;

export {
  Drawer,
  DrawerNested,
  DrawerPortal,
  DrawerOverlay,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
};

