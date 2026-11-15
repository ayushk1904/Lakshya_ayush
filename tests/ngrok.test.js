const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { prepareNgrokConfig } = require("../scripts/ngrok-config");

test("the project token selects an explicit CLI config and stays out of arguments", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lakshya-ngrok-test-"));
  const token = 'test-project-token';
  const config = prepareNgrokConfig(root, token);
  try {
    assert.equal(config.args[0], "--config");
    assert.ok(!config.args.join(" ").includes(token));
    assert.match(fs.readFileSync(config.args[1], "utf8"), /authtoken: "test-project-token"/);
  } finally {
    config.cleanup();
    assert.ok(!fs.existsSync(config.args[1]));
    fs.rmdirSync(path.join(root, ".cache"));
    fs.rmdirSync(root);
  }
});

test("without a project token the existing ngrok account remains the fallback", () => {
  const config = prepareNgrokConfig(__dirname, " ");
  assert.deepEqual(config.args, []);
  config.cleanup();
});
