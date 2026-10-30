import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { createCircuit } from "@ecad/drawing-core/circuit/model.ts";
import { synchronizePcb } from "#/circuit/linked-schematic.ts";
import { createSymbol, symbolDefinitions } from "#/drawing/symbols.ts";
import { pinTerminals } from "#/drawing/shapes.ts";
import { openProjectFiles, closeProjectFiles } from "./project-files";
import { toolbarButton } from "./toolbar";

test("matching net symbols become one circuit net and remain named after a circuit merge", async ({page}) => {
 const original=createCircuit("Untitled","pcb-main");
 const definition=symbolDefinitions.find(definition=>definition.id==="ground")!;
 const resistor=symbolDefinitions.find(definition=>definition.id==="resistor")!;
 const a=createSymbol(1,definition,{x:0,y:0});
 const b=createSymbol(2,definition,{x:40,y:0});
 const parts=[a,b].map((symbol,index)=>{
  const part=createSymbol(index+3,resistor,{x:0,y:0},`R${index+1}`);
  const target=pinTerminals(symbol)[0], terminal=pinTerminals(part)[0];
  return {...part,x:target.x-terminal.x,y:target.y-terminal.y};
 });
 const first=synchronizePcb(original,[a,b,...parts],original,symbolDefinitions);
 expect(first.file.circuit.nets).toHaveLength(1);
 expect(first.file.circuit.nets[0].pinIds).toHaveLength(2);
 await page.goto("/tests/browser/projects.html");
 await expect(page.locator("#project-document")).toContainText('"name":"Untitled"');
 await page.evaluate(async ({file,shapes})=>{
  const path="/packages/web/src/projects/storage.ts";
  const {createWebProjectStorage}=await import(path);
  const storage=createWebProjectStorage();const project=await storage.load();
  await storage.save(project.directory,{shapes,symbols:[],circuits:[file]});
 },{file:first.file,shapes:first.shapes});
 await page.reload();
 await (await openProjectFiles(page)).getByRole("link",{name:"Open Untitled.ecaddraw in circuit view",exact:true}).click();
 await closeProjectFiles(page);
 await expect(page.locator(".circuit-net")).toHaveCount(1);
 await expect(page.locator(".circuit-edge")).toHaveCount(2);
 await page.getByRole("button",{name:"Switch to schematic view",exact:true}).click();
 const separated=synchronizePcb(first.file,first.shapes.map(shape=>shape.id===2&&shape.kind==="symbol"?{...shape,attributes:{...shape.attributes,name:"OTHER"}}:shape),first.file,symbolDefinitions);
 await page.evaluate(async ({file,shapes})=>{
  const path="/packages/web/src/projects/storage.ts";
  const {createWebProjectStorage}=await import(path);
  const storage=createWebProjectStorage();const project=await storage.load();
  await storage.save(project.directory,{shapes,symbols:[],circuits:[file]});
 },{file:separated.file,shapes:separated.shapes});
 await page.reload();
 await (await openProjectFiles(page)).getByRole("link",{name:"Open Untitled.ecaddraw in circuit view",exact:true}).click();
 await closeProjectFiles(page);
 await expect(page.locator(".circuit-net")).toHaveCount(2);
 await page.getByRole("button",{name:"Net OTHER",exact:true}).focus();
 await page.getByRole("button",{name:"Net OTHER",exact:true}).press("Enter");
 await page.getByRole("textbox",{name:"Net name",exact:true}).fill("GND");
 await page.getByRole("textbox",{name:"Net name",exact:true}).press("Enter");
 await expect(page.locator(".circuit-net")).toHaveCount(1);
 await expect(page.locator(".circuit-editor")).toHaveAttribute("data-pending-changes","false");
 await (await toolbarButton(page,"Undo")).click();
 await expect(page.locator(".circuit-net")).toHaveCount(2);
 await (await toolbarButton(page,"Redo")).click();
 await expect(page.locator(".circuit-net")).toHaveCount(1);
 await page.getByRole("button",{name:"Switch to schematic view",exact:true}).click();
 const doc=async()=>JSON.parse((await page.locator("#project-document").textContent())!);
 await expect.poll(async()=>(await doc()).shapes.filter((shape:{kind:string,netSymbol?:boolean})=>shape.kind==="symbol"&&shape.netSymbol).map((shape:{attributes:{name:string}})=>shape.attributes.name)).toEqual(["GND","GND"]);
 await page.reload();
 await (await openProjectFiles(page)).getByRole("link",{name:"Open Untitled.ecaddraw in circuit view",exact:true}).click();
 await closeProjectFiles(page);
 await expect(page.locator(".circuit-net")).toHaveCount(1);
 await mkdir("/tmp/ecad-net-merge",{recursive:true});
 await page.screenshot({path:"/tmp/ecad-net-merge/circuit.png"});
});

test("custom project symbols marked as net symbols share their name across save and reload", async ({page}) => {
 const {parseSymbolFile}=await import("#/components/editor/symbolFormat.ts");
 const {libraryDefinitions}=await import("#/drawing/symbol-file.ts");
 const {selectDrawingShape}=await import("./symbol-items");
 const custom=parseSymbolFile(JSON.stringify({
  format:"ecad-symbol",version:1,units:"mm",id:"custom-net-point",name:"Custom net point",description:"",prefix:"N",value:"",
  shapes:[{kind:"rectangle",x:0,y:0,width:6,height:4},{kind:"pin",x:-5,y:0,name:"Terminal",number:"1"}],
 }));
 const definition={...libraryDefinitions([custom])[0],library:{scope:"project" as const,id:"project-symbols"}};
 const resistor=symbolDefinitions.find(definition=>definition.id==="resistor")!;
 const symbols=[-40,40].map((x,index)=>{
  const symbol=createSymbol(index+1,definition,{x,y:0},`N${index+1}`);
  return {...symbol,attributes:{...symbol.attributes,name:"CUSTOM_BUS"}};
 });
 const parts=symbols.map((symbol,index)=>{
  const part=createSymbol(index+3,resistor,{x:0,y:0},`R${index+1}`);
  const target=pinTerminals(symbol)[0],terminal=pinTerminals(part).at(-1)!;
  return {...part,x:target.x-terminal.x,y:target.y-terminal.y};
 });
 await page.goto("/tests/browser/projects.html");
 await expect(page.locator("#project-document")).toContainText('"name":"Untitled"');
 await page.evaluate(async ({shapes,symbols})=>{
  const path="/packages/web/src/projects/storage.ts";
  const {createWebProjectStorage}=await import(path);
  const storage=createWebProjectStorage();const project=await storage.load();
  await storage.save(project.directory,{shapes,symbols});
 },{shapes:[...symbols,...parts],symbols:[custom]});
 await page.reload();
 await (await openProjectFiles(page)).getByRole("link",{name:"Open Untitled.ecaddraw",exact:true}).click();
 await closeProjectFiles(page);
 for(const id of [1,2]){
  await selectDrawingShape(page,id);
  await page.getByRole("checkbox",{name:"Net symbol",exact:true}).check();
  await expect(page.getByRole("textbox",{name:"Name",exact:true})).toHaveValue("CUSTOM_BUS");
 }
 await page.getByRole("button",{name:"Switch to circuit view",exact:true}).click();
 await expect(page.locator(".circuit-net")).toHaveCount(1);
 await expect(page.getByRole("button",{name:"Net CUSTOM_BUS",exact:true})).toBeAttached();
 await expect(page.locator(".circuit-edge")).toHaveCount(2);
 await expect(page.locator(".circuit-component")).toHaveCount(2);
 await page.getByRole("button",{name:"Switch to schematic view",exact:true}).click();
 await page.reload();
 await (await openProjectFiles(page)).getByRole("link",{name:"Open Untitled.ecaddraw in circuit view",exact:true}).click();
 await closeProjectFiles(page);
 await expect(page.locator(".circuit-net")).toHaveCount(1);
 await expect(page.locator(".circuit-edge")).toHaveCount(2);
 await mkdir("/tmp/ecad-net-merge",{recursive:true});
 await page.screenshot({path:"/tmp/ecad-net-merge/custom-symbols.png"});
});

test("placing duplicate VDD and ground symbols produces one circuit net for each name", async ({page}) => {
 await page.goto("/tests/browser/projects.html");
 await (await openProjectFiles(page)).getByRole("link",{name:"Open Untitled.ecaddraw",exact:true}).click();
 await closeProjectFiles(page);
 for(const [name,x,y] of [["VDD",300,250],["VDD",600,250],["Ground",300,450],["Ground",600,450]] as const){
  await page.getByRole("button",{name:"Symbols",exact:true}).click();
  await page.getByRole("searchbox",{name:"Search symbols",exact:true}).fill(name);
  await page.getByRole("button",{name:`Insert ${name}`,exact:true}).click();
  await page.locator("canvas").click({position:{x,y}});
  await page.keyboard.press("Escape");
 }
 await page.getByRole("button",{name:"Switch to circuit view",exact:true}).click();
 await expect(page.locator(".circuit-net")).toHaveCount(2);
 await expect(page.getByRole("button",{name:"Net VDD",exact:true})).toHaveCount(1);
 await expect(page.getByRole("button",{name:"Net GND",exact:true})).toHaveCount(1);
 await page.reload();
 await (await openProjectFiles(page)).getByRole("link",{name:"Open Untitled.ecaddraw in circuit view",exact:true}).click();
 await closeProjectFiles(page);
 await expect(page.locator(".circuit-net")).toHaveCount(2);
});

for(const kind of ["built-in","custom"] as const) test(`opening an existing schematic rebuilds stale circuit nets from matching ${kind} net symbols`, async ({page}) => {
 const {normalizeNetSymbol}=await import("#/drawing/shapes.ts");
 const original=createCircuit("Untitled","pcb-main");
 const resistor=symbolDefinitions.find(definition=>definition.id==="resistor")!;
 const supplies=["VDD","VDD","GND","GND"].map((name,index)=>{
  const definition=kind==="custom"
   ? {...resistor,id:"custom-supply",library:undefined}
   : symbolDefinitions.find(definition=>definition.id===(name==="VDD"?"vdd":"ground"))!;
  const symbol=createSymbol(index+1,definition,{x:index*40-60,y:0},`N${index+1}`);
  return {...symbol,netSymbol:false,attributes:{...symbol.attributes,name,value:""}};
 });
 const parts=supplies.map((symbol,index)=>{
  const part=createSymbol(index+5,resistor,{x:0,y:0},`R${index+1}`);
  const target=pinTerminals(symbol)[0],terminal=pinTerminals(part).at(-1)!;
  return {...part,x:target.x-terminal.x,y:target.y-terminal.y};
 });
 const stale=synchronizePcb(original,[...supplies,...parts],original,symbolDefinitions);
 expect(stale.file.circuit.nets).toHaveLength(4);
 const shapes=stale.shapes.map(shape=>shape.kind==="symbol"&&shape.id<=4?normalizeNetSymbol({...shape,netSymbol:true}):shape);
 await page.goto("/tests/browser/projects.html");
 await expect(page.locator("#project-document")).toContainText('"name":"Untitled"');
 await page.evaluate(async ({file,shapes})=>{
  const path="/packages/web/src/projects/storage.ts";
  const {createWebProjectStorage}=await import(path);
  const storage=createWebProjectStorage();const project=await storage.load();
  await storage.save(project.directory,{shapes,symbols:[],circuits:[file]});
 },{file:stale.file,shapes});
 await page.reload();
 await (await openProjectFiles(page)).getByRole("link",{name:"Open Untitled.ecaddraw in circuit view",exact:true}).click();
 await closeProjectFiles(page);
 await expect(page.locator(".circuit-net")).toHaveCount(2);
 await expect(page.getByRole("button",{name:"Net VDD",exact:true})).toHaveCount(1);
 await expect(page.getByRole("button",{name:"Net GND",exact:true})).toHaveCount(1);
 await expect(page.locator(".circuit-component")).toHaveCount(4);
 await expect(page.locator(".circuit-edge")).toHaveCount(4);
 await page.getByRole("button",{name:"Switch to schematic view",exact:true}).click();
 await page.getByRole("button",{name:"Switch to circuit view",exact:true}).click();
 await expect(page.locator(".circuit-net")).toHaveCount(2);
 await mkdir("/tmp/ecad-net-merge",{recursive:true});
 await page.screenshot({path:`/tmp/ecad-net-merge/duplicate-${kind}-supplies.png`});
});
