import { Plus } from "lucide-react";

export function GerberHeader({
	filename,
	loading,
	backend,
	onOpenFile,
}: {
	filename?: string;
	loading: boolean;
	backend: string;
	onOpenFile: (files: File[]) => void;
}) {
	return (
		<header className="file-bar">
			<label className="add-gerber-files">
				<Plus size={16} /> Add Gerber files
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
			<span className="file-name">{loading ? "Reading file…" : filename}</span>

			<span className="renderer-label">{backend}</span>
		</header>
	);
}
