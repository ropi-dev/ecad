import { Plus } from "lucide-react";

export function GerberHeader({
	loading,
	onOpenFile,
}: {
	loading: boolean;
	onOpenFile: (files: File[]) => void;
}) {
	return (
		<header className="file-bar">
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
		</header>
	);
}
