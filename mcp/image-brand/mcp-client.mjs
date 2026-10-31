import { spawn } from "node:child_process";
import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export async function startServer({ timeoutMs = 120000 } = {}) {
  const child = spawn(process.execPath, [path.join(HERE, "server.mjs")], {
    cwd: HERE,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map();
  let nextId = 1;
  let stderr = "";
  const rl = readline.createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message || JSON.stringify(message.error)));
    else waiter.resolve(message.result);
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  child.on("exit", (code) => {
    for (const waiter of pending.values()) waiter.reject(new Error(`server exited ${code}: ${stderr.trim()}`));
    pending.clear();
  });

  function request(method, params) {
    const id = nextId++;
    const payload = { jsonrpc: "2.0", id, method, ...(params ? { params } : {}) };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      child.stdin.write(JSON.stringify(payload) + "\n");
    });
  }

  async function callTool(name, args) {
    const result = await request("tools/call", { name, arguments: args });
    const text = result?.content?.find((entry) => entry.type === "text")?.text ?? "";
    if (result?.isError) throw new Error(text || `tool ${name} failed`);
    try {
      return JSON.parse(text);
    } catch {
      return { text };
    }
  }

  async function close() {
    rl.close();
    child.stdin.end();
    await new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once("exit", resolve);
      child.kill("SIGTERM");
    });
  }

  return { child, request, callTool, close, stderr: () => stderr };
}
