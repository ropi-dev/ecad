export { capturePng } from "#/engine/capture-png.ts";

export function downloadPng(blob: Blob, label: string, extension = "png") {
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = `${
		label
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "") || "drawing"
	}.${extension}`;
	document.body.append(link);
	try {
		link.click();
	} finally {
		link.remove();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
}
