import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "node_modules/swagger-ui-dist");
const destination = resolve(root, "public/swagger-ui");
const assets = ["swagger-ui.css", "swagger-ui-bundle.js"];

await mkdir(destination, { recursive: true });
for (const asset of assets) await cp(resolve(source, asset), resolve(destination, asset));
