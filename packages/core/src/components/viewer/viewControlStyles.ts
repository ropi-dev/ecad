/**
 * Shared look for the floating toolbars. Buttons are borderless on the dock's
 * panel surface; the active tool or toggle carries the accent, which eases in
 * and out (see `.ui-toggle`).
 */
export const viewControlButtonClassName =
	"ui-toggle ui-toggle-underline relative flex h-9 min-w-9 shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs font-medium focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none pointer-coarse:h-11 pointer-coarse:min-w-11";

/** The dock itself and other chrome floating on a canvas. */
export const toolbarSurfaceClassName = "ui-panel";

/** Panels opened from the dock. */
export const toolbarPopoverClassName = "ui-popover";

/** Small square button for a panel header, such as Close. */
export const panelIconButtonClassName =
	"grid size-7 shrink-0 cursor-pointer place-items-center rounded-md text-fg-faint hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:text-fg-disabled pointer-coarse:size-11";
