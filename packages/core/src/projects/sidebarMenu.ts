import { useEffect } from "react";

// Shared styles for the dropdown menus opened from the file sidebar.
export const sidebarMenuContent =
	"pointer-events-auto z-50 min-w-48 max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto rounded-lg border border-[#414955] bg-[#191c22] p-1 text-[#c7d0dc] shadow-[0_8px_32px_#0008]";
export const sidebarMenuItem =
	"flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-xs outline-none data-[highlighted]:bg-white/10 data-[highlighted]:text-white data-[disabled]:pointer-events-none data-[disabled]:opacity-40";
export const sidebarMenuLabel =
	"px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-[#7d8899]";
export const sidebarMenuSeparator = "my-1 h-px bg-white/10";

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
