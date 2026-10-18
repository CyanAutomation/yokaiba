function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isDirectWorkerUrl(target: unknown): target is string {
  if (typeof target !== "string") return false;
  try {
    const url = new URL(target);
    return url.protocol === "https:" && url.hostname.endsWith(".workers.dev");
  } catch {
    return false;
  }
}

/** Read Wrangler's newline-delimited output and return the deployed Worker URL. */
export function parseWranglerDeploymentUrl(output: string): string {
  let records: unknown[];
  try {
    records = output.trim().split(/\r?\n/).map(line => JSON.parse(line) as unknown);
  } catch (error) {
    throw new Error("Wrangler wrote invalid machine-readable deployment information", { cause: error });
  }

  let deployment: Record<string, unknown> | undefined;
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = asRecord(records[index]);
    if (record?.type === "deploy") {
      deployment = record;
      break;
    }
  }
  if (!deployment) throw new Error("Wrangler did not write machine-readable deployment information");
  if (deployment.worker_name !== "yokaiba") {
    throw new Error(`Wrangler deployed unexpected Worker ${JSON.stringify(deployment.worker_name)}`);
  }

  const targets = Array.isArray(deployment.targets) ? deployment.targets : [];
  const directUrls = targets.filter(isDirectWorkerUrl);
  if (directUrls.length !== 1) {
    throw new Error(`Expected exactly one direct workers.dev deployment target, received ${JSON.stringify(directUrls)}`);
  }
  return directUrls[0];
}
