import test from "node:test";
import assert from "node:assert/strict";
import {
  candidateDirs,
  executableName,
  findOpenCodeBinary,
  inspectVersion,
  npmInstallArgs,
  OPENCODE_PACKAGE,
  parseMode,
  parseOpenCodeVersion,
} from "../src/zombie/opencodeRuntime.ts";

test("parseOpenCodeVersion reads the V2 version and ignores trailing build text", () => {
  assert.deepEqual(parseOpenCodeVersion("2.2.5"), { version: "2.2.5", major: 2 });
  assert.deepEqual(parseOpenCodeVersion("opencode v2.1.1-beta.2\n"), {
    version: "2.1.1",
    major: 2,
  });
  assert.equal(parseOpenCodeVersion("nonsense"), null);
  assert.equal(parseOpenCodeVersion(""), null);
});

test("executableName follows the target platform, not the host", () => {
  assert.equal(executableName("linux"), "opencode");
  assert.equal(executableName("darwin"), "opencode");
  assert.equal(executableName("win32"), "opencode.exe");
});

test("candidateDirs covers the node bin directory, PATH and common install dirs", () => {
  const dirs = candidateDirs({
    home: "/home/tester",
    platform: "linux",
    env: { PATH: "/custom/bin:/second/bin" },
    execPath: "/node/bin/node",
  });
  assert.equal(dirs[0], "/node/bin");
  assert.ok(dirs.includes("/custom/bin"));
  assert.ok(dirs.includes("/second/bin"));
  assert.ok(dirs.includes("/home/tester/.local/bin"));
  assert.ok(dirs.includes("/home/tester/bin"));
  assert.ok(dirs.includes("/usr/local/bin"));
  assert.equal(new Set(dirs).size, dirs.length, "candidate directories must be unique");
});

test("findOpenCodeBinary walks extra dirs, then PATH, and stops at the first real binary", () => {
  const seen: string[] = [];
  const found = findOpenCodeBinary({
    home: "/home/tester",
    platform: "linux",
    env: { PATH: "/path/b:/path/a" },
    execPath: "/node/bin/node",
    extraDirs: ["/explicit/bin"],
    exists: (file) => {
      seen.push(file);
      return file === "/path/a/opencode";
    },
  });
  assert.equal(found, "/path/a/opencode");
  assert.ok(seen.includes("/explicit/bin/opencode"));
  assert.ok(seen.indexOf("/path/b/opencode") < seen.indexOf("/path/a/opencode"));
});

test("parseMode defaults to auto, maps --no-opencode to none and rejects typos", () => {
  assert.equal(parseMode(undefined, false), "auto");
  assert.equal(parseMode("install", false), "install");
  assert.equal(parseMode("none", false), "none");
  assert.equal(parseMode("install", true), "none");
  assert.throws(() => parseMode("download", false), /--opencode must be auto, install or none/);
});

test("npmInstallArgs installs the V2 package, with an optional prefix", () => {
  assert.equal(OPENCODE_PACKAGE, "@opencode/cli");
  assert.deepEqual(npmInstallArgs(), ["install", "-g", "@opencode/cli@latest"]);
  assert.deepEqual(npmInstallArgs("/tmp/prefix"), [
    "install",
    "-g",
    "--prefix",
    "/tmp/prefix",
    "@opencode/cli@latest",
  ]);
});

test("inspectVersion reports found only when the probe yields a version", () => {
  const ok = inspectVersion("/bin/opencode", () => "2.2.5\n");
  assert.equal(ok.found, true);
  assert.equal(ok.path, "/bin/opencode");
  assert.equal(ok.version, "2.2.5");
  assert.equal(ok.major, 2);

  const failed = inspectVersion("/bin/opencode", () => {
    throw new Error("spawn failed");
  });
  assert.equal(failed.found, false);
  assert.equal(failed.version, null);
});
