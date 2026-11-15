type Path = [number, number][];
interface Box {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

function winding(path: Path, x: number, y: number) {
	let turns = 0;
	for (let index = 0; index < path.length; index++) {
		const [ax, ay] = path[index];
		const [bx, by] = path[(index + 1) % path.length];
		if (ay <= y === by <= y) continue;
		const side = (bx - ax) * (y - ay) - (x - ax) * (by - ay);
		if (by > ay ? side > 0 : side < 0) turns += by > ay ? 1 : -1;
	}
	return turns;
}

export function createFakeCanvas() {
	const reads: { width: number; height: number }[] = [];
	const canvas = {
		width: 0,
		height: 0,
		reads,
		getContext() {
			const pixels = new Uint8ClampedArray(canvas.width * canvas.height * 4);
			const whole = (): Box => ({
				left: 0,
				top: 0,
				right: canvas.width,
				bottom: canvas.height,
			});
			let paths: Path[] = [];
			let clip = whole();
			const saved: Box[] = [];
			const each = (
				box: Box,
				visit: (offset: number, x: number, y: number) => void,
			) => {
				for (
					let y = Math.max(clip.top, Math.floor(box.top));
					y < Math.min(clip.bottom, Math.ceil(box.bottom));
					y++
				)
					for (
						let x = Math.max(clip.left, Math.floor(box.left));
						x < Math.min(clip.right, Math.ceil(box.right));
						x++
					)
						visit((y * canvas.width + x) * 4, x + 0.5, y + 0.5);
			};
			return {
				fillStyle: "",
				save: () => saved.push(clip),
				restore: () => {
					clip = saved.pop() ?? whole();
				},
				beginPath: () => {
					paths = [];
				},
				moveTo: (x: number, y: number) => paths.push([[x, y]]),
				lineTo: (x: number, y: number) => paths.at(-1)?.push([x, y]),
				rect: (x: number, y: number, width: number, height: number) =>
					paths.push([
						[x, y],
						[x + width, y],
						[x + width, y + height],
						[x, y + height],
					]),
				clip: () => {
					const [[left, top], , [right, bottom]] = paths[0];
					clip = { left, top, right, bottom };
				},
				clearRect: (x: number, y: number, width: number, height: number) =>
					each(
						{ left: x, top: y, right: x + width, bottom: y + height },
						(offset) => pixels.fill(0, offset, offset + 4),
					),
				fill: () => {
					const turns = new Int16Array(canvas.width * canvas.height);
					for (const path of paths) {
						const xs = path.map(([x]) => x);
						const ys = path.map(([, y]) => y);
						each(
							{
								left: Math.min(...xs),
								top: Math.min(...ys),
								right: Math.max(...xs),
								bottom: Math.max(...ys),
							},
							(offset, x, y) => {
								turns[offset / 4] += winding(path, x, y);
							},
						);
					}
					turns.forEach((count, pixel) => {
						if (count) pixels.fill(255, pixel * 4, pixel * 4 + 4);
					});
				},
				getImageData: (x: number, y: number, width: number, height: number) => {
					reads.push({ width, height });
					const data = new Uint8ClampedArray(width * height * 4);
					for (let row = 0; row < height; row++)
						data.set(
							pixels.subarray(
								((y + row) * canvas.width + x) * 4,
								((y + row) * canvas.width + x + width) * 4,
							),
							row * width * 4,
						);
					return { data };
				},
			};
		},
	};
	return canvas;
}
