#!/usr/bin/env node
// One-command installer for people who do not want to learn the flags.
//
//   git clone https://github.com/azurebluezone/ZombieCoder-Autonomous-Plugin.git
//   cd ZombieCoder-Autonomous-Plugin
//   node bin/quick-install.mjs
//
// Press 1, 2, 3, 4 or 5. The script runs the real install pipeline; it does not
// duplicate install logic. `--yes` picks option 1 for CI.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const INSTALL = path.join(ROOT, "bin", "install.mjs");
const SETUP = path.join(ROOT, "scripts", "setup.mjs");
const argv = process.argv.slice(2);

function versionAtLeast(current, minimum) {
  const a = current.split(".").map(Number);
  const b = minimum.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left > right) return true;
    if (left < right) return false;
  }
  return true;
}

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(`ZombieCoder quick install

Usage:
  node bin/quick-install.mjs
  node bin/quick-install.mjs --yes
  node bin/quick-install.mjs --choice=1|2|3|4|5 [--dir <project>]

1) Install/update on this computer (recommended, ~/.opencode)
2) Fast start with the free baseline model
3) Install into the current folder only
4) Verify only (current folder, or --dir)
5) Exit

No npm knowledge is needed. Node.js 22.6 or newer is required.`);
  process.exit(0);
}

if (!versionAtLeast(process.versions.node, "22.6.0")) {
  console.error(
    `Node.js 22.6+ দরকার। এখন চলছে ${process.versions.node}. https://nodejs.org থেকে LTS ইনস্টল করুন।`,
  );
  process.exit(1);
}

function run(label, command, args, options = {}) {
  console.log("");
  console.log(`▶ ${label}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    stdio: "inherit",
    env: { ...process.env, ...(options.env ?? {}) },
    timeout: options.timeout ?? 0,
  });
  if (result.error) {
    console.error(`✖ ${label}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`✖ ${label} — exit ${result.status}`);
    process.exit(result.status ?? 1);
  }
  return result;
}

function install(args) {
  run("ZombieCoder install", process.execPath, [
    "--experimental-strip-types",
    INSTALL,
    ...args,
    "--yes",
  ]);
}

function verify(target = process.cwd()) {
  run("ZombieCoder verify", process.execPath, [
    "--experimental-strip-types",
    SETUP,
    "--status",
    "--dir",
    target,
  ]);
}

function finish(projectDir = process.cwd()) {
  const self = fileURLToPath(import.meta.url);
  console.log("");
  console.log("=".repeat(64));
  console.log("✅ কাজ শেষ।");
  console.log("   OpenCode বন্ধ করে আবার খুলুন — নতুন plugin/config load হবে।");
  console.log("   তারপর যেকোনো project folder খুলে agent বেছে নিন।");
  const verifyTarget = fs.existsSync(path.join(projectDir, ".zombiecoder"))
    ? projectDir
    : "<your-project>";
  console.log(`   verify: node "${self}" --choice=4 --dir "${verifyTarget}"`);
  console.log("=".repeat(64));
}

const choiceArg = argv.find((arg) => arg.startsWith("--choice="));
const dirArgIndex = argv.indexOf("--dir");
const projectDir =
  dirArgIndex >= 0 && argv[dirArgIndex + 1] ? path.resolve(argv[dirArgIndex + 1]) : process.cwd();
const auto = argv.includes("--yes");
let choice = choiceArg ? Number(choiceArg.split("=")[1]) : null;

if (!choice && auto) choice = 1;

if (!choice) {
  console.log("");
  console.log("ZombieCoder — সহজ ইনস্টল");
  console.log("=".repeat(64));
  console.log("1) এই computer-এ একবার install/update (recommended)");
  console.log("2) Fast start — free baseline model (local GPU লাগবে না)");
  console.log("3) শুধু এই folder-এর project-এ install");
  console.log("4) শুধু verify (কিছু বদলাবে না)");
  console.log("5) বন্ধ");
  console.log("=".repeat(64));
  if (!process.stdin.isTTY) {
    console.log("Non-interactive terminal — option 1 চালানো হচ্ছে।");
    choice = 1;
  } else {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = (await rl.question("একটি সংখ্যা লিখুন [1]: ")).trim();
      choice = answer ? Number(answer) : 1;
    } finally {
      rl.close();
    }
  }
}

if (![1, 2, 3, 4, 5].includes(choice)) {
  console.error("1–5-এর মধ্যে একটি সংখ্যা দিন।");
  process.exit(2);
}

const home = os.homedir();
const globalRoot = path.join(home, ".opencode");

if (choice === 1) {
  if (!fs.existsSync(INSTALL)) {
    console.error(`installer পাওয়া যায়নি: ${INSTALL}`);
    process.exit(1);
  }
  install(["--config-dir", globalRoot]);
  finish(projectDir);
} else if (choice === 2) {
  install(["--config-dir", globalRoot, "--fast"]);
  finish(projectDir);
} else if (choice === 3) {
  install(["--dir", projectDir]);
  finish(projectDir);
} else if (choice === 4) {
  verify(projectDir);
} else {
  console.log("ঠিক আছে, কিছু বদলানো হলো না।");
}
