import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer as start } from "../shared/client.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function startServer(options = {}) {
  return start(path.join(HERE, "server.mjs"), options);
}
