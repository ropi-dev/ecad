import { toastManager } from "#/components/ui/toast.ts";
import { assetFormat, fileSizeProblem } from "#/formats/import-limits.ts";
import type { AssetKind } from "#/projects/format.ts";

/**
 * Adds Gerber or STEP files to the project and reports the result in a toast.
 * Files over the size limit are reported without being read or stored.
 * Resolves to the number of files added and the problems with the rest, one
 * per line. It rejects when the project cannot store the files.
 */
export async function addProjectFiles(
	importAssets: (files: readonly File[], kind: AssetKind) => Promise<void>,
	files: readonly File[],
	kind: AssetKind,
): Promise<{ added: number; problems: string }> {
	const rejected: string[] = [];
	const accepted = files.filter((file) => {
		const reason = fileSizeProblem(assetFormat(file.name, kind), file.size);
		if (reason) rejected.push(`${file.name}: ${reason}`);
		return !reason;
	});
	if (accepted.length) await importAssets(accepted, kind);
	const problems = rejected.join("\n");
	if (rejected.length)
		toastManager.add({
			type: accepted.length ? "warning" : "error",
			title: accepted.length
				? "Files added with issues"
				: "Unable to add project files",
			description: problems,
		});
	else if (accepted.length)
		toastManager.add({
			type: "success",
			title: "Files added",
			description: `${accepted.length} file${accepted.length === 1 ? "" : "s"} added to the project.`,
		});
	return { added: accepted.length, problems };
}
