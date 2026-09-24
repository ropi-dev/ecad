export { capturePng } from "#/engine/capture-png";

export function downloadPng(blob: Blob, label: string) {
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = `${
		label
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "") || "drawing"
	}.png`;
	document.body.append(link);
	try {
		link.click();
	} finally {
		link.remove();
		// Let the browser start the download before releasing the blob URL.
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
}
