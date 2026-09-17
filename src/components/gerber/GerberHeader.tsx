import { Plus } from "lucide-react";

export function GerberHeader({
	loading,
	onOpenFile,
}: {
	loading: boolean;
	onOpenFile: (files: File[]) => void;
}) {
	return (
		<header className="file-bar flex items-center gap-2">
			<label className="add-gerber-files">
				<Plus size={16} /> {loading ? "Reading…" : "Add files"}
				<input
					type="file"
					multiple
					aria-label="Open Gerber file"
					onChange={(event) => {
						const files = Array.from(event.target.files ?? []);
						if (files.length) onOpenFile(files);
						event.target.value = "";
					}}
				/>
			</label>
			<a
				href="/step"
				className="add-gerber-files no-underline focus-visible:outline-2 focus-visible:outline-amber-200"
			>
				STEP viewer
			</a>
			<a
				href="/editor"
				className="add-gerber-files no-underline focus-visible:outline-2 focus-visible:outline-amber-200"
			>
				2D editor
			</a>
		</header>
	);
}
