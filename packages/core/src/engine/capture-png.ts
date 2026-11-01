export function capturePng(
	source: HTMLCanvasElement | HTMLImageElement,
	options?: { width: number; height: number; background: string | null },
): Promise<Blob> {
	const canvas = document.createElement("canvas");
	canvas.width = options?.width ?? source.width;
	canvas.height = options?.height ?? source.height;
	const context = canvas.getContext("2d", { willReadFrequently: true });
	if (!context) throw new Error("Unable to create the PNG image.");
	if (options?.background !== null) {
		context.fillStyle = options?.background ?? "#111318";
		context.fillRect(0, 0, canvas.width, canvas.height);
	}
	context.drawImage(source, 0, 0, canvas.width, canvas.height);
	return new Promise((resolve, reject) => {
		canvas.toBlob((blob) => {
			if (blob) resolve(blob);
			else reject(new Error("Unable to encode the PNG image."));
		}, "image/png");
	});
}

export async function captureSvgPng(
	svg: string,
	width: number,
	height: number,
	background: string | null,
): Promise<Blob> {
	const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
	try {
		const image = new Image();
		image.src = url;
		await image.decode();
		return await capturePng(image, { width, height, background });
	} finally {
		URL.revokeObjectURL(url);
	}
}
