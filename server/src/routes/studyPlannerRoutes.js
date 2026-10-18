// RAG study planner: syllabus + previous-paper library and plan generation.
// The AI work (indexing, retrieval, planning) runs in the Python service in /planner-ai.

const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const { PDFParse } = require("pdf-parse");
const authMiddleware = require("../middleware/authMiddleware");
const PreviousPaper = require("../models/PreviousPaper");
const StudyPlan = require("../models/StudyPlan");
const SyllabusDocument = require("../models/SyllabusDocument");
const { addPaperPdf, fixFileName, isPdf } = require("../services/paperAnalysis");
const { buildPlan, ingestSyllabus, warmPlanner } = require("../services/plannerAiClient");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

router.use(authMiddleware);

async function extractText(file) {
  const isPdf = file.mimetype === "application/pdf" || /\.pdf$/i.test(file.originalname);
  if (!isPdf) {
    return file.buffer.toString("utf8");
  }

  const parser = new PDFParse({ data: file.buffer });
  try {
    const result = await parser.getText();
    return result.text || "";
  } finally {
    await parser.destroy?.().catch(() => {});
  }
}

function serializeSyllabus(doc) {
  return {
    _id: doc._id,
    fileName: doc.fileName,
    status: doc.status,
    progress: doc.progress,
    error: doc.error,
    extractionMode: doc.extractionMode,
    semesters: doc.semesters,
    createdAt: doc.createdAt,
    subjects: (doc.subjects || []).map((subject) => ({
      key: subject.key,
      name: subject.name,
      code: subject.code,
      semester: subject.semester,
      kind: subject.kind,
      unitCount: subject.units.length,
      topicCount: subject.units.reduce((sum, unit) => sum + unit.topics.length, 0)
    }))
  };
}

function serializePaper(paper) {
  return { _id: paper._id, fileName: fixFileName(paper.fileName), createdAt: paper.createdAt };
}

function todayInAppZone() {
  return new Date().toLocaleDateString("en-CA", { timeZone: process.env.APP_TIMEZONE || "Asia/Kolkata" });
}

async function processSyllabus(docId, text) {
  try {
    await SyllabusDocument.updateOne({ _id: docId }, { status: "processing", error: "", progress: { done: 0, total: 0 } });
    const result = await ingestSyllabus(text, (progress) => SyllabusDocument.updateOne({ _id: docId }, { progress }).catch(() => {}));

    const theoryCount = result.subjects.filter((subject) => subject.kind === "theory").length;
    await SyllabusDocument.updateOne(
      { _id: docId },
      theoryCount
        ? {
            status: "ready",
            subjects: result.subjects,
            chunks: result.chunks,
            semesters: result.semesters,
            extractionMode: result.extractionMode
          }
        : {
            status: "failed",
            error: "No subjects with units/modules were found. Upload the detailed syllabus (with module or unit contents), not the scheme or a result sheet."
          }
    );
  } catch (error) {
    console.error("syllabus processing error:", error);
    await SyllabusDocument.updateOne({ _id: docId }, { status: "failed", error: error.message || "Failed to index syllabus" }).catch(() => {});
  }
}

// If the backend restarted mid-indexing, those syllabi would stay "processing" forever; pick them up again.
async function resumeInterruptedIndexing() {
  const stuck = await SyllabusDocument.find({ status: "processing" }).select("_id rawText fileName");
  for (const doc of stuck) {
    console.log(`Resuming syllabus indexing: ${doc.fileName}`);
    await processSyllabus(doc._id, doc.rawText);
  }
}

router.get("/library", async (req, res) => {
  warmPlanner();
  const [syllabi, papers] = await Promise.all([
    SyllabusDocument.find({ userId: req.user._id }).select("-rawText -chunks").sort({ createdAt: -1 }),
    PreviousPaper.find({ userId: req.user._id }).select("fileName createdAt").sort({ createdAt: -1 })
  ]);

  return res.json({ syllabi: syllabi.map(serializeSyllabus), papers: papers.map(serializePaper) });
});

router.post("/syllabi", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "Upload a syllabus PDF." });
  }

  try {
    const text = (await extractText(req.file)).trim();
    if (text.replace(/\s+/g, "").length < 200) {
      return res.status(400).json({ message: "This PDF has no readable text. Scanned PDFs are not supported yet. Upload a text-based syllabus PDF." });
    }

    const doc = await SyllabusDocument.create({
      userId: req.user._id,
      fileName: req.file.originalname,
      rawText: text.slice(0, 250_000),
      status: "processing"
    });

    processSyllabus(doc._id, text);
    return res.status(202).json({ syllabus: serializeSyllabus(doc) });
  } catch (error) {
    console.error("syllabus upload error:", error);
    return res.status(500).json({ message: "Could not read this PDF." });
  }
});

// Re-index from the stored text. Subjects that already succeeded come from the planner's cache, so this is quick.
router.post("/syllabi/:id/retry", async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ message: "Syllabus not found" });
  }

  const doc = await SyllabusDocument.findOne({ _id: req.params.id, userId: req.user._id }).select("rawText status");
  if (!doc) {
    return res.status(404).json({ message: "Syllabus not found" });
  }
  if (doc.status === "processing") {
    return res.status(409).json({ message: "This syllabus is already being indexed." });
  }

  await SyllabusDocument.updateOne({ _id: doc._id }, { status: "processing", error: "", progress: { done: 0, total: 0 } });
  processSyllabus(doc._id, doc.rawText);
  return res.status(202).json({ ok: true });
});

router.get("/syllabi/:id", async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ message: "Syllabus not found" });
  }

  const doc = await SyllabusDocument.findOne({ _id: req.params.id, userId: req.user._id }).select("-rawText -chunks");
  if (!doc) {
    return res.status(404).json({ message: "Syllabus not found" });
  }
  return res.json({ syllabus: serializeSyllabus(doc) });
});

router.delete("/syllabi/:id", async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ message: "Syllabus not found" });
  }

  await SyllabusDocument.deleteOne({ _id: req.params.id, userId: req.user._id });
  return res.json({ ok: true });
});

router.post("/papers", upload.array("files", 20), async (req, res) => {
  const files = req.files || [];
  if (!files.length) {
    return res.status(400).json({ message: "Upload at least one question paper." });
  }

  try {
    const created = [];
    const rejected = [];
    for (const file of files) {
      const extractedText = (await extractText(file).catch(() => "")).trim();
      // PDFs are also read properly in the background (OCR included), which makes them usable for
      // Practice Tests too; the quick text-layer read serves the planner until then.
      if (isPdf(file)) {
        created.push(await addPaperPdf({ userId: req.user._id, file, extractedText }));
        continue;
      }
      if (extractedText.replace(/\s+/g, "").length < 100) {
        rejected.push(fixFileName(file.originalname));
        continue;
      }
      created.push(
        await PreviousPaper.create({
          userId: req.user._id,
          fileName: fixFileName(file.originalname),
          mimeType: file.mimetype,
          extractedText,
          extractedImages: [],
          pageTexts: []
        })
      );
    }

    return res.status(201).json({
      papers: created.map(serializePaper),
      message: rejected.length ? `No readable text in: ${rejected.join(", ")}` : ""
    });
  } catch (error) {
    console.error("planner paper upload error:", error);
    return res.status(500).json({ message: "Could not read the uploaded papers." });
  }
});

router.delete("/papers/:id", async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ message: "Paper not found" });
  }

  await PreviousPaper.deleteOne({ _id: req.params.id, userId: req.user._id });
  return res.json({ ok: true });
});

router.post("/plan", async (req, res) => {
  const message = String(req.body.message || "").trim().slice(0, 600);
  const preferences = req.body.preferences || {};
  const requestedIds = (Array.isArray(req.body.syllabusIds) ? req.body.syllabusIds : []).filter((id) => mongoose.Types.ObjectId.isValid(id));

  if (!message) {
    return res.status(400).json({ message: "Tell Lakshya what plan you need, e.g. \"Make a study plan for Semester 6\"." });
  }

  const query = { userId: req.user._id, status: "ready" };
  if (requestedIds.length) {
    query._id = { $in: requestedIds };
  }

  const [syllabi, papers] = await Promise.all([
    SyllabusDocument.find(query).select("-rawText").sort({ createdAt: -1 }).lean(),
    PreviousPaper.find({ userId: req.user._id }).select("fileName extractedText").lean()
  ]);

  if (!syllabi.length) {
    return res.status(400).json({ message: "Upload your syllabus PDF first. Lakshya builds the plan from your own syllabus." });
  }

  // Optional-course choices are remembered per syllabus. A value of null clears a choice ("Change elective").
  const incomingChoices = req.body.electiveChoices && typeof req.body.electiveChoices === "object" ? req.body.electiveChoices : {};
  const electiveChoices = {};
  await Promise.all(
    syllabi.map(async (syllabus) => {
      const merged = { ...(syllabus.electiveChoices || {}), ...incomingChoices };
      Object.keys(merged).forEach((group) => {
        if (typeof merged[group] !== "string" || !merged[group]) {
          delete merged[group];
        }
      });
      Object.assign(electiveChoices, merged);
      if (Object.keys(incomingChoices).length) {
        await SyllabusDocument.updateOne({ _id: syllabus._id }, { electiveChoices: merged });
      }
    })
  );

  try {
    const plan = await buildPlan({
      message,
      syllabi: syllabi.map(({ fileName, subjects, chunks }) => ({ fileName, subjects, chunks })),
      papers: papers.map(({ fileName, extractedText }) => ({ fileName, extractedText })),
      preferences: { ...preferences, electiveChoices, isToday: preferences.startDate === preferences.clientToday }
    });

    // The syllabus has optional courses and we don't know the student's pick yet: ask instead of planning.
    if (plan.needsChoice) {
      return res.json({ needsChoice: plan.needsChoice });
    }

    const sessions = plan.days.flatMap((day) =>
      day.items
        .filter((item) => item.type === "study" || item.type === "revision")
        .map((item, index) => ({
          id: `${day.date}-${index}`,
          subject: item.subject,
          chapter: item.unit,
          topic: item.topics.join(", "),
          durationMinutes: item.minutes,
          priority: item.priority,
          startAt: `${day.date}T${item.start}:00`,
          endAt: `${day.date}T${item.end}:00`,
          time: `${item.start} - ${item.end}`,
          task: `${item.subject} - ${item.unit}`,
          tag: item.priority,
          reminderText: `Time for ${item.subject}: ${item.unit}.`
        }))
    );

    const saved = await StudyPlan.create({
      userId: req.user._id,
      studyDate: plan.settings.startDate,
      syllabusName: syllabi.map((syllabus) => syllabus.fileName).join(", "),
      title: plan.title,
      request: message,
      studyWindow: {
        startTime: plan.settings.dailyStart,
        endTime: plan.settings.dailyEnd,
        breakMinutes: plan.settings.breakMinutes,
        reminderLeadMinutes: 5
      },
      summary: {
        totalSessions: sessions.length,
        totalMinutes: plan.stats.plannedMinutes,
        focusMessage: plan.strategy.headline
      },
      sessions,
      details: plan
    });

    return res.json({ plan: { ...plan, _id: saved._id, createdAt: saved.createdAt } });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ message: error.message });
    }
    console.error("study planner error:", error);
    return res.status(500).json({ message: "Lakshya could not build the plan right now. Please try again." });
  }
});

router.get("/plans/latest", async (req, res) => {
  const latest = await StudyPlan.findOne({ userId: req.user._id, details: { $exists: true } }).sort({ createdAt: -1 }).lean();
  if (!latest) {
    return res.json({ plan: null });
  }
  return res.json({ plan: { ...latest.details, _id: latest._id, createdAt: latest.createdAt }, today: todayInAppZone() });
});

module.exports = router;
module.exports.todayInAppZone = todayInAppZone;
module.exports.resumeInterruptedIndexing = resumeInterruptedIndexing;
