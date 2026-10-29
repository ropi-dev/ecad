import { expect, test } from "@playwright/test";
import { createCircuit } from "@ecad/drawing-core/circuit/model.ts";
import { componentFromSymbol } from "#/circuit/symbol-components.ts";
import { synchronizePcb } from "#/circuit/linked-schematic.ts";
import { symbolDefinitions } from "#/drawing/symbols.ts";
import { openProjectFiles, closeProjectFiles } from "./project-files";

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
