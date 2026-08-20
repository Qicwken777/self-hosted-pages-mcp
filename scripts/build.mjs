// ESA Pages build script: copy static assets to the output directory.
import { mkdirSync, copyFileSync, existsSync } from "node:fs";

mkdirSync("public", { recursive: true });

const assets = ["index.html"];

for (const file of assets) {
  if (existsSync(file)) {
    copyFileSync(file, `public/${file}`);
    console.log(`copied ${file} -> public/${file}`);
  }
}

console.log("ESA build done.");