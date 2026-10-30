import { CircuitBoard, ListTree } from "lucide-react";
import { useState } from "react";
import { TooltipButton } from "#/components/viewer/TooltipButton.tsx";
import { viewControlButtonClassName } from "#/components/viewer/viewControlStyles.ts";
import { useProject } from "#/projects/ProjectProvider.tsx";

export function EditorViewSwitch({ view }: { view: "circuit" | "schematic" }) {
	const project = useProject();
	const [switching, setSwitching] = useState(false);
	if (!project?.project) return null;
	const target = view === "circuit" ? "schematic" : "circuit";
	const label =
		target === "circuit"
			? "Switch to circuit view"
			: "Switch to schematic view";
	const Icon = target === "circuit" ? ListTree : CircuitBoard;
	return (
		<TooltipButton
			aria-label={label}
			tooltip={label}
			data-view={target}
			disabled={switching || project.busy}
			className={`${viewControlButtonClassName} ml-1 data-[view=circuit]:border-[#6ebd8e] data-[view=circuit]:bg-[#6ebd8e1c] data-[view=circuit]:text-[#83d6a4] data-[view=circuit]:hover:bg-[#6ebd8e30] data-[view=schematic]:border-[#b88f61] data-[view=schematic]:bg-[#e8b77e1c] data-[view=schematic]:text-[#e8b77e] data-[view=schematic]:hover:bg-[#e8b77e30]`}
			onClick={() => {
				setSwitching(true);
				void project
					.switchEditorView(target)
					.finally(() => setSwitching(false));
			}}
		>
			<Icon size={18} aria-hidden="true" />
		</TooltipButton>
	);
}
