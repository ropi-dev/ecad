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
