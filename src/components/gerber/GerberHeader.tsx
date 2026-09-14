export function GerberHeader({
	filename,
	loading,
	backend,
	onOpenFile,
}: {
	filename?: string;
	loading: boolean;
	backend: string;
	onOpenFile: (file: File) => void;
}) {
	return (
		<header className="file-bar">
			<input
				type="file"
				aria-label="Open Gerber file"
				onChange={(event) => {
					const file = event.target.files?.[0];
					if (file) onOpenFile(file);
					event.target.value = "";
				}}
			/>
			<span className="file-name">{loading ? "Reading file…" : filename}</span>

			<span className="renderer-label">{backend}</span>
		</header>
	);
}
