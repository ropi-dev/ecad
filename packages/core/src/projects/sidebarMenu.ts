import { useEffect } from "react";

// Shared styles for the dropdown menus opened from the file sidebar.
export const sidebarMenuContent =
	"ui-popover pointer-events-auto z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-52 overflow-y-auto p-1";
export const sidebarMenuItem = "ui-menu-item";
export const sidebarMenuLabel = "ui-section-label px-2 pt-2 pb-1";
export const sidebarMenuSeparator = "mx-1 my-1 h-px bg-line-subtle";

/**
 * Reports whether a sidebar control's menu or dialog is open. The sidebar
 * stays expanded meanwhile, because that content is portaled outside of it.
 */
export function useReportActive(
	active: boolean,
	onActiveChange: ((active: boolean) => void) | undefined,
) {
	useEffect(() => {
		onActiveChange?.(active);
	}, [active, onActiveChange]);
	useEffect(() => () => onActiveChange?.(false), [onActiveChange]);
}
