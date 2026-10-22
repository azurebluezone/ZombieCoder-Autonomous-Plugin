import test from "node:test";
import assert from "node:assert/strict";
import { parseEnvironmentFile } from "../src/zombie/io.ts";

test("parseEnvironmentFile reads dotenv-style assignments without evaluation", () => {
  assert.deepEqual(
    parseEnvironmentFile(
      [
        "# comment",
        "export EXTERNAL_MCP_EXTERNAL_OPENAI_COMPATIBLE_URL='https://gateway.example/v1'",
        "EXTERNAL_MCP_EXTERNAL_OPENAI_COMPATIBLE_API_KEY='provider-secret'",
        "EXTERNAL_MCP_URL=https://mcp.example/mcp",
        "EMPTY=",
        "QUOTED=\"value # kept\"",
        "UNQUOTED=value # comment",
        "not an assignment",
      ].join("\n"),
    ),
    {
      EXTERNAL_MCP_EXTERNAL_OPENAI_COMPATIBLE_URL: "https://gateway.example/v1",
      EXTERNAL_MCP_EXTERNAL_OPENAI_COMPATIBLE_API_KEY: "provider-secret",
      EXTERNAL_MCP_URL: "https://mcp.example/mcp",
      EMPTY: "",
      QUOTED: "value # kept",
      UNQUOTED: "value",
    },
  );
});
