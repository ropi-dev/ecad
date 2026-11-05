import { Tooltip } from "radix-ui";
import { type ComponentProps, useState } from "react";
import { formatShortcut } from "#/components/viewer/shortcutModifier.ts";

export function TooltipButton({
	tooltip,
	shortcut,
	...props
}: Omit<ComponentProps<"button">, "title"> & {
	tooltip: string;
	shortcut?: string;
}) {
	const [open, setOpen] = useState(false);
	return (
		<Tooltip.Root
			open={open}
			onOpenChange={(next) => {
				// Focus moved back here by code, not by the user: skip the tooltip.
				if (
					next &&
					document.activeElement instanceof HTMLElement &&
					document.activeElement.dataset.quietFocus === "true"
				)
					return;
				setOpen(next);
			}}
		>
			<Tooltip.Trigger asChild>
				<button type="button" {...props} />
			</Tooltip.Trigger>
			<Tooltip.Portal>
				<Tooltip.Content
					data-slot="toolbar-tooltip"
					side="top"
					sideOffset={10}
					collisionPadding={12}
					className="z-60 max-w-[min(18rem,calc(100vw-1.5rem))] rounded-md border border-[#414955] bg-[#222731] px-3 py-2 text-xs leading-relaxed text-[#e8edf5] shadow-[0_4px_16px_#0006]"
				>
					<span className="flex items-center gap-3">
						<span>{tooltip}</span>
						{shortcut && (
							<kbd className="shrink-0 rounded border border-white/15 bg-white/5 px-1.5 py-0.5 font-sans text-[10px] text-[#b7c1cf]">
								{formatShortcut(shortcut)}
							</kbd>
						)}
					</span>
					<Tooltip.Arrow className="fill-[#222731]" width={10} height={5} />
				</Tooltip.Content>
			</Tooltip.Portal>
		</Tooltip.Root>
	);
}
