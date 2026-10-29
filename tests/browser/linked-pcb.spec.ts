import { captureArtifacts } from "./artifacts";
import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { openProjectFiles, closeProjectFiles } from "./project-files";
import { toolbarButton } from "./toolbar";

test("PCB folder opens linked circuit and schematic and saves both directions", async ({page}) => {
 const errors:string[]=[];page.on("pageerror", error=>errors.push(error.message));
 await page.goto("/tests/browser/projects.html");
 await openProjectFiles(page);
 await page.getByRole("link",{name:"Open Untitled.ecadcircuit",exact:true}).click();
 await closeProjectFiles(page);
 await page.getByRole("button",{name:"Components",exact:true}).click();
 await page.getByRole("searchbox",{name:"Search components",exact:true}).fill("Resistor");
 await page.getByRole("button",{name:"Place Resistor",exact:true}).click();
 await page.getByLabel("Circuit connections graph",{exact:true}).click({position:{x:350,y:250}});
 await expect(page.getByLabel("Circuit save status")).toHaveText("Saved");
 const circuit=JSON.parse((await page.locator("#circuit-document").textContent())!);
 await openProjectFiles(page);
 await page.getByRole("link",{name:"Open Untitled.ecaddraw",exact:true}).click();
 await closeProjectFiles(page);
 await expect.poll(async()=>JSON.parse((await page.locator("#project-document").textContent())!).shapes.filter((s:{kind:string})=>s.kind==="symbol").length).toBe(1);
 await page.getByRole("button",{name:"Symbols",exact:true}).click();
 await page.getByRole("searchbox",{name:"Search symbols"}).fill("Resistor");
 await page.getByRole("button",{name:"Insert Resistor",exact:true}).click();
 await page.locator("canvas").click({position:{x:650,y:350}});
 await expect.poll(async()=>JSON.parse((await page.locator("#project-document").textContent())!).shapes.filter((shape:{kind:string})=>shape.kind==="symbol").length).toBe(2);
 await expect.poll(async()=>JSON.parse((await page.locator("#project-document").textContent())!).dirty).toBe(false);
 await (await toolbarButton(page,"Undo")).click();
 await expect.poll(async()=>JSON.parse((await page.locator("#project-document").textContent())!).shapes.filter((shape:{kind:string})=>shape.kind==="symbol").length).toBe(1);
 await (await toolbarButton(page,"Redo")).click();
 await expect.poll(async()=>JSON.parse((await page.locator("#project-document").textContent())!).shapes.filter((shape:{kind:string})=>shape.kind==="symbol").length).toBe(2);
 await expect.poll(async()=>JSON.parse((await page.locator("#project-document").textContent())!).dirty).toBe(false);
 await openProjectFiles(page);
 if(captureArtifacts){
  await mkdir("artifacts",{recursive:true});
  await page.screenshot({path:"artifacts/linked-pcb-sidebar.png"});
 }
 await page.getByRole("link",{name:"Open Untitled.ecadcircuit",exact:true}).click();
 await closeProjectFiles(page);
 expect(JSON.parse((await page.locator("#circuit-document").textContent())!).circuit.components[0].id).toBe(circuit.circuit.components[0].id);
 await expect(page.getByRole("button",{name:"Select component R2",exact:true})).toBeAttached();
 await page.reload();
 await openProjectFiles(page);
 await page.getByRole("link",{name:"Open Untitled.ecadcircuit",exact:true}).click();
 await expect(page.getByRole("button",{name:"Select component R1",exact:true})).toBeAttached();
 expect(errors).toEqual([]);
});
