/** Copy the freshly rendered frame before WebGL discards its drawing buffer. */
export function capturePng(source: HTMLCanvasElement): Promise<Blob> {
	const canvas = document.createElement("canvas");
	canvas.width = source.width;
	canvas.height = source.height;
	const context = canvas.getContext("2d");
	if (!context) throw new Error("Unable to create the PNG image.");
	// Match the workspace background so light geometry remains visible in image viewers.
	context.fillStyle = "#111318";
	context.fillRect(0, 0, canvas.width, canvas.height);
	context.drawImage(source, 0, 0);
	return new Promise((resolve, reject) => {
		canvas.toBlob((blob) => {
			if (blob) resolve(blob);
			else reject(new Error("Unable to encode the PNG image."));
		}, "image/png");
	});
}

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
