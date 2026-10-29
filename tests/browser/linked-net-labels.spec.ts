import { expect, test } from "@playwright/test";
import { createCircuit } from "@ecad/drawing-core/circuit/model.ts";
import { componentFromSymbol } from "#/circuit/symbol-components.ts";
import { synchronizePcb } from "#/circuit/linked-schematic.ts";
import { symbolDefinitions } from "#/drawing/symbols.ts";
import { openProjectFiles, closeProjectFiles } from "./project-files";

test("saved generated labels repair their names, measured widths and pin alignment on reopen", async ({page}) => {
 const original=createCircuit("Untitled","pcb-main");
 const file=structuredClone(original);
 const resistor=componentFromSymbol(symbolDefinitions.find(definition=>definition.id==="resistor")!,[]);
 const capacitor=componentFromSymbol(symbolDefinitions.find(definition=>definition.id==="capacitor")!,[resistor]);
 file.circuit.components=[resistor,capacitor];
 const unnamedId=crypto.randomUUID();
 file.circuit.nets=[{id:unnamedId,names:[],pinIds:[resistor.pins[1].id,capacitor.pins[0].id]},{id:"power",names:["VDD"],pinIds:[resistor.pins[0].id]},{id:"ground",names:["GND"],pinIds:[capacitor.pins[1].id]}];
 const linked=synchronizePcb(file,[],original,symbolDefinitions);
 const legacy=linked.shapes.map(shape=>({ ...shape, x: shape.x-45, y: shape.y+30 })).map(shape=>shape.kind==="text"?{...shape,circuitNet:undefined,text:shape.text==="C1.1 / R1.2"?`N_${unnamedId}`:shape.text,width:5,height:2,fontSize:1,horizontalAlign:undefined,verticalAlign:undefined}:shape);
 await page.goto("/tests/browser/projects.html");
 await expect(page.locator("#project-document")).toContainText('"name":"Untitled"');
 await page.evaluate(async ({file,shapes})=>{
  const storageModule = "/packages/web/src/projects/storage.ts";
  const {createWebProjectStorage}=await import(storageModule);
  const storage=createWebProjectStorage();
  const project=await storage.load();
  await storage.save(project!.directory,{shapes,symbols:[],circuits:[file]});
 },{file:linked.file,shapes:legacy});
 await page.reload();
 await expect.poll(async()=>JSON.parse((await page.locator("#project-document").textContent())!).shapes.filter((shape:{kind:string,text?:string})=>shape.kind==="text"&&shape.text==="C1.1 / R1.2").length).toBe(2);
 await (await openProjectFiles(page)).getByRole("link",{name:"Open Untitled.ecaddraw",exact:true}).click();
 await closeProjectFiles(page);
 await expect(page.locator("canvas")).toBeVisible();
 const labels=await page.evaluate(async()=>{
  const measureModule = "/packages/core/src/engine/drawing/text.ts";
  const {measureText}=await import(measureModule);
  const textModule = "/packages/core/src/drawing/text.ts";
  const {fontPixels,padding}=await import(textModule);
  const doc=JSON.parse(document.querySelector("#project-document")!.textContent!);
  return doc.shapes.filter((shape:{kind:string})=>shape.kind==="text").map((shape:{text:string,width:number,fontSize:number})=>({...shape,expectedWidth:(measureText(shape.text)+padding*2)*shape.fontSize/fontPixels}));
 });
 expect(labels.map((label:{text:string})=>label.text)).toEqual(["C1.1 / R1.2","C1.1 / R1.2","VDD","GND"]);
 for(const label of labels) expect(label.width).toBeCloseTo(label.expectedWidth,6);
 for(let index=0;index<10;index++) await page.getByRole("button",{name:"Zoom in",exact:true}).click();
 await page.mouse.move(20,20);
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 if(process.env.ECAD_SCREENSHOT_PATH) await page.screenshot({path:process.env.ECAD_SCREENSHOT_PATH});
 await page.reload();
 await expect.poll(async()=>JSON.parse((await page.locator("#project-document").textContent())!).shapes.filter((shape:{kind:string,text?:string})=>shape.kind==="text"&&shape.text==="C1.1 / R1.2").length).toBe(2);
 await (await openProjectFiles(page)).getByRole("link",{name:"Open Untitled.ecadcircuit",exact:true}).click();
 await expect.poll(async()=>JSON.parse((await page.locator("#circuit-document").textContent())!).circuit.nets.find((net:{id:string})=>net.id===unnamedId)?.names).toEqual([]);
});

test("pending autosaves preserve generated net bindings and schematic undo", async ({page})=>{
 const original=createCircuit("Untitled","pcb-main");const file=structuredClone(original);
 const resistor=componentFromSymbol(symbolDefinitions.find(definition=>definition.id==="resistor")!,[]);
 const capacitor=componentFromSymbol(symbolDefinitions.find(definition=>definition.id==="capacitor")!,[resistor]);
 file.circuit.components=[resistor,capacitor];file.circuit.nets=[{id:"signal",names:[],pinIds:[resistor.pins[1].id,capacitor.pins[0].id]}];
 const linked=synchronizePcb(file,[],original,symbolDefinitions);
 await page.goto("/tests/browser/projects.html");await expect(page.locator("#project-document")).toContainText('"name":"Untitled"');
 await page.evaluate(async ({file,shapes})=>{
  const path="/packages/web/src/projects/storage.ts";const {createWebProjectStorage}=await import(path);const storage=createWebProjectStorage();const project=await storage.load();
  await storage.save(project.directory,{shapes,symbols:[],circuits:[file]});
 },{file:linked.file,shapes:linked.shapes.map(shape=>({...shape,x:shape.x-45,y:shape.y+30}))});
 await page.reload();await (await openProjectFiles(page)).getByRole("link",{name:"Open Untitled.ecaddraw",exact:true}).click();await closeProjectFiles(page);
 for(let index=0;index<10;index++)await page.getByRole("button",{name:"Zoom in",exact:true}).click();
 await page.locator("canvas").click({position:{x:384,y:360}});
 const reference=page.getByRole("textbox",{name:"Reference",exact:true});await expect(reference).toHaveValue("R1");
 await page.evaluate(()=>{
  const state=window as typeof window & {qaSavePending?:boolean;releaseQaSave?:()=>void};
  const original=FileSystemFileHandle.prototype.createWritable;let hold=true;
  FileSystemFileHandle.prototype.createWritable=async function(options){
   const writable=await original.call(this,options);
   if(this.name===".ecadprj"&&hold){hold=false;state.qaSavePending=true;await new Promise<void>(resolve=>{state.releaseQaSave=()=>{FileSystemFileHandle.prototype.createWritable=original;resolve();};});}
   return writable;
  };
 });
 await reference.fill("R9");await reference.press("Tab");
 await page.waitForFunction(()=>(window as typeof window & {qaSavePending?:boolean}).qaSavePending);
 const value=page.getByRole("textbox",{name:"Value",exact:true});await value.fill("22k");await value.press("Tab");
 await page.evaluate(()=>(window as typeof window & {releaseQaSave:()=>void}).releaseQaSave());
 const doc=async()=>JSON.parse((await page.locator("#project-document").textContent())!);
 await expect.poll(async()=>(await doc()).dirty).toBe(false);
 await expect.poll(async()=>(await doc()).shapes.filter((shape:{kind:string,text?:string})=>shape.kind==="text"&&shape.text==="C1.1 / R9.2").length).toBe(2);
 const {toolbarButton}=await import("./toolbar");
 await (await toolbarButton(page,"Undo")).click();
 await expect.poll(async()=>(await doc()).shapes.find((shape:{kind:string,attributes?:{reference:string}})=>shape.kind==="symbol"&&shape.attributes?.reference==="R9")?.attributes.value).toBe(resistor.value);
 await (await toolbarButton(page,"Undo")).click();
 await expect.poll(async()=>(await doc()).shapes.some((shape:{kind:string,attributes?:{reference:string}})=>shape.kind==="symbol"&&shape.attributes?.reference==="R1")).toBe(true);
 await expect.poll(async()=>(await doc()).dirty).toBe(false);
 await (await openProjectFiles(page)).getByRole("link",{name:"Open Untitled.ecadcircuit",exact:true}).click();
 await expect.poll(async()=>JSON.parse((await page.locator("#circuit-document").textContent())!).circuit.nets[0].names).toEqual([]);
});

test("legacy projects keep their unpaired main drawing visible beside circuits",async({page})=>{
 const file=createCircuit("Legacy board","Board_1");
 await page.goto("/tests/browser/projects.html");await expect(page.locator("#project-document")).toContainText('"name":"Untitled"');
 await page.evaluate(async(file)=>{
  const root=await navigator.storage.getDirectory();const directory=await root.getDirectoryHandle("Legacy QA",{create:true});
  const write=async(path:string,text:string)=>{const writable=await(await directory.getFileHandle(path,{create:true})).createWritable();await writable.write(text);await writable.close();};
  await write("drawing.ecaddraw",JSON.stringify({shapes:[]}));await write("board.ecadcircuit",JSON.stringify(file.circuit));
  await write(".ecadprj",'format = "ecad-project"\nversion = 1\nname = "Legacy QA"\ndrawing = "drawing.ecaddraw"\nsymbols = []\n[[circuits]]\ncircuit = "board.ecadcircuit"\n');
  localStorage.setItem("ecad.active-project","Legacy QA");
 },file);
 await page.reload();const sidebar=await openProjectFiles(page);
 await expect(sidebar.getByRole("link",{name:"Open Drawing",exact:true})).toBeVisible();
 await expect(sidebar.getByRole("link",{name:"Open Legacy board.ecadcircuit",exact:true})).toBeVisible();
});

test("dragging a generated label adds wires and persists through autosave, undo and reload", async ({ page }) => {
 const original = createCircuit("Untitled", "pcb-main");
 const file = structuredClone(original);
 const resistor = componentFromSymbol(symbolDefinitions.find(definition => definition.id === "resistor")!, []);
 file.circuit.components = [resistor];
 file.circuit.nets = [{ id: "signal", names: ["SIGNAL"], pinIds: [resistor.pins[1].id] }];
 const linked = synchronizePcb(file, [], original, symbolDefinitions);
 const shapes = linked.shapes.map(shape => ({ ...shape, x: shape.x - 30, y: shape.y + 30 }));
 const label = shapes.find(shape => shape.kind === "text")!;
 await page.goto("/tests/browser/projects.html");
 await expect(page.locator("#project-document")).toContainText('"name":"Untitled"');
 await page.evaluate(async ({ file, shapes }) => {
  const path = "/packages/web/src/projects/storage.ts";
  const { createWebProjectStorage } = await import(path);
  const storage = createWebProjectStorage();
  const project = await storage.load();
  await storage.save(project.directory, { shapes, symbols: [], circuits: [file] });
 }, { file: linked.file, shapes });
 await page.reload();
 await (await openProjectFiles(page)).getByRole("link", { name: "Open Untitled.ecaddraw", exact: true }).click();
 await closeProjectFiles(page);
 await expect(page.locator("canvas")).toBeVisible();
 await page.evaluate(async () => {
  const path = "/node_modules/.vite-browser-tests/deps/three.js";
  const { Scene, Vector3 } = await import(path) as typeof import("three");
  const previous = Scene.prototype.onAfterRender;
  Scene.prototype.onAfterRender = function(...args) {
   previous.apply(this, args);
   const camera = args[2];
   const origin = new Vector3(0, 0, 0).project(camera);
   const corner = new Vector3(1, 1, 0).project(camera);
   (window as any).labelView = { x: origin.x, y: origin.y, scale: corner.x - origin.x };
  };
 });
 for (let index = 0; index < 7; index++) await page.getByRole("button", { name: "Zoom in", exact: true }).click();
 await page.getByRole("button", { name: "Snap to grid", exact: true }).click();
 await page.waitForFunction(() => (window as any).labelView);
 const view = await page.evaluate(() => (window as any).labelView);
 const { shapeBounds } = await import("#/drawing/shapes.ts");
 const bounds = shapeBounds(label);
 const canvas = (await page.locator("canvas").boundingBox())!;
 const scale = view.scale * canvas.width / 2;
 const x = canvas.x + (1 + view.x) * canvas.width / 2 + (bounds.minX + bounds.maxX) / 2 * scale;
 const y = canvas.y + (1 - view.y) * canvas.height / 2 - (bounds.minY + bounds.maxY) / 2 * scale;
 const document = async () => JSON.parse((await page.locator("#project-document").textContent())!);
 await page.mouse.move(x, y);
 await page.mouse.down();
 await page.mouse.move(x + 12 * scale, y + 10 * scale, { steps: 8 });
 await page.mouse.up();
 await expect.poll(async () => (await document()).shapes.find((shape: any) => shape.id === label.id)?.x).toBeCloseTo(label.x + 12, 4);
 await expect.poll(async () => (await document()).dirty).toBe(false);
 expect((await document()).shapes.filter((shape: any) => shape.kind === "wire")).toHaveLength(2);
 const moved = (await document()).shapes;
 await page.mouse.move(20, 20);
 await page.screenshot({ path: "artifacts/moved-net-label.png" });
 const { toolbarButton } = await import("./toolbar");
 await (await toolbarButton(page, "Undo")).click();
 await expect.poll(async () => (await document()).shapes.find((shape: any) => shape.id === label.id)?.x).toBe(label.x);
 await (await toolbarButton(page, "Redo")).click();
 await expect.poll(async () => (await document()).shapes).toEqual(moved);
 await expect.poll(async () => (await document()).dirty).toBe(false);
 await page.reload();
 await expect.poll(async () => (await document()).shapes.filter((shape: any) => shape.kind !== "symbol")).toEqual(moved.filter((shape: any) => shape.kind !== "symbol"));
 await (await openProjectFiles(page)).getByRole("link", { name: "Open Untitled.ecadcircuit", exact: true }).click();
 await expect.poll(async () => JSON.parse((await page.locator("#circuit-document").textContent())!).circuit.nets).toEqual(file.circuit.nets);
});
