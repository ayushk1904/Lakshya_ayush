const assert = require("node:assert/strict");
const { test } = require("node:test");
const { buildStudyContext } = require("../server/src/utils/studyContext");

test("retrieves relevant material late in a PDF instead of using only its first pages", () => {
  const documents = [{ fileName: "notes.pdf", extractedText: "Introduction to courses. ".repeat(800) + "Relational algebra joins use MapReduce to group records by their common join key." }];
  const context = buildStudyContext(documents, "Explain relational algebra joins using MapReduce", 2500);
  assert.match(context, /common join key/);
  assert.ok(context.length <= 2500);
});

test("quiz context samples topics across documents within its token budget", () => {
  const documents = [
    { fileName: "first.txt", extractedText: "Start topic. " + "middle content. ".repeat(1200) + "End chapter." },
    { fileName: "second.txt", extractedText: "Second subject has queues and stacks." }
  ];
  const context = buildStudyContext(documents, "", 12000);
  assert.match(context, /first.txt/);
  assert.match(context, /second.txt/);
  assert.match(context, /End chapter/);
  assert.ok(context.length <= 12000);
});
