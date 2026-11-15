#!/usr/bin/env node
// Exercise real AI routes with an isolated temporary user; remove all fixture data afterward.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "..");
const serverRequire = createRequire(path.join(root, "server", "package.json"));
serverRequire("dotenv").config({ path: path.join(root, ".env") });
serverRequire("dotenv").config({ path: path.join(root, "server", ".env") });
const tls = require("node:tls");
if (process.env.NODE_USE_SYSTEM_CA === "1" && tls.setDefaultCACertificates) {
  tls.setDefaultCACertificates([...tls.getCACertificates("default"), ...tls.getCACertificates("system")]);
}
const mongoose = serverRequire("mongoose");
const User = require("../server/src/models/User");
const ConceptDocument = require("../server/src/models/ConceptDocument");
const ChatRoom = require("../server/src/models/ChatRoom");
const ChatMessage = require("../server/src/models/ChatMessage");
const { signToken } = require("../server/src/utils/auth");
const results = [];

const notes = `Relational algebra operations can be implemented with MapReduce.
Selection filters rows: each mapper emits only tuples satisfying the predicate; reducers are optional.
Projection keeps selected columns. Mappers emit the projected tuple as a key; reducers remove duplicates.
Union maps tuples from both relations to the same key; reducers emit each distinct tuple once.
Intersection tags tuples by their source relation and emits tuples appearing in both sources.
Set difference emits tuples present in relation R but absent from relation S, using source tags.
Join maps both relations using the join attribute as key, tags the source, and combines matching tuples in the reducer.
Grouping and aggregation use group attributes as keys. Reducers calculate sums, counts or averages.
A combiner may compute partial sums locally, but averaging requires carrying both a sum and a count.`;

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  let user;
  let server;
  try {
    const id = crypto.randomUUID();
    user = await User.create({ name: `AI check ${id}`, email: `ai-check-${id}@example.invalid`, password: await serverRequire("bcryptjs").hash(crypto.randomBytes(24).toString("hex"), 10) });
    let baseUrl = `http://127.0.0.1:${process.env.PORT || 5000}`;
    if (!process.argv.includes("--live")) {
      server = require("../server/src/app").listen(0, "127.0.0.1");
      await new Promise((resolve) => server.once("listening", resolve));
      baseUrl = `http://127.0.0.1:${server.address().port}`;
    }
    const token = signToken(user);
    async function request(route, body) {
      const multipart = body instanceof FormData;
      const response = await fetch(`${baseUrl}/api${route}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, ...(multipart ? {} : { "Content-Type": "application/json" }) },
        body: multipart ? body : JSON.stringify(body),
        signal: AbortSignal.timeout(180000)
      });
      const data = await response.json();
      assert.ok(response.ok, `${route}: ${data.message || response.status}`);
      return data;
    }
    async function measure(feature, callback) {
      const started = performance.now();
      const detail = await callback();
      const result = { feature, seconds: Math.round((performance.now() - started) / 10) / 100, ...detail };
      results.push(result);
      console.log(JSON.stringify(result));
    }

    const upload = new FormData();
    upload.append("file", new Blob([notes], { type: "text/plain" }), "ai-check-notes.txt");
    const uploaded = await request("/concept-explainer/documents", upload);
    const documentIds = [uploaded.document._id];

    await measure("Concept explanation", async () => {
      const data = await request("/concept-explainer/ask", { question: "Explain different relational algebra operations using MapReduce, with an example and a small diagram.", documentIds });
      assert.equal(data.source, "ollama");
      assert.ok(data.answer.length > 100 && data.easyExplanation.length > 30);
      return { source: data.source, answerCharacters: data.answer.length };
    });
    await measure("PDF quiz (5 questions)", async () => {
      const data = await request("/concept-explainer/game", { questionCount: 5, documentIds });
      assert.equal(data.source, "ollama");
      assert.equal(data.quiz.questions.length, 5);
      assert.ok(data.quiz.questions.every((question) => question.options.length === 4 && question.answerIndex >= 0 && question.answerIndex < 4));
      return { source: data.source, questions: data.quiz.questions.length };
    });
    const topics = [
      { topic: "Selection", question: "How does selection work in MapReduce?", expectedPoints: ["Filter rows in the mapper", "Emit matching tuples"] },
      { topic: "Projection", question: "How does projection work?", expectedPoints: ["Keep selected columns", "Remove duplicate tuples"] }
    ];
    let question;
    await measure("Voice coach question", async () => {
      question = await request("/study-plans/voice-revision/start", { learnerName: "Test student", studyMaterial: notes, topics, questionIndex: 0, askedTopics: [] });
      assert.equal(question.source, "ollama");
      assert.ok(question.question);
      return { source: question.source };
    });
    await measure("Voice coach evaluation", async () => {
      const data = await request("/study-plans/voice-revision/evaluate", { learnerName: "Test student", studyMaterial: notes, topics, questionIndex: 0, askedTopics: [question.topic], currentQuestion: question, answer: "The mapper filters rows by checking a predicate and emits the tuples that satisfy it.", previousAnswers: [] });
      assert.equal(data.evaluation.source, "ollama");
      return { source: data.evaluation.source };
    });
    await measure("Answer evaluator", async () => {
      const body = new FormData();
      body.append("studentSolution", new Blob(["Selection filters rows in the mapper. Projection keeps the requested columns."], { type: "text/plain" }), "student.txt");
      body.append("topperSolution", new Blob([notes], { type: "text/plain" }), "reference.txt");
      const data = await request("/answer-evaluator/evaluate", body);
      assert.equal(data.source, "ollama");
      assert.ok(data.evaluation.marks >= 0 && data.evaluation.marks <= 100);
      return { source: data.source };
    });
    const room = await request("/chat-rooms", { name: `AI check ${id.slice(0, 8)}`, subject: "Relational algebra", invitedEmails: [] });
    await measure("Study Hub chat", async () => {
      const data = await request(`/chat-rooms/${room.room._id}/messages`, { text: "@ai Explain MapReduce projection in two short sentences." });
      const answer = data.messages.findLast((message) => message.user?.role === "ai");
      assert.ok(answer?.text?.length > 20);
      assert.ok(!answer.text.includes("here is my quick take on that"));
      return { answered: true };
    });
  } finally {
    if (user) {
      const roomIds = (await ChatRoom.find({ "members.userId": user._id }).select("_id")).map((room) => room._id);
      await ChatMessage.deleteMany({ roomId: { $in: roomIds } });
      await ChatRoom.deleteMany({ _id: { $in: roomIds } });
      await ConceptDocument.deleteMany({ userId: user._id });
      await User.deleteOne({ _id: user._id });
      console.log("Temporary AI-check data removed.");
    }
    if (server) await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    fs.mkdirSync(path.join(root, ".cache"), { recursive: true });
    fs.writeFileSync(path.join(root, ".cache", "ai-feature-results.json"), JSON.stringify(results, null, 2));
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
