import { Plus } from "lucide-react";
import { ProjectLink } from "#/projects/ProjectLink.tsx";
import { useProject } from "#/projects/ProjectProvider.tsx";

export function GerberHeader({
	loading,
	onOpenFile,
}: {
	loading: boolean;
	onOpenFile: (files: File[]) => void;
}) {
	const project = useProject();
	return (
		<header className="absolute top-10 left-10 z-2 flex max-w-[calc(100%-5rem)] flex-wrap items-center gap-2 max-[600px]:top-9 max-[600px]:left-9">
			<ProjectLink
				href="/projects"
				className="inline-flex min-h-10 items-center rounded-lg border border-white/20 bg-slate-900 px-3 text-sm text-white/90 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-white"
			>
				Projects
			</ProjectLink>
			{!project && (
				<label className="relative inline-flex cursor-pointer items-center gap-[7px] rounded-lg border border-[#414955] bg-[#1b1e24ed] px-3 py-[9px] text-[12px] font-medium text-[#e8edf5] shadow-[0_4px_16px_#0003] hover:bg-[#303741] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#e8b77e]">
					<Plus size={16} /> {loading ? "Reading…" : "Add files"}
					<input
						type="file"
						className="absolute inset-0 size-full cursor-pointer opacity-0"
						multiple
						aria-label="Open Gerber file"
						onChange={(event) => {
							const files = Array.from(event.target.files ?? []);
							if (files.length) onOpenFile(files);
							event.target.value = "";
						}}
					/>
				</label>
			)}
			<ProjectLink
				href="/step"
				className="relative inline-flex cursor-pointer items-center gap-[7px] rounded-lg border border-[#414955] bg-[#1b1e24ed] px-3 py-[9px] text-[12px] font-medium text-[#e8edf5] shadow-[0_4px_16px_#0003] hover:bg-[#303741] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#e8b77e] no-underline focus-visible:outline-2 focus-visible:outline-amber-200"
			>
				STEP viewer
			</ProjectLink>
			<ProjectLink
				href="/editor"
				className="relative inline-flex cursor-pointer items-center gap-[7px] rounded-lg border border-[#414955] bg-[#1b1e24ed] px-3 py-[9px] text-[12px] font-medium text-[#e8edf5] shadow-[0_4px_16px_#0003] hover:bg-[#303741] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#e8b77e] no-underline focus-visible:outline-2 focus-visible:outline-amber-200"
			>
				2D editor
			</ProjectLink>
		</header>
	);
}
