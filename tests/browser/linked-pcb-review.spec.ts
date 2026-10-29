import { expect, test, type Page } from "@playwright/test";
import { createCircuit } from "@ecad/drawing-core/circuit/model.ts";
import { synchronizePcb } from "#/circuit/linked-schematic.ts";
import { libraryDefinitions, type SymbolFile } from "#/components/editor/symbolFormat.ts";
import { createSymbol } from "#/drawing/symbols.ts";
import { closeProjectFiles, openProjectFiles } from "./project-files";
import { toolbarButton } from "./toolbar";

const documentState = async (page: Page) => JSON.parse((await page.locator("#project-document").textContent())!);
async function rectangle(page: Page) {
 await closeProjectFiles(page);
 await (await toolbarButton(page,"Rectangle")).click();
 await page.mouse.move(600,300);await page.mouse.down();await page.mouse.move(680,360);await page.mouse.up();
}

test("autosave retains a qualified symbol from a shadowed user library",async({page})=>{
 const lower:SymbolFile={format:"ecad-symbol",version:1,units:"mm",id:"shared",name:"Shared",description:"",prefix:"U",value:"LOW",shapes:[{kind:"pin",name:"LOW",number:"1",x:-3,y:0}]};
 const upper:SymbolFile={...lower,value:"HIGH",shapes:[{kind:"pin",name:"HIGH",number:"2",x:-8,y:0}]};
 const definition={...libraryDefinitions([lower])[0],library:{scope:"user" as const,id:"lower"}};
 const original=createCircuit("Untitled","pcb-main");
 const first=synchronizePcb(original,[createSymbol(1,definition,{x:0,y:0},"U1")],original,[definition]);
 await page.goto("/tests/browser/projects.html");await expect(page.locator("#project-document")).toContainText('"name":"Untitled"');
 await page.evaluate(async({first,lower,upper})=>{
  const module="/packages/web/src/projects/storage.ts";const {createWebProjectStorage}=await import(module);
  const storage=createWebProjectStorage();const project=await storage.load();
  await storage.save(project.directory,{shapes:first.shapes,symbols:[],circuits:[first.file]});
  localStorage.setItem("ecad.user-config.v1",JSON.stringify({version:1,symbolLibraries:[{id:"lower",name:"Lower",enabled:true,source:{kind:"embedded",symbols:[lower]}},{id:"upper",name:"Upper",enabled:true,source:{kind:"embedded",symbols:[upper]}}]}));
 },{first,lower,upper});
 await page.reload();
 await (await openProjectFiles(page)).getByRole("link",{name:"Open Untitled.ecaddraw",exact:true}).click();
 await rectangle(page);
 await expect.poll(async()=>(await documentState(page)).shapes.length).toBe(2);
 await expect.poll(async()=>(await documentState(page)).dirty).toBe(false);
 await expect(page.getByRole("alert")).toHaveCount(0);
 await page.reload();
 await (await openProjectFiles(page)).getByRole("link",{name:"Open Untitled.ecadcircuit",exact:true}).click();
 await expect.poll(async()=>JSON.parse((await page.locator("#circuit-document").textContent())!).circuit.components[0].pins.map((pin:{name:string,number:string})=>[pin.name,pin.number])).toEqual([["LOW","1"]]);
 expect((await documentState(page)).shapes).toHaveLength(2);
});

test("a drawing named Main saves independently of the primary PCB",async({page})=>{
 await page.goto("/tests/browser/projects.html");await expect(page.locator("#project-document")).toContainText('"name":"Untitled"');
 await (await openProjectFiles(page)).getByRole("link",{name:"Schematic editor",exact:true}).click();
 await rectangle(page);
 await expect.poll(async()=>(await documentState(page)).dirty).toBe(false);
 const primary=(await documentState(page)).shapes;
 await (await openProjectFiles(page)).getByRole("button",{name:"Add file",exact:true}).click();
 await page.getByRole("menuitem",{name:"New drawing",exact:true}).click();
 await page.getByLabel("Drawing name",{exact:true}).fill("Main");
 await page.getByRole("button",{name:"Create drawing",exact:true}).click();
 await expect(page.getByRole("heading",{level:1})).toContainText("Schematic editor · Main");
 await rectangle(page);
 await expect.poll(async()=>(await documentState(page)).drawings[0]?.shapes.length).toBe(1);
 await expect.poll(async()=>(await documentState(page)).dirty).toBe(false);
 const drawing=(await documentState(page)).drawings[0];
 expect(drawing.circuitId).not.toBe("pcb-main");
 await page.reload();
 await (await openProjectFiles(page)).getByRole("link",{name:"Open Main.ecaddraw",exact:true}).click();
 expect((await documentState(page)).editorShapes).toEqual(drawing.shapes);
 expect((await documentState(page)).shapes).toEqual(primary);
});

test("moving a symbol keeps generated net connections through autosave and reload",async({page})=>{
 const definitionsModule=await import("#/drawing/symbols.ts");
 const {componentFromSymbol}=await import("#/circuit/symbol-components.ts");
 const original=createCircuit("Untitled","pcb-main");const file=structuredClone(original);
 const definition=definitionsModule.symbolDefinitions.find(definition=>definition.id==="resistor")!;
 const a=componentFromSymbol(definition,[]),b=componentFromSymbol(definition,[a]);file.circuit.components=[a,b];file.circuit.nets=[{id:"signal",names:[],pinIds:[a.pins[1].id,b.pins[0].id]}];
 const first=synchronizePcb(file,[],original,definitionsModule.symbolDefinitions);
 await page.goto("/tests/browser/projects.html");await expect(page.locator("#project-document")).toContainText('"name":"Untitled"');
 await page.evaluate(async(first)=>{
  const module="/packages/web/src/projects/storage.ts";const {createWebProjectStorage}=await import(module);const storage=createWebProjectStorage();const project=await storage.load();
  await storage.save(project.directory,{shapes:first.shapes.map((shape:{x:number,y:number})=>({...shape,x:shape.x-45,y:shape.y+30})),symbols:[],circuits:[first.file]});
 },first);
 await page.reload();await (await openProjectFiles(page)).getByRole("link",{name:"Open Untitled.ecaddraw",exact:true}).click();await closeProjectFiles(page);
 for(let index=0;index<10;index++)await page.getByRole("button",{name:"Zoom in",exact:true}).click();
 const canvas=page.locator("canvas");const bounds=(await canvas.boundingBox())!;
 await page.mouse.move(bounds.x+384,bounds.y+360);await page.mouse.down();await page.mouse.move(bounds.x+384,bounds.y+440,{steps:8});await page.mouse.up();
 await expect.poll(async()=>(await documentState(page)).shapes.find((shape:{id:number})=>shape.id===first.file.circuit.components[0].schematicShapeId)?.y).not.toBe(0);
 await expect.poll(async()=>(await documentState(page)).dirty).toBe(false);
 if(process.env.ECAD_SCREENSHOT_PATH)await page.screenshot({path:process.env.ECAD_SCREENSHOT_PATH});
 await page.reload();await (await openProjectFiles(page)).getByRole("link",{name:"Open Untitled.ecadcircuit",exact:true}).click();
 await expect.poll(async()=>JSON.parse((await page.locator("#circuit-document").textContent())!).circuit.nets).toEqual(file.circuit.nets);
});
