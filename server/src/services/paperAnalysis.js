// Previous-year question papers are read by the planner-ai paper RAG (questions, marks, figures,
// tables; OCR for scanned or protected PDFs) in the background, one at a time. Both Practice Tests
// and the Study Planner upload through here, so every paper ends up usable for test generation.

const crypto = require("crypto");
const PreviousPaper = require("../models/PreviousPaper");
const { ingestPaper } = require("./plannerAiClient");

// Kept on the paper until it is read, so a restart resumes it and a failure can be retried.
const MAX_STORED_PDF_BYTES = 12 * 1024 * 1024;

const queue = [];
const pending = new Set();
let running = false;

// Multer decodes multipart file names as latin1, which turns ‘c’ into "â\u0080\u0098câ\u0080\u0099".
function fixFileName(name) {
  const value = String(name || "");
  if (!/[\u0080-ÿ]/.test(value)) {
    return value;
  }
  const decoded = Buffer.from(value, "latin1").toString("utf8");
  return decoded.includes("�") ? value : decoded;
}

function isPdf(file) {
  return file.mimetype === "application/pdf" || /\.pdf$/i.test(file.originalname || "");
}

function hashPdf(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function analysedPaperFields(analysed) {
  return {
    extractedText: analysed.layout_text?.trim() || "",
    extractedImages: (analysed.figures || []).map((figure) => ({
      diagramId: figure.id,
      pageNumber: figure.page,
      width: figure.width,
      height: figure.height,
      dataUrl: figure.dataUrl
    })),
    subject: analysed.structure?.subject || analysed.meta?.subject || "",
    structure: analysed.structure || null,
    structureMethod: analysed.structure_method || "",
    tables: analysed.tables || [],
    ocrPages: analysed.ocr_pages || 0,
    pageCount: analysed.page_count || 0
  };
}

async function readPaper(buffer, fileName) {
  try {
    return { ...analysedPaperFields(await ingestPaper(buffer, fileName)), status: "ready", statusMessage: "", pendingPdf: null };
  } catch (error) {
    console.error("practice-paper analysis error:", error.message);
    const message =
      error.status === 400
        ? error.message
        : `the paper analyser is not available right now (${error.message}). Use Retry in a minute.`;
    return { status: "failed", statusMessage: message || "Could not read this paper." };
  }
}

// Once a re-uploaded PDF is read, the same user's raw-text copy of it (from before papers were
// read properly, or from an older Study Planner upload) is redundant.
async function removeRawCopies(paperId) {
  const paper = await PreviousPaper.findById(paperId).select("userId fileName status");
  if (paper?.status !== "ready") {
    return;
  }
  await PreviousPaper.deleteMany({
    _id: { $ne: paper._id },
    userId: paper.userId,
    fileName: { $in: [paper.fileName, Buffer.from(paper.fileName, "utf8").toString("latin1")] },
    mimeType: "application/pdf",
    "structure.questions.0": { $exists: false },
    status: { $nin: ["analysing"] }
  });
}

async function runQueue() {
  if (running) {
    return;
  }
  running = true;

  while (queue.length) {
    const { paperId, buffer, fileName } = queue.shift();
    try {
      const update = await readPaper(buffer, fileName);
      await PreviousPaper.updateOne({ _id: paperId, status: "analysing" }, { $set: update });
      await removeRawCopies(paperId);
    } catch (error) {
      console.error("practice-paper save error:", error.message);
    }
    pending.delete(String(paperId));
  }

  running = false;
}

function enqueue(paperId, buffer, fileName) {
  if (pending.has(String(paperId))) {
    return;
  }
  pending.add(String(paperId));
  queue.push({ paperId, buffer, fileName });
  runQueue();
}

// Creates the paper for one uploaded PDF: copied at once if the same PDF was read before (by
// anyone), otherwise queued for reading. `extractedText` is a quick text-layer read for the
// Study Planner to use until the proper reading replaces it.
async function addPaperPdf({ userId, file, extractedText = "" }) {
  const fileName = fixFileName(file.originalname);
  const contentHash = hashPdf(file.buffer);
  const owner = { userId, fileName, mimeType: "application/pdf", contentHash };

  const copy = await PreviousPaper.findOne({ contentHash, status: "ready", "structure.questions.0": { $exists: true } })
    .sort({ createdAt: -1 })
    .lean();
  if (copy) {
    const { _id, userId: _owner, fileName: _name, createdAt, updatedAt, __v, ...analysed } = copy;
    const paper = await PreviousPaper.create({ ...analysed, ...owner });
    await removeRawCopies(paper._id);
    return paper;
  }

  const paper = await PreviousPaper.create({
    ...owner,
    extractedText,
    status: "analysing",
    pendingPdf: file.buffer.length <= MAX_STORED_PDF_BYTES ? file.buffer : null
  });
  enqueue(paper._id, file.buffer, fileName);
  return paper;
}

// Failed papers whose PDF was kept can be read again.
async function retryPaper(paper) {
  const stored = await PreviousPaper.findById(paper._id).select("+pendingPdf fileName");
  if (!stored?.pendingPdf?.length) {
    return false;
  }
  await PreviousPaper.updateOne({ _id: paper._id }, { $set: { status: "analysing", statusMessage: "" } });
  enqueue(paper._id, stored.pendingPdf, stored.fileName);
  return true;
}

// Papers left "analysing" by a restart are queued again when their PDF was kept, else marked failed.
async function settleUnfinished(papers) {
  for (const paper of papers) {
    if (paper.status !== "analysing" || pending.has(String(paper._id))) {
      continue;
    }
    if (await retryPaper(paper)) {
      continue;
    }
    paper.status = "failed";
    paper.statusMessage = "Reading was interrupted. Remove it and upload it again.";
    await PreviousPaper.updateOne(
      { _id: paper._id, status: "analysing" },
      { $set: { status: paper.status, statusMessage: paper.statusMessage } }
    );
  }
}

async function resumeInterruptedPaperReading() {
  const papers = await PreviousPaper.find({ status: "analysing" }).select("_id status");
  await settleUnfinished(papers);
}

module.exports = {
  addPaperPdf,
  fixFileName,
  isPdf,
  resumeInterruptedPaperReading,
  retryPaper,
  settleUnfinished
};
