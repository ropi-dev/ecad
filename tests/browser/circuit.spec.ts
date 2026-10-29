import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { closeProjectFiles, openProjectFiles } from "./project-files";
import { toolbarButton } from "./toolbar";

const state = async (page: Page) => JSON.parse(await page.locator("#circuit-document").textContent() ?? "{}");
async function placeComponent(page: Page, name: string, position = {x:350,y:250}) {
 await page.getByRole("button", {name:"Components",exact:true}).click();
 await page.getByRole("searchbox", {name:"Search components",exact:true}).fill(name);
 await page.getByRole("button", {name:`Place ${name}`,exact:true}).click();
 await page.getByLabel("Circuit connections graph", {exact:true}).click({position});
}
async function createCircuit(page: Page) {
	await page.goto("/tests/browser/projects.html");
	await page.getByLabel("Project name", { exact: true }).fill("Graph project");
	await page.getByRole("button", { name: "Create project", exact: true }).click();
	await expect(page.getByLabel("Project save status")).toHaveText("Saved");
	await openProjectFiles(page);
	await page.getByRole("button", { name: "Add file", exact: true }).click();
	await page.getByRole("menuitem", { name: "New circuit", exact: true }).click();
	await page.getByLabel("Circuit name", { exact: true }).fill("LED driver");
	await page.getByRole("button", { name: "Create circuit", exact: true }).click();
	await expect(page.getByRole("heading", { name: "LED driver", exact: true })).toBeAttached();
	await closeProjectFiles(page);
}

test("Untangle separates overlapping components and presentation changes never enter saved circuit files", async ({ page }) => {
	await createCircuit(page);
	await page.getByRole("button",{name:"Add LED example",exact:true}).click();
	await expect(page.getByLabel("Circuit save status")).toHaveText("Saved");
	async function savedFiles() {
		return page.evaluate(async()=>{
			const root=await navigator.storage.getDirectory();
			const project=await root.getDirectoryHandle("Graph project");
			const files:Record<string,string>={};
			async function read(directory:FileSystemDirectoryHandle,prefix:string) {
				for await(const [name,handle] of directory as unknown as AsyncIterable<[string,FileSystemHandle]>) {
					if(handle.kind==="directory") await read(handle as FileSystemDirectoryHandle,`${prefix}${name}/`);
					else files[`${prefix}${name}`]=await (await (handle as FileSystemFileHandle).getFile()).text();
				}
			}
			await read(project,"");return files;
		});
	}
	const files=await savedFiles();
	expect(Object.keys(files).some(path=>path.endsWith(".ecadgraph"))).toBe(false);
	expect(files[".ecadprj"]).not.toMatch(/^graph\s*=/m);
	for(const [path,content] of Object.entries(files)) if(path.endsWith(".ecadcircuit")) {
		expect(JSON.parse(content)).not.toHaveProperty("positions");
		expect(JSON.parse(content)).not.toHaveProperty("graph");
		expect(JSON.parse(content)).not.toHaveProperty("collapsedComponentIds");
	}
	const original=await state(page);
	const from=await page.getByRole("button",{name:"Select component R1",exact:true}).boundingBox();
	const to=await page.getByRole("button",{name:"Select component D1",exact:true}).boundingBox();
	if(!from||!to) throw new Error("Missing component headers.");
	await page.mouse.move(from.x+20,from.y+12);await page.mouse.down();
	await page.mouse.move(to.x+20,to.y+12,{steps:6});await page.mouse.up();
	const tangled=await state(page);
	expect(tangled.circuit).toEqual(original.circuit);
	await expect(page.getByLabel("Circuit save status")).toHaveText("Saved");
	await mkdir(resolve("test-results/screenshots"),{recursive:true});
	await page.screenshot({path:resolve("test-results/screenshots/circuit-tangled.png"),fullPage:true});
	await page.getByRole("button",{name:"Untangle",exact:true}).click();
	const untangled=await state(page);
	expect(untangled.circuit).toEqual(original.circuit);
	expect(untangled.graph.positions).not.toEqual(tangled.graph.positions);
	const boxes=await page.locator(".circuit-component-body").evaluateAll(elements=>elements.map(element=>{const box=element.getBoundingClientRect();return {x:box.x,y:box.y,right:box.right,bottom:box.bottom};}));
	for(let a=0;a<boxes.length;a++) for(let b=a+1;b<boxes.length;b++) expect(boxes[a].x<boxes[b].right&&boxes[a].right>boxes[b].x&&boxes[a].y<boxes[b].bottom&&boxes[a].bottom>boxes[b].y).toBe(false);
	await page.screenshot({path:resolve("test-results/screenshots/circuit-untangled.png"),fullPage:true});
	await page.keyboard.press("Control+z");expect(await state(page)).toEqual(tangled);
	await page.keyboard.press("Control+Shift+z");expect(await state(page)).toEqual(untangled);
	await page.getByRole("button",{name:"Collapse R1",exact:true}).click();
	await page.getByRole("button",{name:"Select component R1",exact:true}).press("ArrowDown");
	const temporary=await state(page);
	await expect(page.getByLabel("Circuit save status")).toHaveText("Saved");
	await page.waitForTimeout(650);
	expect(await savedFiles()).toEqual(files);
	await page.reload();
	await (await openProjectFiles(page)).getByRole("link",{name:"Open LED driver",exact:true}).click();
	const regenerated=await state(page);
	expect(regenerated.circuit).toEqual(original.circuit);
	expect(regenerated.graph.positions).not.toEqual(temporary.graph.positions);
	expect(regenerated.graph.collapsedComponentIds).toBeUndefined();
	await page.reload();
	await (await openProjectFiles(page)).getByRole("link",{name:"Open LED driver",exact:true}).click();
	expect(await state(page)).toEqual(regenerated);
});

test("circuit graph edits connectivity, preserves it through layout moves, and reloads electrical data", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await createCircuit(page);
	await page.getByRole("button", { name: "Add LED example", exact: true }).click();
	await expect(page.getByRole("button", { name: "Net GND", exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "Select component D2", exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "Net LED2_DRIVE", exact: true })).toBeVisible();
	const canvas = page.getByLabel("Circuit connections graph", {exact:true});
	const canvasBox = await canvas.boundingBox();
	const editorBox = await page.getByRole("region", {name:"Circuit editor",exact:true}).boundingBox();
	expect(canvasBox?.y).toBe(editorBox?.y);
	expect(canvasBox?.width).toBe(editorBox?.width);
	expect(canvasBox?.height).toBe(editorBox?.height);
	await expect(page.locator(".circuit-header, .circuit-toolbar")).toHaveCount(0);
	const original = await state(page);
	const initialView = await canvas.getAttribute("viewBox");
	await page.getByRole("button", {name:"Pan",exact:true}).click();
	await page.mouse.move(canvasBox!.x + 20,canvasBox!.y + 20);
	await page.mouse.down();
	await page.mouse.move(canvasBox!.x + 80,canvasBox!.y + 60,{steps:4});
	await page.mouse.up();
	await expect(canvas).not.toHaveAttribute("viewBox",initialView!);
	expect(await state(page)).toEqual(original);
	await page.mouse.move(canvasBox!.x + 80,canvasBox!.y + 60);
	await page.mouse.down();
	await page.mouse.move(canvasBox!.x + 20,canvasBox!.y + 20,{steps:4});
	await page.mouse.up();
	await page.getByRole("button", {name:"Select",exact:true}).click();
	const component = page.getByRole("button", { name: "Select component R1", exact: true });
	await component.focus();
	await component.press("ArrowDown");
	await expect.poll(async () => (await state(page)).graph).not.toEqual(original.graph);
	expect((await state(page)).circuit).toEqual(original.circuit);
	await (await toolbarButton(page, "Undo")).click();
	expect((await state(page)).graph).toEqual(original.graph);
	await (await toolbarButton(page, "Redo")).click();
	const box = await component.boundingBox();
	if (!box) throw new Error("Missing component bounds.");
	await page.mouse.move(box.x + box.width / 2, box.y + 12);
	await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 35, box.y + 42, { steps: 4 }); await page.mouse.up();
	expect((await state(page)).circuit).toEqual(original.circuit);
	await expect(page.getByRole("complementary", { name: "Circuit inspector" })).toHaveCount(0);
	await page.getByRole("button", { name: "Net GND", exact: true }).dblclick();
	await page.getByRole("textbox", { name: "Net name", exact: true }).fill("GROUND");
	await page.getByRole("button",{name:"Add alias",exact:true}).click();
	await page.getByRole("textbox",{name:"Net alias 1",exact:true}).fill("GND");
	await page.getByRole("textbox", { name: "Net name", exact: true }).press("Enter");
	await expect(page.getByRole("button", { name: "Net GROUND", exact: true })).toBeVisible();
	await expect(page.getByLabel("Circuit save status")).toHaveText("Saved");
	const saved = await state(page);
	await mkdir(resolve("test-results/screenshots"), { recursive: true });
	await page.screenshot({ path: resolve("test-results/screenshots/circuit-editor.png"), fullPage: true });
	await page.reload();
	await (await openProjectFiles(page)).getByRole("link", { name: "Open LED driver", exact: true }).click();
	await expect(page.getByRole("button", { name: "Net GROUND", exact: true })).toBeVisible();
	expect((await state(page)).circuit).toEqual(saved.circuit);
	expect(errors).toEqual([]);
});

test("graph navigation supports zoom shortcuts, cursor-centered gestures, and scrolling without editing the circuit", async ({ page }) => {
	await createCircuit(page);
	await page.getByRole("button", { name: "Add LED example", exact: true }).click();
	const original = await state(page);
	const canvas = page.getByLabel("Circuit connections graph", { exact: true });
	const view = () => canvas.evaluate((element: SVGSVGElement) => {
		const { x, y, width, height } = element.viewBox.baseVal;
		return { x, y, width, height };
	});
	const initial = await view();
	const zoomIn = page.getByRole("button", { name: "Zoom in", exact: true });
	const zoomOut = page.getByRole("button", { name: "Zoom out", exact: true });
	await zoomIn.click();
	expect((await view()).width).toBeCloseTo(initial.width / 1.25);
	await zoomOut.click();
	expect(await view()).toEqual(initial);
	await canvas.click({ position: { x: 20, y: 20 } });
	await expect(canvas).toBeFocused();
	for (const key of ["=", "+"]) {
		const before = await view();
		await page.keyboard.press(key);
		expect((await view()).width).toBeCloseTo(before.width / 1.25);
	}
	await page.keyboard.press("-");
	expect((await view()).width).toBeCloseTo(initial.width / 1.25);
	const box = await canvas.boundingBox();
	if (!box) throw new Error("Missing graph bounds.");
	const cursor = { x: Math.round(box.x + box.width * 0.37), y: Math.round(box.y + box.height * 0.38) };
	const worldAtCursor = () => canvas.evaluate((element: SVGSVGElement, cursor) => {
		const point = new DOMPoint(cursor.x, cursor.y).matrixTransform(element.getScreenCTM()!.inverse());
		return { x: point.x, y: point.y };
	}, cursor);
	const anchor = await worldAtCursor();
	const beforePinch = await view();
	await page.mouse.move(cursor.x, cursor.y);
	await page.keyboard.down("Control");
	await page.mouse.wheel(0, -80);
	await page.keyboard.up("Control");
	await expect.poll(async () => (await view()).width).toBeLessThan(beforePinch.width);
	const afterAnchor = await worldAtCursor();
	expect(afterAnchor.x).toBeCloseTo(anchor.x, 3);
	expect(afterAnchor.y).toBeCloseTo(anchor.y, 3);
	const beforePan = await view();
	await page.mouse.wheel(70, 90);
	await expect.poll(async () => (await view()).x).toBeGreaterThan(beforePan.x);
	expect((await view()).y).toBeGreaterThan(beforePan.y);
	expect((await view()).width).toBe(beforePan.width);
	const gestureAnchor = await worldAtCursor();
	await canvas.evaluate((element, cursor) => {
		for (const [type, scale] of [["gesturestart", 1], ["gesturechange", 1.5], ["gestureend", 1.5]] as const) {
			const event = Object.assign(new Event(type, { cancelable: true }), { scale, clientX: cursor.x, clientY: cursor.y });
			element.dispatchEvent(event);
		}
	}, cursor);
	expect((await view()).width).toBeCloseTo(beforePan.width / 1.5);
	const afterGestureAnchor = await worldAtCursor();
	expect(afterGestureAnchor.x).toBeCloseTo(gestureAnchor.x, 3);
	expect(afterGestureAnchor.y).toBeCloseTo(gestureAnchor.y, 3);
	await page.keyboard.press("F6");
	const fitted = await view();
	expect(fitted.width).toBeCloseTo(box.width);
	expect(fitted.height).toBeCloseTo(box.height);
	expect(await canvas.evaluate((element:SVGSVGElement)=>element.getScreenCTM()!.a)).toBeCloseTo(1,6);
	await expect(page.getByRole("button", { name: "Fit graph", exact: true })).toHaveText("100%");
	await page.keyboard.press("+");
	await page.keyboard.press("0");
	expect(await view()).toEqual(fitted);
	await page.keyboard.press("+");
	await page.keyboard.press("f");
	expect(await view()).toEqual(fitted);
	await page.getByRole("button", { name: "Net GND", exact: true }).dblclick();
	const names = page.getByRole("textbox", { name: "Net name", exact: true });
	await names.focus();
	const beforeTyping = await view();
	await names.press("+");
	await names.press("-");
	await names.press("0");
	expect(await view()).toEqual(beforeTyping);
	await names.press("Escape");
	await canvas.click({ position: { x: 20, y: 20 } });
	for (let index = 0; index < 35; index++) await page.keyboard.press("+");
	await expect(zoomIn).toBeDisabled();
	const maximum = await view();
	await page.keyboard.press("+");
	expect(await view()).toEqual(maximum);
	for (let index = 0; index < 35; index++) await page.keyboard.press("-");
	await expect(zoomOut).toBeDisabled();
	const minimum = await view();
	await page.keyboard.press("-");
	expect(await view()).toEqual(minimum);
	await page.keyboard.press("F6");
	expect(await state(page)).toEqual(original);
	await expect(page.getByLabel("Circuit save status")).toHaveText("Saved");
	await mkdir(resolve("test-results/screenshots"), { recursive: true });
	await page.screenshot({ path: resolve("test-results/screenshots/circuit-zoom-controls.png"), fullPage: true });
});

test("the graph grid follows panning, zooming, and viewport resizing", async ({ page }) => {
	async function differentPixels(first: Buffer, second: Buffer) {
		return page.evaluate(async (images) => {
			const pixels = await Promise.all(images.map(async (encoded) => {
				const image = new Image();
				image.src = `data:image/png;base64,${encoded}`;
				await image.decode();
				const canvas = document.createElement("canvas");
				canvas.width = image.width;
				canvas.height = image.height;
				const context = canvas.getContext("2d")!;
				context.drawImage(image, 0, 0);
				return context.getImageData(0, 0, image.width, image.height).data;
			}));
			let different = 0;
			for (let index = 0; index < pixels[0].length; index += 4) {
				if ([0, 1, 2].some(channel => Math.abs(pixels[0][index + channel] - pixels[1][index + channel]) > 2)) different++;
			}
			return different;
		}, [first.toString("base64"), second.toString("base64")]);
	}
	await createCircuit(page);
	const original = await state(page);
	const canvas = page.getByLabel("Circuit connections graph", { exact: true });
	const box = await canvas.boundingBox();
	if (!box) throw new Error("Missing graph bounds.");
	const clip = { x: box.x + 100, y: box.y + 60, width: 120, height: 80 };
	const initial = await page.screenshot({ clip });
	await page.getByRole("button", { name: "Pan", exact: true }).click();
	await page.mouse.move(box.x + 600, box.y + 80);
	await page.mouse.down();
	await page.mouse.move(box.x + 637, box.y + 103, { steps: 4 });
	await page.mouse.up();
	const translated = await page.screenshot({ clip: { ...clip, x: clip.x + 37, y: clip.y + 23 } });
	expect(await differentPixels(translated, initial)).toBe(0);
	const beforeZoom = await page.screenshot({ clip });
	await page.getByRole("button", { name: "Zoom in", exact: true }).click();
	const zoomed = await page.screenshot({ clip });
	expect(await differentPixels(zoomed, beforeZoom)).toBeGreaterThan(50);
	await page.setViewportSize({ width: 1280, height: 1000 });
	const phase = await canvas.evaluate((element:SVGSVGElement) => {
		const origin = new DOMPoint(0,0).matrixTransform(element.getScreenCTM()!);
		const bounds = element.parentElement!.getBoundingClientRect();
		const style = getComputedStyle(element.parentElement!);
		const spacing = Number.parseFloat(style.backgroundSize);
		const offsets = style.backgroundPosition.split(" ").map(Number.parseFloat);
		return {x:(origin.x-bounds.x-offsets[0]-spacing/2)/spacing,y:(origin.y-bounds.y-offsets[1]-spacing/2)/spacing};
	});
	expect(phase.x).toBeCloseTo(Math.round(phase.x),3);
	expect(phase.y).toBeCloseTo(Math.round(phase.y),3);
	expect(await state(page)).toEqual(original);
	await page.getByRole("button", { name: "Select", exact: true }).click();
	await page.getByRole("button", { name: "Add LED example", exact: true }).click();
	await expect(page.getByLabel("Circuit save status")).toHaveText("Saved");
	await page.setViewportSize({ width: 1280, height: 720 });
	await page.getByRole("button", { name: "Fit graph", exact: true }).click();
	await mkdir(resolve("test-results/screenshots"), { recursive: true });
	await page.screenshot({ path: resolve("test-results/screenshots/circuit-grid-pan-zoom.png"), fullPage: true });
});

test("connecting, splitting and no-connect edits autosave without file actions", async ({ page }) => {
	await createCircuit(page);
	await page.getByRole("button", { name: "Add LED example", exact: true }).click();
	await page.getByRole("button", { name: "Connect pins", exact: true }).click();
	await page.getByRole("button", { name: "Pin J1.1", exact: true }).locator("circle").click();
	await page.getByRole("button", { name: "Pin R1.2", exact: true }).locator("circle").click();
	await expect.poll(async () => (await state(page)).circuit.nets.length).toBe(3);
	await page.getByRole("button", { name: "Connection R1.2", exact: true }).press("Enter");
	await page.getByRole("button", { name: "Connection D1.A", exact: true }).press("Shift+Enter");
	await page.getByRole("button", { name: "Connection D1.A", exact: true }).dispatchEvent("contextmenu", { clientX: 600, clientY: 300 });
	await page.getByRole("menuitem", { name: "Split net", exact: true }).click();
	await expect.poll(async () => (await state(page)).circuit.nets.length).toBe(4);
	await page.getByRole("button", { name: "Pin D1.K", exact: true }).click({ button: "right" });
	await page.getByRole("menuitem", { name: "No connect", exact: true }).click();
	await expect.poll(async () => (await state(page)).circuit.noConnectPinIds.length).toBe(1);
	await expect(page.getByLabel("Circuit save status")).toHaveText("Saved");
	await expect(page.getByRole("button", { name: "File tools", exact: true })).toHaveCount(0);
	await expect(page.getByRole("button", { name: /^(Save|Export circuit|Export layout)$/ })).toHaveCount(0);
	await expect(page.getByLabel("Import circuit and optional layout")).toHaveCount(0);
	await page.setViewportSize({ width: 390, height: 844 });
	await page.keyboard.press("Escape");
	await page.screenshot({ path: resolve("test-results/screenshots/circuit-editor-mobile.png"), fullPage: true });
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

async function pinCenter(page: Page, name: string) {
	const box = await page.getByRole("button", { name: `Pin ${name}`, exact: true }).locator("circle").boundingBox();
	if (!box) throw new Error(`Missing pin ${name}.`);
	return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test("large components animate collapse to one shared endpoint and preserve undo", async ({ page }) => {
	await createCircuit(page);
	await placeComponent(page,"RP2040",{x:650,y:350});
	for(let index=0;index<5;index++) await page.getByRole("button",{name:"Zoom out",exact:true}).click();
	const component = (await state(page)).circuit.components[0];
	expect(component.pins).toHaveLength(57);
	await expect(page.locator(".circuit-pin")).toHaveCount(57);
	await page.getByRole("button",{name:"Add net",exact:true}).click();
	await page.getByLabel("Circuit connections graph",{exact:true}).click({position:{x:350,y:330}});
	await page.getByRole("textbox",{name:"Net name",exact:true}).fill("GND");
	await page.getByRole("textbox",{name:"Net name",exact:true}).press("Enter");
	const from = await pinCenter(page,"U1.57");
	const target = await page.getByRole("button",{name:"Net GND",exact:true}).locator("circle").boundingBox();
	if (!target) throw new Error("Missing GND node.");
	await page.mouse.move(from.x,from.y);await page.mouse.down();
	await page.mouse.move(target.x+target.width/2,target.y+target.height/2,{steps:6});await page.mouse.up();
	const second = await pinCenter(page,"U1.43");
	await page.mouse.move(second.x,second.y);await page.mouse.down();
	await page.mouse.move(target.x+target.width/2,target.y+target.height/2,{steps:6});await page.mouse.up();
	const expanded = await state(page);
	const card = page.locator(".circuit-component-body");
	const footer = page.locator(".circuit-collapse-footer");
	const cardBox = await card.boundingBox(), footerBox = await footer.boundingBox();
	if(!cardBox || !footerBox) throw new Error("Missing component footer.");
	expect(footerBox.y).toBeGreaterThan(cardBox.y+cardBox.height*0.9);
	await page.getByRole("button",{name:"Collapse U1",exact:true}).evaluate(button=>(button as HTMLButtonElement).click());
	const motion = await page.evaluate(()=>({
		height:document.querySelector(".circuit-component-body")?.getAnimations().some(animation=>animation.playState==="running"),
		wires:[...document.querySelectorAll(".circuit-edge")].some(path=>path.getAnimations().some(animation=>animation.playState==="running"))
	}));
	expect(motion.height).toBe(true);
	expect(motion.wires).toBe(true);
	await expect.poll(()=>card.evaluate(element=>Number.parseFloat(getComputedStyle(element).height))).toBe(84);
	const endpoints = await page.locator(".circuit-edge").evaluateAll(paths=>paths.map(path=>{
		const point=(path as SVGPathElement).getPointAtLength(0);return {x:point.x,y:point.y};
	}));
	expect(endpoints).toHaveLength(2);
	expect(endpoints[0]).toEqual(endpoints[1]);
	await expect(page.getByRole("button",{name:"Expand U1",exact:true})).toHaveAttribute("aria-expanded","false");
	await expect(page.locator(".circuit-pin")).toHaveCount(0);
	await expect(page.getByRole("button",{name:"Pin U1.57",exact:true})).toHaveCount(0);
	await expect(page.getByRole("button",{name:"Connection U1.57",exact:true})).toBeAttached();
	await expect(page.getByRole("button",{name:"Pin U1.43",exact:true})).toHaveCount(0);
	await expect(page.locator(".circuit-hidden-pins")).toHaveCount(0);
	await expect(page.locator(".circuit-component-body")).toHaveAttribute("height","84");
	const compact = await state(page);
	expect(compact.circuit).toEqual(expanded.circuit);
	expect(compact.graph.positions).toEqual(expanded.graph.positions);
	expect(compact.graph.collapsedComponentIds).toEqual([component.id]);
	await page.keyboard.press("Control+z");
	expect(await state(page)).toEqual(expanded);
	await expect(page.locator(".circuit-pin")).toHaveCount(57);
	await page.keyboard.press("Control+Shift+z");
	expect(await state(page)).toEqual(compact);
	await expect(page.locator(".circuit-canvas.is-collapsing")).toHaveCount(0);
	await (await toolbarButton(page,"Untangle")).click();
	await page.getByRole("button",{name:"Fit graph",exact:true}).click();
	await expect(page.getByLabel("Circuit save status")).toHaveText("Saved");
	const arranged = await state(page);
	await mkdir(resolve("test-results/screenshots"),{recursive:true});
	await page.screenshot({path:resolve("test-results/screenshots/circuit-collapsed-component.png"),fullPage:true});
	await page.reload();
	await (await openProjectFiles(page)).getByRole("link",{name:"Open LED driver",exact:true}).click();
	await closeProjectFiles(page);
	expect((await state(page)).circuit).toEqual(arranged.circuit);
	await expect(page.locator(".circuit-pin")).toHaveCount(57);
	await page.getByRole("button",{name:"Collapse U1",exact:true}).click();
	await expect(page.locator(".circuit-pin")).toHaveCount(0);
	const connection = page.getByRole("button",{name:"Connection U1.57",exact:true});
	await connection.press("Enter");await page.keyboard.press("Delete");
	await expect(page.locator(".circuit-pin")).toHaveCount(0);
	await expect(page.getByRole("button",{name:"Connection U1.43",exact:true})).toBeAttached();
	await expect(page.locator(".circuit-hidden-pins")).toHaveCount(0);
	await page.getByRole("button",{name:"Expand U1",exact:true}).press("Enter");
	await expect(page.locator(".circuit-pin")).toHaveCount(57);
	expect((await state(page)).circuit.components[0].pins).toEqual(component.pins);
	await page.emulateMedia({reducedMotion:"reduce"});
	await page.getByRole("button",{name:"Collapse U1",exact:true}).click();
	expect(await card.evaluate(element=>({height:getComputedStyle(element).height,animations:element.getAnimations().length}))).toEqual({height:"84px",animations:0});
});

async function dragPins(page: Page, source: string, target: string) {
	const from = await pinCenter(page, source);
	const to = await pinCenter(page, target);
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(to.x, to.y, { steps: 6 });
}

async function connectionPoint(page: Page, pin: string) {
	return page.getByRole("button", { name: `Connection ${pin}`, exact: true }).locator(".circuit-edge").evaluate((path: SVGPathElement) => {
		const point = path.getPointAtLength(path.getTotalLength() * 0.4).matrixTransform(path.getScreenCTM()!);
		return { x: point.x, y: point.y };
	});
}

test("a standalone GND net accepts pin drags and survives removal of its last connection", async ({ page }) => {
	await createCircuit(page);
	const canvas = page.getByLabel("Circuit connections graph", { exact: true });
	await page.getByRole("button", { name: "Add net", exact: true }).click();
	await canvas.click({ position: { x: 900, y: 350 } });
	const name = page.getByRole("textbox", { name: "Net name", exact: true });
	await expect(name).toBeFocused();
	await name.fill("GND");
	await name.press("Enter");
	const standalone = await state(page);
	const netId = standalone.circuit.nets[0].id;
	expect(standalone.circuit.nets[0]).toMatchObject({ names: ["GND"], pinIds: [] });
	await expect(page.getByRole("button", { name: "Add LED example", exact: true })).toHaveCount(0);
	await expect(page.getByLabel("Circuit save status")).toHaveText("Saved");
	await page.reload();
	await (await openProjectFiles(page)).getByRole("link", { name: "Open LED driver", exact: true }).click();
	await closeProjectFiles(page);
	expect((await state(page)).circuit).toEqual(standalone.circuit);
	standalone.graph = (await state(page)).graph;
	await page.getByRole("button",{name:"Fit graph",exact:true}).click();
	await placeComponent(page, "Resistor", { x: 300, y: 220 });
	await placeComponent(page, "Resistor", { x: 300, y: 420 });
	for (const pin of ["R1.1", "R2.1"]) {
		const source = await pinCenter(page, pin);
		const target = await page.getByRole("button", { name: "Net GND", exact: true }).locator("circle").boundingBox();
		if (!target) throw new Error("Missing ground net.");
		await page.mouse.move(source.x, source.y); await page.mouse.down();
		await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 6 });
		await expect(page.getByRole("button", { name: "Net GND", exact: true }).locator("..")).toHaveClass(/is-target/);
		await page.mouse.up();
	}
	let connected = await state(page);
	expect(connected.circuit.nets).toHaveLength(1);
	expect(connected.circuit.nets[0]).toMatchObject({ id: netId, names: ["GND"] });
	expect(connected.circuit.nets[0].pinIds).toHaveLength(2);
	expect(connected.graph.positions.find((position: {id:string}) => position.id === netId)).toEqual(standalone.graph.positions[0]);
	await expect(page.getByRole("complementary", { name: "Circuit inspector" })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Circuit inspector", exact: true })).toHaveCount(0);
	await expect(page.getByLabel("Circuit save status")).toHaveText("Saved");
	await mkdir(resolve("test-results/screenshots"), { recursive: true });
	await page.screenshot({ path: resolve("test-results/screenshots/circuit-ground-bus.png"), fullPage: true });
	await page.getByRole("button", { name: "Net GND", exact: true }).dblclick();
	await expect(name).toBeFocused();
	await page.screenshot({ path: resolve("test-results/screenshots/circuit-inline-net-name.png"), fullPage: true });
	await name.press("Escape");
	await page.getByRole("button",{name:"Untangle",exact:true}).click();
	connected = await state(page);
	for (const pin of ["R1.1", "R2.1"]) {
		const point = await connectionPoint(page, pin);
		await page.mouse.click(point.x, point.y);
		await expect(page.getByRole("button", { name: `Connection ${pin}`, exact: true })).toHaveAttribute("aria-pressed", "true");
		await page.keyboard.press("Delete");
	}
	const empty = await state(page);
	expect(empty.circuit.nets).toEqual([{ id: netId, names: ["GND"], pinIds: [] }]);
	expect(empty.graph).toEqual(connected.graph);
	await page.keyboard.press("Control+z");
	expect((await state(page)).circuit.nets[0].pinIds).toHaveLength(1);
	await page.keyboard.press("Control+Shift+z");
	expect(await state(page)).toEqual(empty);
	await page.getByRole("button", { name: "Net GND", exact: true }).click();
	await page.getByRole("button", { name: "Delete selection", exact: true }).click();
	expect((await state(page)).circuit.nets).toEqual([]);
	expect((await state(page)).circuit.components).toEqual(empty.circuit.components);
	await page.keyboard.press("Control+z");
	expect(await state(page)).toEqual(empty);
	await expect(page.getByLabel("Circuit save status")).toHaveText("Saved");
	await page.reload();
	await (await openProjectFiles(page)).getByRole("link", { name: "Open LED driver", exact: true }).click();
	expect((await state(page)).circuit).toEqual(empty.circuit);
});

test("deleting one selected connection preserves the other members and net identity", async ({ page }) => {
	await createCircuit(page);
	await page.getByRole("button", { name: "Add LED example", exact: true }).click();
	const original = await state(page);
	const pinId = original.circuit.components.find((component: {reference:string}) => component.reference === "D2").pins[1].id;
	const ground = original.circuit.nets.find((net: {pinIds:string[]}) => net.pinIds.includes(pinId));
	const point = await connectionPoint(page, "D2.K");
	await page.mouse.click(point.x, point.y);
	await expect(page.getByRole("button", { name: "Connection D2.K", exact: true })).toHaveAttribute("aria-pressed", "true");
	await page.keyboard.press("Delete");
	const after = await state(page);
	expect(after.circuit.nets.find((net: {id:string}) => net.id === ground.id)).toEqual({ ...ground, pinIds: ground.pinIds.filter((id:string) => id !== pinId) });
	expect(after.graph).toEqual(original.graph);
	expect(after.circuit.components).toEqual(original.circuit.components);
	await page.keyboard.press("Control+z");
	expect(await state(page)).toEqual(original);
	await page.getByRole("button", { name: "Select component R1", exact: true }).click();
	await page.keyboard.press("ArrowRight");
	await page.getByRole("button", { name: "Connection D2.K", exact: true }).press("Enter");
	await page.keyboard.press("Control+z");
	await expect(page.getByRole("button", { name: "Delete selection", exact: true })).toBeDisabled();
});

test("inline net renaming rejects duplicate names and Escape cancels edits", async ({ page }) => {
	await createCircuit(page);
	await page.getByRole("button", { name: "Add LED example", exact: true }).click();
	const original = await state(page);
	await page.getByRole("button", { name: "Net GND", exact: true }).dblclick();
	const input = page.getByRole("textbox", { name: "Net name", exact: true });
	await input.fill("3V3"); await input.press("Enter");
	await expect(page.getByRole("alert")).toContainText("Duplicate net name");
	expect(await state(page)).toEqual(original);
	await input.press("Escape");
	await expect(input).toHaveCount(0);
	await expect(page.getByRole("alert")).toHaveCount(0);
	expect(await state(page)).toEqual(original);
	await page.getByRole("button", { name: "Add net", exact: true }).click();
	await page.keyboard.press("Escape");
	expect(await state(page)).toEqual(original);
});

test("component corners and net centers snap to visible grid dots for placement, dragging, and keyboard moves", async ({ page }) => {
	await createCircuit(page);
	const canvas = page.getByLabel("Circuit connections graph", { exact: true });
	async function assertOnDot(position: {x:number;y:number}) {
		const phase = await canvas.evaluate((element: SVGSVGElement, position) => {
			const point = new DOMPoint(position.x, position.y).matrixTransform(element.getScreenCTM()!);
			const background = element.parentElement!;
			const bounds = background.getBoundingClientRect();
			const style = getComputedStyle(background);
			const spacing = Number.parseFloat(style.backgroundSize);
			const offset = style.backgroundPosition.split(" ").map(Number.parseFloat);
			return { x: (point.x - bounds.x - offset[0] - spacing / 2) / spacing, y: (point.y - bounds.y - offset[1] - spacing / 2) / spacing };
		}, position);
		expect(phase.x).toBeCloseTo(Math.round(phase.x), 3);
		expect(phase.y).toBeCloseTo(Math.round(phase.y), 3);
	}
	const positionOf = async (kind:string,id:string) => (await state(page)).graph.positions.find((position:{kind:string;id:string}) => position.kind === kind && position.id === id);
	const transformOf = (locator: ReturnType<Page["locator"]>) => locator.evaluate((element: SVGGraphicsElement) => {
		const matrix = element.transform.baseVal.consolidate()!.matrix;
		return { x: matrix.e, y: matrix.f };
	});
	const bounds = await canvas.boundingBox();
	if (!bounds) throw new Error("Missing graph bounds.");
	await page.getByRole("button", {name:"Components",exact:true}).click();
	await page.getByRole("searchbox", {name:"Search components",exact:true}).fill("Resistor");
	await page.getByRole("button", {name:"Place Resistor",exact:true}).click();
	await page.mouse.move(bounds.x + 333, bounds.y + 251);
	const componentPreview = await transformOf(page.locator("[data-component-preview]"));
	await assertOnDot(componentPreview);
	await page.mouse.click(bounds.x + 333, bounds.y + 251);
	const component = (await state(page)).circuit.components[0];
	expect(await positionOf("component",component.id)).toMatchObject(componentPreview);
	await page.getByRole("button", {name:"Add net",exact:true}).click();
	await page.mouse.move(bounds.x + 873, bounds.y + 293);
	const netPreview = await transformOf(page.locator("[data-net-preview]"));
	await assertOnDot(netPreview);
	await page.mouse.click(bounds.x + 873, bounds.y + 293);
	await page.getByRole("textbox", {name:"Net name",exact:true}).fill("GND");
	await page.getByRole("textbox", {name:"Net name",exact:true}).press("Enter");
	const netId = (await state(page)).circuit.nets[0].id;
	expect(await positionOf("net",netId)).toMatchObject(netPreview);
	const source = await pinCenter(page,"R1.1");
	const target = await page.getByRole("button",{name:"Net GND",exact:true}).locator("circle").boundingBox();
	if (!target) throw new Error("Missing ground net.");
	await page.mouse.move(source.x,source.y); await page.mouse.down();
	await page.mouse.move(target.x+target.width/2,target.y+target.height/2,{steps:4}); await page.mouse.up();
	const original = await state(page);
	const header = page.getByRole("button",{name:"Select component R1",exact:true});
	const box = await header.boundingBox();
	if (!box) throw new Error("Missing component header.");
	await page.mouse.move(box.x + box.width/2,box.y + 12); await page.mouse.down();
	await page.mouse.move(box.x + box.width/2 + 37,box.y + 41,{steps:4});
	const movedPreview = await transformOf(header.locator("xpath=../.."));
	await assertOnDot(movedPreview);
	expect(await state(page)).toEqual(original);
	await page.mouse.up();
	expect(await positionOf("component",component.id)).toMatchObject(movedPreview);
	expect((await state(page)).circuit).toEqual(original.circuit);
	await page.keyboard.press("Control+z"); expect(await state(page)).toEqual(original);
	await page.keyboard.press("Control+Shift+z");
	const moved = await state(page);
	const movedBox = await header.boundingBox();
	if (!movedBox) throw new Error("Missing moved component.");
	await page.mouse.move(movedBox.x + 20,movedBox.y + 12); await page.mouse.down();
	await page.mouse.move(movedBox.x + 63,movedBox.y + 45,{steps:3});
	await page.keyboard.press("Escape"); await page.mouse.up();
	expect(await state(page)).toEqual(moved);
	await page.mouse.move(bounds.x + 30,bounds.y + 30);
	await page.mouse.wheel(37,29);
	for (let index=0;index<5;index++) await page.getByRole("button",{name:"Zoom out",exact:true}).click();
	expect(await state(page)).toEqual(moved);
	await placeComponent(page,"Resistor",{x:347,y:319});
	const second = (await state(page)).circuit.components[1];
	await assertOnDot(await positionOf("component",second.id));
	const netButton = page.getByRole("button",{name:"Net GND",exact:true});
	const netBox = await netButton.locator("circle").boundingBox();
	if (!netBox) throw new Error("Missing net node.");
	const beforeNetMove = await state(page);
	await page.mouse.move(netBox.x + netBox.width/2,netBox.y + netBox.height/2); await page.mouse.down();
	await page.mouse.move(bounds.x + 83,bounds.y + 121,{steps:6});
	const movedNetPreview = await transformOf(netButton.locator(".."));
	await assertOnDot(movedNetPreview);
	await page.mouse.up();
	const movedNet = await positionOf("net",netId);
	expect(movedNet.x).toBeLessThan(0);
	expect(movedNet).toMatchObject(movedNetPreview);
	expect((await state(page)).circuit).toEqual(beforeNetMove.circuit);
	await netButton.press("ArrowRight");
	await assertOnDot(await positionOf("net",netId));
	await header.press("ArrowDown");
	await assertOnDot(await positionOf("component",component.id));
	const beforeArrange = await state(page);
	await (await toolbarButton(page,"Untangle")).click();
	const arranged = await state(page);
	for (const position of arranged.graph.positions) await assertOnDot(position);
	expect(arranged.circuit).toEqual(beforeArrange.circuit);
	await expect(page.getByLabel("Circuit save status")).toHaveText("Saved");
	await page.getByRole("button",{name:"Fit graph",exact:true}).click();
	await mkdir(resolve("test-results/screenshots"),{recursive:true});
	await page.screenshot({path:resolve("test-results/screenshots/circuit-grid-snapping.png"),fullPage:true});
	await page.reload();
	await (await openProjectFiles(page)).getByRole("link",{name:"Open LED driver",exact:true}).click();
	expect((await state(page)).circuit).toEqual(arranged.circuit);
});

test("dragging between pins creates and merges nets with preview, undo, and autosave", async ({ page }) => {
	await createCircuit(page);
	await placeComponent(page, "Resistor", { x: 300, y: 230 });
	await placeComponent(page, "Resistor", { x: 650, y: 400 });
	const initial = await state(page);
	await dragPins(page, "R1.1", "R2.1");
	await expect(page.locator("[data-connection-preview]")).toBeVisible();
	await expect(page.getByRole("button", { name: "Pin R2.1", exact: true }).locator("..")).toHaveClass(/is-target/);
	expect(await state(page)).toEqual(initial);
	await mkdir(resolve("test-results/screenshots"), { recursive: true });
	await page.screenshot({ path: resolve("test-results/screenshots/circuit-pin-drag-preview.png"), fullPage: true });
	await page.mouse.up();
	await expect(page.locator("[data-connection-preview]")).toHaveCount(0);
	const first = await state(page);
	expect(first.circuit.nets).toHaveLength(1);
	expect(first.circuit.nets[0].pinIds).toEqual(expect.arrayContaining([initial.circuit.components[0].pins[0].id, initial.circuit.components[1].pins[0].id]));
	expect(first.graph).toEqual(initial.graph);
	await page.keyboard.press("Control+z");
	expect(await state(page)).toEqual(initial);
	await page.keyboard.press("Control+Shift+z");
	expect(await state(page)).toEqual(first);
	await dragPins(page, "R1.2", "R2.2");
	await page.mouse.up();
	const separate = await state(page);
	expect(separate.circuit.nets).toHaveLength(2);
	await page.getByRole("button", { name: "Zoom in", exact: true }).click();
	await dragPins(page, "R1.1", "R2.2");
	await page.mouse.up();
	const merged = await state(page);
	expect(merged.circuit.nets).toHaveLength(1);
	expect(merged.circuit.nets[0].pinIds).toHaveLength(4);
	await page.keyboard.press("Control+z");
	expect(await state(page)).toEqual(separate);
	await page.keyboard.press("Control+Shift+z");
	expect(await state(page)).toEqual(merged);
	await dragPins(page, "R1.1", "R2.1");
	await page.mouse.up();
	expect(await state(page)).toEqual(merged);
	await expect(page.getByLabel("Circuit save status")).toHaveText("Saved");
	await page.screenshot({ path: resolve("test-results/screenshots/circuit-pin-drag-connected.png"), fullPage: true });
	await page.reload();
	await (await openProjectFiles(page)).getByRole("link", { name: "Open LED driver", exact: true }).click();
	expect((await state(page)).circuit).toEqual(merged.circuit);
});

test("pin connection drags cancel on empty space, the source pin, Escape, or pointer cancellation", async ({ page }) => {
	await createCircuit(page);
	await page.getByRole("button", { name: "Add LED example", exact: true }).click();
	const original = await state(page);
	const canvas = page.getByLabel("Circuit connections graph", { exact: true });
	const box = await canvas.boundingBox();
	if (!box) throw new Error("Missing graph bounds.");
	for (const cancellation of ["empty", "source", "escape", "pointercancel"]) {
		const from = await pinCenter(page, "J1.1");
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		await page.mouse.move(box.x + 30, box.y + 30, { steps: 5 });
		await expect(page.locator("[data-connection-preview]")).toBeVisible();
		if (cancellation === "source") await page.mouse.move(from.x, from.y);
		if (cancellation === "escape") await page.keyboard.press("Escape");
		if (cancellation === "pointercancel") await canvas.dispatchEvent("pointercancel", { pointerId: 1 });
		await page.mouse.up();
		await expect(page.locator("[data-connection-preview]")).toHaveCount(0);
		expect(await state(page)).toEqual(original);
	}
	await page.getByRole("button", { name: "Pin J1.1", exact: true }).click();
	await expect(page.getByRole("button", { name: "Pin J1.1", exact: true }).locator("..")).toHaveClass(/is-selected/);
});

test("circuit files keep edits and undo histories isolated", async ({ page }) => {
	await createCircuit(page);
	await placeComponent(page, "Resistor");
	await page.getByRole("button", { name: "Select component R1", exact: true }).dblclick();
	await page.getByLabel("Reference", { exact: true }).fill("R12");
	await page.getByLabel("Value", { exact: true }).fill("10 kΩ");
	await page.getByLabel("Value", { exact: true }).press("Enter");
	expect((await state(page)).circuit.components[0]).toMatchObject({ reference: "R12", value: "10 kΩ" });
	const first = await state(page);
	await openProjectFiles(page);
	await page.getByRole("button", { name: "Add file", exact: true }).click();
	await page.getByRole("menuitem", { name: "New circuit", exact: true }).click();
	await page.getByLabel("Circuit name", { exact: true }).fill("Second circuit");
	await page.getByRole("button", { name: "Create circuit", exact: true }).click();
	await expect(page.getByRole("heading", { name: "Second circuit", exact: true })).toBeAttached();
	await closeProjectFiles(page);
	await page.getByRole("button", { name: "Add LED example", exact: true }).click();
	const second = await state(page);
	await expect(page.getByLabel("Circuit save status")).toHaveText("Saved");
	await (await openProjectFiles(page)).getByRole("link", { name: "Open LED driver", exact: true }).click();
	await expect(page.getByRole("heading", { name: "LED driver", exact: true })).toBeAttached();
	expect(await state(page)).toEqual(first);
	await closeProjectFiles(page);
	await page.getByRole("button", { name: "Select component R12", exact: true }).click();
	await page.getByRole("button", { name: "Delete selection", exact: true }).click();
	await expect(page.getByRole("button", { name: "Add LED example", exact: true })).toBeVisible();
	await (await toolbarButton(page, "Undo")).click();
	expect(await state(page)).toEqual(first);
	await (await openProjectFiles(page)).getByRole("link", { name: "Open Second circuit", exact: true }).click();
	await expect(page.getByRole("heading", { name: "Second circuit", exact: true })).toBeAttached();
	expect(await state(page)).toEqual(second);
});

test("library symbols place components with stable pins and a single undo step", async ({ page }) => {
	await createCircuit(page);
	await page.getByRole("button", {name:"Components",exact:true}).click();
	const search = page.getByRole("searchbox", {name:"Search components",exact:true});
	await search.fill("Box");
	await expect(page.getByRole("button", {name:"Place Box",exact:true})).toBeDisabled();
	await search.fill("Resistor");
	await page.getByRole("button", {name:"Place Resistor",exact:true}).click();
	expect((await state(page)).circuit.components).toHaveLength(0);
	const canvas = page.getByLabel("Circuit connections graph", {exact:true});
	const bounds = await canvas.boundingBox();
	await page.mouse.move(bounds!.x + 300,bounds!.y + 250);
	await expect(page.locator("[data-component-preview]")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.locator("[data-component-preview]")).toHaveCount(0);
	expect((await state(page)).circuit.components).toHaveLength(0);
	await placeComponent(page,"Resistor",{x:300,y:250});
	const first = await state(page);
	expect(first.circuit.components[0]).toMatchObject({reference:"R1",part:{id:"resistor",library:{scope:"user",id:"builtin"}}});
	expect(first.circuit.components[0].pins.map((pin: {number:string}) => pin.number)).toEqual(["1","2"]);
	expect(first.graph.positions).toHaveLength(1);
	await placeComponent(page,"Resistor",{x:600,y:250});
	const both = await state(page);
	expect(both.circuit.components[1].reference).toBe("R2");
	expect(both.circuit.components[0].pins[0].id).not.toBe(both.circuit.components[1].pins[0].id);
	await (await toolbarButton(page,"Undo")).click();
	expect(await state(page)).toEqual(first);
	await (await toolbarButton(page,"Redo")).click();
	expect(await state(page)).toEqual(both);
	await page.getByRole("button", {name:"Connect pins",exact:true}).click();
	await page.getByRole("button", {name:"Pin R1.1",exact:true}).locator("circle").click();
	await page.getByRole("button", {name:"Pin R2.1",exact:true}).locator("circle").click();
	await expect(page.getByLabel("Circuit save status")).toHaveText("Saved");
	const connected = await state(page);
	expect(connected.circuit.nets[0].pinIds).toEqual([both.circuit.components[0].pins[0].id,both.circuit.components[1].pins[0].id]);
	await page.reload();
	await (await openProjectFiles(page)).getByRole("link", {name:"Open LED driver",exact:true}).click();
	await expect(canvas).toBeVisible();
	expect((await state(page)).circuit).toEqual(connected.circuit);
});

test("project symbols appear as components and preserve named and numbered pins", async ({ page }) => {
	await createCircuit(page);
	await page.getByRole("button", {name:"Components",exact:true}).click();
	await page.keyboard.press("Escape");
	const sidebar = await openProjectFiles(page);
	await sidebar.getByLabel("Add symbol files").setInputFiles({name:"sensor.ecadsym",mimeType:"application/json",buffer:Buffer.from(JSON.stringify({format:"ecad-symbol",version:1,units:"mm",id:"sensor",name:"Sensor",description:"",prefix:"U",value:"Sensor IC",shapes:[
		{kind:"rectangle",x:0,y:0,width:10,height:8},
		{kind:"pin",name:"VCC",number:"1",x:-5,y:2},
		{kind:"pin",name:"OUT",number:"3",x:5,y:0},
		{kind:"pin",name:"GND",number:"8",x:-5,y:-2},
	]}))});
	await expect(sidebar.getByRole("link", {name:"Open sensor.ecadsym",exact:true})).toBeVisible();
	await closeProjectFiles(page);
	await placeComponent(page,"Sensor",{x:400,y:300});
	const current = await state(page);
	expect(current.circuit.components[0]).toMatchObject({reference:"U1",value:"Sensor IC",part:{id:"sensor",library:{scope:"project",id:"project-symbols"}}});
	expect(current.circuit.components[0].pins.map((pin:{name:string;number:string}) => [pin.name,pin.number])).toEqual([["VCC","1"],["OUT","3"],["GND","8"]]);
	await expect(page.getByRole("button", {name:"Pin U1.8",exact:true})).toBeVisible();
	await expect(page.getByLabel("Circuit save status")).toHaveText("Saved");
	await mkdir(resolve("test-results/screenshots"),{recursive:true});
	await page.screenshot({path:resolve("test-results/screenshots/circuit-symbol-component.png"),fullPage:true});
	await page.getByRole("button", {name:"Components",exact:true}).click();
	await page.getByRole("searchbox", {name:"Search components",exact:true}).fill("Sensor");
	await expect(page.getByRole("button", {name:"Place Sensor",exact:true})).toBeEnabled();
	await page.screenshot({path:resolve("test-results/screenshots/circuit-component-picker.png"),fullPage:true});
});

test("collapsed connections face their nets and share an anchor on each side", async ({page}) => {
 await createCircuit(page);
 await placeComponent(page,"Resistor",{x:500,y:300});
 for (const [index,name,x] of [[1,"LEFT",250],[2,"RIGHT",850]] as const) {
  await page.getByRole("button",{name:"Add net",exact:true}).click();
  await page.getByLabel("Circuit connections graph",{exact:true}).click({position:{x,y:300}});
  await page.getByRole("textbox",{name:"Net name",exact:true}).fill(name);
  await page.getByRole("textbox",{name:"Net name",exact:true}).press("Enter");
  const source=await pinCenter(page,`R1.${index}`);
  const target=await page.getByRole("button",{name:`Net ${name}`,exact:true}).locator("circle").boundingBox();
  if(!target) throw new Error("Missing net.");
  await page.mouse.move(source.x,source.y);await page.mouse.down();
  await page.mouse.move(target.x+target.width/2,target.y+target.height/2,{steps:6});await page.mouse.up();
 }
 const original=await state(page);
 await page.getByRole("button",{name:"Collapse R1",exact:true}).click();
 await expect(page.locator(".circuit-canvas.is-collapsing")).toHaveCount(0);
 await expect(page.locator(".circuit-pin")).toHaveCount(0);
 await expect(page.locator('.circuit-collapsed-anchor[data-side="left"]')).toHaveCount(1);
 await expect(page.locator('.circuit-collapsed-anchor[data-side="right"]')).toHaveCount(1);
 const endpoints=await page.locator(".circuit-edge").evaluateAll(paths=>paths.map(path=>{
  const point=(path as SVGPathElement).getPointAtLength(0);return {x:point.x,y:point.y};
 }));
 expect(endpoints[1].x-endpoints[0].x).toBe(200);
 expect(endpoints[1].y).toBe(endpoints[0].y);
 const cardBox=await page.locator(".circuit-component-body").boundingBox();
 const toggleBox=await page.getByRole("button",{name:"Expand R1",exact:true}).boundingBox();
 if(!cardBox||!toggleBox) throw new Error("Missing component collapse control.");
 expect(toggleBox.x+toggleBox.width/2).toBeCloseTo(cardBox.x+cardBox.width/2,1);
 await expect(page.getByText(/hidden pins?/)).toHaveCount(0);
 await expect(page.getByLabel("Circuit save status")).toHaveText("Saved");
 expect((await state(page)).circuit).toEqual(original.circuit);
 await page.getByRole("button",{name:"Fit graph",exact:true}).click();
 await mkdir(resolve("test-results/screenshots"),{recursive:true});
 await page.screenshot({path:resolve("test-results/screenshots/circuit-collapsed-sides.png"),fullPage:true});
 const left=page.getByRole("button",{name:"Net LEFT",exact:true});
 for(let index=0;index<40;index++) await left.press("ArrowRight");
 await expect(page.locator('.circuit-collapsed-anchor[data-side="left"]')).toHaveCount(0);
 await expect(page.locator('.circuit-collapsed-anchor[data-side="right"]')).toHaveCount(1);
 expect((await state(page)).circuit).toEqual(original.circuit);
});

test("unnamed nets follow pin names and allow manual overrides or return to automatic naming",async({page})=>{
 await createCircuit(page);
 await placeComponent(page,"Resistor",{x:320,y:240});
 await placeComponent(page,"Resistor",{x:760,y:340});
 await dragPins(page,"R1.1","R2.1");await page.mouse.up();
 const label="R1.1 / R2.1";
 await expect(page.getByRole("button",{name:`Net ${label}`,exact:true})).toBeVisible();
 await page.getByRole("button",{name:`Net ${label}`,exact:true}).press("Enter");
 const input=page.getByRole("textbox",{name:"Net name",exact:true});
 await expect(input).toHaveValue(label);
 await input.press("Enter");
 expect((await state(page)).circuit.nets[0].names).toEqual([]);
 await page.getByRole("button",{name:`Net ${label}`,exact:true}).press("Enter");
 await input.fill("SIGNAL");await input.press("Enter");
 await expect(page.getByRole("button",{name:"Net SIGNAL",exact:true})).toBeVisible();
 await page.getByRole("button",{name:"Net SIGNAL",exact:true}).press("Enter");
 await input.fill("");await input.press("Enter");
 await expect(page.getByRole("button",{name:`Net ${label}`,exact:true})).toBeVisible();
 await page.getByRole("button",{name:"Fit graph",exact:true}).click();
 await expect(page.getByLabel("Circuit save status")).toHaveText("Saved");
 const original=await state(page);
 await mkdir(resolve("test-results/screenshots"),{recursive:true});
 await page.screenshot({path:resolve("test-results/screenshots/circuit-auto-net-names.png"),fullPage:true});
 await page.reload();
 await (await openProjectFiles(page)).getByRole("link",{name:"Open LED driver",exact:true}).click();
 await closeProjectFiles(page);
 await expect(page.getByRole("button",{name:`Net ${label}`,exact:true})).toBeVisible();
 expect((await state(page)).circuit).toEqual(original.circuit);
 await page.getByRole("button",{name:"Connection R2.1",exact:true}).press("Enter");await page.keyboard.press("Delete");
 await expect(page.getByRole("button",{name:"Net R1.1",exact:true})).toBeVisible();
 await page.keyboard.press("Control+z");
 await expect(page.getByRole("button",{name:`Net ${label}`,exact:true})).toBeVisible();
});


test("Fit resets empty and tall graphs to 100 percent without editing the circuit",async({page})=>{
 await createCircuit(page);
 const fit=page.getByRole("button",{name:"Fit graph",exact:true});
 const canvas=page.getByLabel("Circuit connections graph",{exact:true});
 await page.getByRole("button",{name:"Zoom in",exact:true}).click();
 await fit.click();await expect(fit).toHaveText("100%");
 await placeComponent(page,"RP2040",{x:650,y:350});
 const original=await state(page);
 await page.getByRole("button",{name:"Zoom out",exact:true}).click();
 await fit.click();await expect(fit).toHaveText("100%");
 await expect.poll(()=>canvas.evaluate((element:SVGSVGElement)=>element.getScreenCTM()!.a)).toBeCloseTo(1,6);
 expect(await state(page)).toEqual(original);
 await page.setViewportSize({width:900,height:600});
 await page.getByRole("button",{name:"Zoom in",exact:true}).click();
 await fit.click();await expect(fit).toHaveText("100%");
 expect(await canvas.evaluate((element:SVGSVGElement)=>element.getScreenCTM()!.a)).toBeCloseTo(1,6);
 expect(await state(page)).toEqual(original);
});

test("comma-containing net names and aliases survive unchanged edits and independent alias changes",async({page})=>{
 await createCircuit(page);
 await page.getByRole("button",{name:"Add net",exact:true}).click();
 await page.getByLabel("Circuit connections graph",{exact:true}).click({position:{x:600,y:300}});
 const primary=page.getByRole("textbox",{name:"Net name",exact:true});
 await primary.fill("A,B");
 await page.getByRole("button",{name:"Add alias",exact:true}).click();
 await page.getByRole("textbox",{name:"Net alias 1",exact:true}).fill("ALIAS,ONE");
 await page.getByRole("textbox",{name:"Net alias 1",exact:true}).press("Enter");
 const original=await state(page);
 expect(original.circuit.nets[0].names).toEqual(["A,B","ALIAS,ONE"]);
 const net=page.getByRole("button",{name:"Net A,B",exact:true});
 await net.press("Enter");await primary.press("Enter");
 expect(await state(page)).toEqual(original);
 await net.press("Enter");
 await page.getByLabel("Circuit connections graph",{exact:true}).click({position:{x:20,y:20}});
 expect(await state(page)).toEqual(original);
 await net.press("Enter");
 const alias=page.getByRole("textbox",{name:"Net alias 1",exact:true});
 await alias.fill("ALIAS,TWO");await alias.press("Enter");
 expect((await state(page)).circuit.nets[0].names).toEqual(["A,B","ALIAS,TWO"]);
 await expect(page.getByLabel("Circuit save status")).toHaveText("Saved");
 await page.reload();
 await (await openProjectFiles(page)).getByRole("link",{name:"Open LED driver",exact:true}).click();
 await closeProjectFiles(page);
 expect((await state(page)).circuit.nets[0].names).toEqual(["A,B","ALIAS,TWO"]);
 await net.press("Enter");
 await expect(primary).toHaveValue("A,B");await expect(alias).toHaveValue("ALIAS,TWO");
 await mkdir(resolve("test-results/screenshots"),{recursive:true});
 await page.screenshot({path:resolve("test-results/screenshots/circuit-net-aliases.png"),fullPage:true});
 await primary.press("Enter");
 expect((await state(page)).circuit.nets[0].names).toEqual(["A,B","ALIAS,TWO"]);
});

test("a delayed circuit open cannot override a later drawing or circuit selection",async({page})=>{
 await createCircuit(page);
 await openProjectFiles(page);
 await page.getByRole("button",{name:"Add file",exact:true}).click();
 await page.getByRole("menuitem",{name:"New circuit",exact:true}).click();
 await page.getByLabel("Circuit name",{exact:true}).fill("Second circuit");
 await page.getByRole("button",{name:"Create circuit",exact:true}).click();
 await expect(page.getByRole("heading",{name:"Second circuit",exact:true})).toBeAttached();
 await expect(page.getByLabel("Circuit save status")).toHaveText("Saved");
 await page.reload();
 await openProjectFiles(page);
 let release=()=>{};
 const gate=new Promise<void>(resolve=>{release=resolve;});
 await page.route("**/circuit/store.ts*",async route=>{await gate;await route.continue();});
 const requested=page.waitForRequest(request=>request.url().includes("/circuit/store.ts"));
 await page.getByRole("link",{name:"Open LED driver",exact:true}).click();
 const request=await requested;
 await page.getByRole("link",{name:"Open Drawing",exact:true}).click();
 release();await request.response();await page.waitForLoadState("networkidle");
 await expect(page.getByLabel("Circuit connections graph",{exact:true})).toHaveCount(0);
 await page.evaluate(()=>{
  (document.querySelector('a[aria-label="Open LED driver"]') as HTMLAnchorElement).click();
  (document.querySelector('a[aria-label="Open Second circuit"]') as HTMLAnchorElement).click();
 });
 await expect(page.getByRole("heading",{name:"Second circuit",exact:true})).toBeAttached();
 expect((await state(page)).circuit.name).toBe("Second circuit");
});

test("keyboard-only component and net placement supports snapping, cancellation, undo, and reload",async({page})=>{
 await createCircuit(page);
 const canvas=page.getByLabel("Circuit connections graph",{exact:true});
 await page.getByRole("button",{name:"Components",exact:true}).focus();
 await page.keyboard.press("Enter");
 await page.getByRole("searchbox",{name:"Search components",exact:true}).fill("Resistor");
 await page.keyboard.press("Tab");
 await expect(page.getByRole("button",{name:"Place Resistor",exact:true})).toBeFocused();
 await page.keyboard.press("Enter");
 await expect(canvas).toBeFocused();
 const before=await page.locator("[data-component-preview]").getAttribute("transform");
 await page.keyboard.press("ArrowRight");await page.keyboard.press("ArrowDown");
 const preview=await page.locator("[data-component-preview]").getAttribute("transform");
 expect(preview).not.toBe(before);
 await page.keyboard.press("Enter");
 expect((await state(page)).circuit.components).toHaveLength(1);
 await page.keyboard.press("Control+z");
 expect((await state(page)).circuit.components).toHaveLength(0);
 await page.keyboard.press("Control+Shift+z");
 expect((await state(page)).circuit.components).toHaveLength(1);
 const add=page.getByRole("button",{name:"Add net",exact:true});
 await add.focus();await page.keyboard.press("Enter");await expect(canvas).toBeFocused();
 await page.keyboard.press("Escape");expect((await state(page)).circuit.nets).toHaveLength(0);
 await add.focus();await page.keyboard.press("Enter");await expect(canvas).toBeFocused();
 await page.keyboard.press("Shift+ArrowLeft");await page.keyboard.press("Shift+ArrowLeft");
 await page.keyboard.press("Enter");
 await expect(page.getByRole("textbox",{name:"Net name",exact:true})).toBeFocused();
 await page.keyboard.press("Escape");
 expect((await state(page)).circuit.nets).toHaveLength(1);
 await page.keyboard.press("Control+z");expect((await state(page)).circuit.nets).toHaveLength(0);
 await page.keyboard.press("Control+Shift+z");expect((await state(page)).circuit.nets).toHaveLength(1);
 await expect(page.getByLabel("Circuit save status")).toHaveText("Saved");
 const saved=await state(page);
 await page.reload();
 await (await openProjectFiles(page)).getByRole("link",{name:"Open LED driver",exact:true}).click();
 expect((await state(page)).circuit).toEqual(saved.circuit);
});


test("zoom percentage and limits use the rendered scale after tall graph framing",async({page})=>{
 await createCircuit(page);
 await placeComponent(page,"RP2040",{x:650,y:350});
 const original=await state(page);
 await page.getByRole("button",{name:"Untangle",exact:true}).click();
 const canvas=page.getByLabel("Circuit connections graph",{exact:true});
 const percent=page.getByRole("button",{name:"Fit graph",exact:true});
 const scale=()=>canvas.evaluate((element:SVGSVGElement)=>element.getScreenCTM()!.a);
 await expect.poll(async()=>percent.textContent()).toBe(`${Math.round(await scale()*100)}%`);
 await page.getByRole("button",{name:"Zoom in",exact:true}).click();
 await expect.poll(async()=>percent.textContent()).toBe(`${Math.round(await scale()*100)}%`);
 await page.setViewportSize({width:900,height:600});
 await expect.poll(async()=>percent.textContent()).toBe(`${Math.round(await scale()*100)}%`);
 await percent.click();await expect(percent).toHaveText("100%");expect(await scale()).toBeCloseTo(1,6);
 expect((await state(page)).circuit).toEqual(original.circuit);
});
