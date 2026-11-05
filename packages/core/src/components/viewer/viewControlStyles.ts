/**
 * Shared look for floating editor and viewer toolbars. The colours follow the
 * project sidebar and popovers: dark panel, soft border, borderless buttons,
 * and the amber accent for the active tool or toggle.
 */
export const viewControlButtonClassName =
	"flex h-9 min-w-9 shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs text-[#c7d0dc] hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#e8b77e] disabled:pointer-events-none disabled:opacity-35 aria-expanded:bg-white/10 aria-expanded:text-white aria-pressed:bg-[#e8b77e1c] aria-pressed:text-[#e8b77e] aria-pressed:hover:bg-[#e8b77e30] data-[active=true]:bg-[#e8b77e1c] data-[active=true]:text-[#e8b77e] pointer-coarse:h-11 pointer-coarse:min-w-11";

/** Labeled row inside a toolbar group panel. */
export const toolbarMenuItemClassName =
	"flex h-8 w-full shrink-0 cursor-pointer items-center gap-2.5 whitespace-nowrap rounded-md pr-3 pl-2 text-left text-xs text-[#c7d0dc] hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#e8b77e] disabled:pointer-events-none disabled:opacity-35 aria-pressed:bg-[#e8b77e1c] aria-pressed:text-[#e8b77e] pointer-coarse:h-11";

export const toolbarSurfaceClassName =
	"rounded-lg border border-[#414955] bg-[#191c22f2] text-[#c7d0dc] shadow-[0_8px_32px_#0008]";
