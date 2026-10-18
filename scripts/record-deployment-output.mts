import { appendFileSync, readFileSync } from "node:fs";
import { parseWranglerDeploymentUrl } from "./deployment-output.js";

const wranglerOutputPath = process.env.WRANGLER_OUTPUT_FILE_PATH;
if (!wranglerOutputPath) throw new Error("WRANGLER_OUTPUT_FILE_PATH must identify Wrangler's output file");
const githubOutputPath = process.env.GITHUB_OUTPUT;
if (!githubOutputPath) throw new Error("GITHUB_OUTPUT must identify the workflow output file");

const deploymentUrl = parseWranglerDeploymentUrl(readFileSync(wranglerOutputPath, "utf8"));
appendFileSync(githubOutputPath, `deployment_url=${deploymentUrl}\n`);
