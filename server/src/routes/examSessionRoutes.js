const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const { PDFParse } = require("pdf-parse");
const authMiddleware = require("../middleware/authMiddleware");
const ExamSession = require("../models/ExamSession");
const PreviousPaper = require("../models/PreviousPaper");
const ChatRoom = require("../models/ChatRoom");
const ChatMessage = require("../models/ChatMessage");
const { analyzeFrame } = require("../services/proctorAiClient");
const { generatePracticeTest, ingestPaper } = require("../services/plannerAiClient");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
const DEFAULT_PAPER_INSTRUCTIONS = [
  "Figures to the right indicate full marks.",
  "Write neat and legible answers.",
  "Assume suitable data wherever required and state assumptions clearly.",
  "Draw labelled diagrams wherever necessary."
];

router.use(authMiddleware);

function getModel() {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    return null;
  }

  return {
    apiKey,
    model: process.env.GROQ_MODEL || "openai/gpt-oss-20b"
  };
}

async function generateGroqText({ modelConfig, systemPrompt, userPrompt }) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(20000),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${modelConfig.apiKey}`
    },
    body: JSON.stringify({
      model: modelConfig.model,
      temperature: 0.3,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.error?.message || "Groq request failed");
  }

  return data?.choices?.[0]?.message?.content?.trim() || "";
}

async function extractDocumentText(file) {
  if (file.mimetype === "application/pdf") {
    const parser = new PDFParse({ data: file.buffer });
    const parsed = await parser.getText();
    return cleanExamPaperText(parsed.text || "");
  }

  if (file.mimetype.startsWith("text/")) {
    return cleanExamPaperText(file.buffer.toString("utf8"));
  }

  throw new Error("Only PDF and text files are supported right now");
}

function cleanExamPaperText(text) {
  return String(text || "")
    .replace(/[A-F0-9]{24,}/g, " ")
    .replace(/Paper \/ Subject Code:[^\n]*/gi, " ")
    .replace(/QP CODE:[^\n]*/gi, " ")
    .replace(/Page \d+ of \d+/gi, " ")
    .replace(/--\s*\d+\s*of\s*\d+\s*--/gi, "\n")
    .replace(/[A-Za-z0-9+/=]{28,}/g, " ")
    .replace(/(?:\\x[0-9a-f]{2}){3,}/gi, " ")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\u00A0-\u024F\u1E00-\u1EFF]/g, " ")
    .replace(/[^\S\r\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/ ? ?/g, "\n- ")
    .replace(/\s+\[/g, " [")
    .trim();
}

function normalizeLines(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim());
}

function splitQuestionBlocks(text) {
  const normalized = String(text || "").replace(/\r/g, "");
  const pattern = /(?:^|\n)\s*((?:Q(?:uestion)?\.?\s*\d+)|(?:\d{1,2}[.)]))\s+/gi;
  const matches = [...normalized.matchAll(pattern)];

  if (!matches.length) {
    return [];
  }

  return matches.map((match, index) => {
    const start = match.index + (match[0].startsWith("\n") ? 1 : 0);
    const end = index + 1 < matches.length ? matches[index + 1].index : normalized.length;
    const block = normalized.slice(start, end).trim();
    const label = String(match[1] || "").trim();
    const body = block.slice(label.length).trim();

    return {
      label,
      block,
      body
    };
  });
}

function parseQuestionTemplate(text) {
  return splitQuestionBlocks(text).map((block, index) => {
    const subpartMatches = [...block.body.matchAll(/(?:^|\n)\s*([A-H])[\.\)]\s+([\s\S]*?)(?=(?:\n\s*[A-H][\.\)]\s+)|$)/g)];
    const subparts = subpartMatches.map((match) => {
      const content = String(match[2] || "").trim();
      const marks = Array.from(new Set(content.match(/\[(\d{1,2})\]/g) || []));
      const prompt = normalizeLines(content.replace(/\[(\d{1,2})\]/g, " ").trim()).find(Boolean) || content.trim();

      return {
        label: match[1],
        marks,
        prompt: prompt.slice(0, 220)
      };
    });

    const marks = Array.from(new Set(block.block.match(/\[(\d{1,2})\]/g) || []));
    const promptLine =
      normalizeLines(block.body.replace(/\[(\d{1,2})\]/g, " "))
        .find((line) => line && !/^(a|b|c|d|e|f|g|h)[.)]$/i.test(line)) || `Solve the required question ${index + 1}.`;

    return {
      number: index + 1,
      label: block.label || `Q.${index + 1}`,
      marks,
      prompt: promptLine.slice(0, 240),
      subparts
    };
  });
}

function extractInstructionLines(text) {
  const normalizedText = String(text || "").replace(/\r/g, "");
  const instructionMatch = normalizedText.match(/instructions?\s*:?\s*([\s\S]*?)(?=\n\s*(?:Q(?:uestion)?\.?\s*\d+|\d{1,2}[.)])\s+)/i);

  if (!instructionMatch) {
    return [];
  }

  return normalizeLines(instructionMatch[1])
    .map((line) => line.replace(/^[-*•]\s*/, "").trim())
    .filter((line) => line.length > 8)
    .slice(0, 6);
}

async function extractPdfPageTexts(file) {
  if (file.mimetype !== "application/pdf") {
    return [];
  }

  const parser = new PDFParse({ data: file.buffer });
  const parsed = await parser.getText();
  return (parsed.pages || []).map((page, index) => ({
    pageNumber: page.num || index + 1,
    text: cleanExamPaperText(page.text || "")
  }));
}

async function extractPdfImages(file) {
  if (file.mimetype !== "application/pdf") {
    return [];
  }

  const parser = new PDFParse({ data: file.buffer });
  const extracted = await parser.getImage({
    imageDataUrl: true,
    imageBuffer: false,
    imageThreshold: 80
  });

  return (extracted.pages || [])
    .flatMap((page) =>
      (page.images || []).map((image, index) => ({
        diagramId: `${page.pageNumber}-${index + 1}`,
        pageNumber: page.pageNumber,
        width: image.width,
        height: image.height,
        dataUrl: image.dataUrl || ""
      }))
    )
    .filter((image) => image.dataUrl && image.width >= 90 && image.height >= 90)
    .slice(0, 12);
}

function buildDiagramCatalog(papers) {
  return papers.flatMap((paper) =>
    (paper.extractedImages || []).map((image, index) => ({
      token: `${paper._id}:${image.diagramId}`,
      fileName: paper.fileName,
      pageNumber: image.pageNumber,
      width: image.width,
      height: image.height,
      dataUrl: image.dataUrl,
      fallbackAlt: `Diagram ${index + 1} from ${paper.fileName} page ${image.pageNumber}`
    }))
  );
}

function buildPaperFormatProfile(papers) {
  const combinedText = papers.map((paper) => paper.extractedText || "").join("\n\n");
  const questionBlocks = combinedText.split(/(?=Q\.\s*\d+)/i).filter((block) => /Q\.\s*\d+/i.test(block));
  const questionSummary = questionBlocks
    .slice(0, 8)
    .map((block) => {
      const headingMatch = block.match(/Q\.\s*\d+[^\n]*/i);
      const heading = headingMatch ? headingMatch[0] : "";
      const subparts = (block.match(/\n\s*[A-Z]\./g) || []).length;
      const marks = Array.from(new Set(block.match(/\[\d+\]/g) || []));
      return `${heading.trim()} | subparts: ${subparts} | marks: ${marks.join(", ") || "none"}`;
    })
    .join("\n");

  return [
    `Has MCQ section: ${/multiple choice|mcq/i.test(combinedText) ? "yes" : "no"}`,
    `Has Time / Max. Marks header: ${/time:\s*\d+/i.test(combinedText) && /max\.\s*marks/i.test(combinedText) ? "yes" : "no"}`,
    `Has instructions block: ${/instructions:/i.test(combinedText) ? "yes" : "no"}`,
    "Observed question pattern:",
    questionSummary || "No clear question pattern detected."
  ].join("\n");
}

function buildPaperTemplate(papers) {
  const primaryPaper = papers[0];
  const primaryText =
    primaryPaper?.pageTexts?.map((page) => page.text).filter(Boolean).join("\n\n") ||
    primaryPaper?.extractedText ||
    papers.map((paper) => paper.extractedText || "").join("\n\n");
  const questionTemplate = parseQuestionTemplate(primaryText);
  const instructions = extractInstructionLines(primaryText);

  return {
    sourceFileName: primaryPaper?.fileName || "uploaded paper",
    instructions: instructions.length ? instructions : DEFAULT_PAPER_INSTRUCTIONS,
    questionTemplate,
    primaryText
  };
}

function buildTopicBank(papers) {
  const topicMap = new Map();

  papers.forEach((paper) => {
    parseQuestionTemplate(paper.pageTexts?.map((page) => page.text).join("\n\n") || paper.extractedText || "").forEach((question) => {
      const normalizedPrompt = question.prompt
        .replace(/^(attempt|solve|answer|write short notes on)\s+/i, "")
        .replace(/\s+/g, " ")
        .trim();

      if (!normalizedPrompt || normalizedPrompt.length < 12) {
        return;
      }

      const entry = topicMap.get(normalizedPrompt) || { prompt: normalizedPrompt, count: 0 };
      entry.count += 1;
      topicMap.set(normalizedPrompt, entry);
    });
  });

  return [...topicMap.values()]
    .sort((a, b) => b.count - a.count || a.prompt.length - b.prompt.length)
    .slice(0, 18);
}

function buildTemplateSummary(template) {
  return template.questionTemplate
    .slice(0, 12)
    .map((question) => {
      const subpartSummary = question.subparts.length
        ? question.subparts.map((subpart) => `${subpart.label}. ${subpart.marks.join(", ") || "[marks]"}`).join(" | ")
        : question.marks.join(", ") || "[marks]";

      return `${question.label}: ${subpartSummary}`;
    })
    .join("\n");
}

function buildQuestionImageHints(papers) {
  const diagramCatalog = buildDiagramCatalog(papers);

  return papers.flatMap((paper) => {
    const pagesByNumber = new Map((paper.pageTexts || []).map((page) => [page.pageNumber, page.text]));

    return (paper.extractedImages || []).map((image) => {
      const pageText = pagesByNumber.get(image.pageNumber) || "";
      const promptLine =
        pageText
          .split("\n")
          .find((line) => /diagram|draw|flow chart|block diagram|table|graph|figure|matrix/i.test(line)) ||
        `Question on page ${image.pageNumber} that uses a figure or table`;

      return {
        token: `${paper._id}:${image.diagramId}`,
        fileName: paper.fileName,
        pageNumber: image.pageNumber,
        promptLine: promptLine.trim()
      };
    });
  });
}

function replaceDiagramTokens(markdown, diagrams) {
  return diagrams.reduce((output, diagram) => {
    const pattern = new RegExp(`\\[\\[DIAGRAM:${diagram.token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\|([^\\]]+)\\]\\]`, "g");

    return output.replace(pattern, (_match, altText) => `![${String(altText || diagram.fallbackAlt).trim()}](${diagram.dataUrl})`);
  }, markdown);
}

function sanitizeGeneratedTest(markdown) {
  return String(markdown || "")
    .replace(/\r/g, "")
    .replace(/^```(?:markdown|md)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function formatExamMarkdownLayout(markdown) {
  return sanitizeGeneratedTest(markdown)
    .replace(/([^\n])(\n?)(Q(?:uestion)?\.?\s*\d+)/gi, (_match, prefix, _gap, questionLabel) => `${prefix}\n\n${questionLabel}`)
    .replace(/([^\n])(\n?)(\d{1,2}[.)]\s+)/g, (_match, prefix, _gap, questionLabel) => `${prefix}\n\n${questionLabel}`)
    .replace(/([^\n])(\n?)([A-H][.)]\s+)/g, (_match, prefix, _gap, subpartLabel) => `${prefix}\n${subpartLabel}`)
    .replace(/(##\s+Instructions\s*\n)(?!-)/i, "$1- ")
    .replace(/\n-\s*/g, "\n- ")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function looksLikeBrokenGeneratedTest(markdown) {
  const text = formatExamMarkdownLayout(markdown);

  if (!text) {
    return true;
  }

  const longTokenCount = (text.match(/[A-Za-z0-9+/=]{35,}/g) || []).length;
  const hasQuestionStructure = /(?:^|\n)\s*(?:Q(?:uestion)?\.?\s*\d+|\d{1,2}[.)])\s+/im.test(text);
  const hasHeader = /time\s*:|max\.?\s*marks/i.test(text) || /^#\s+/m.test(text);

  return longTokenCount > 2 || !hasQuestionStructure || !hasHeader;
}

function serializePaper(document) {
  return {
    _id: document._id,
    fileName: document.fileName,
    mimeType: document.mimeType,
    uploadedAt: document.createdAt,
    diagramCount: document.extractedImages?.length || 0,
    subject: document.subject || "",
    analysed: Boolean(document.structure?.questions?.length),
    questionCount: (document.structure?.questions || []).reduce((sum, question) => sum + (question.parts?.length || 0), 0),
    tableCount: document.tables?.length || 0,
    ocrPages: document.ocrPages || 0
  };
}

function formatDateTime(value) {
  if (!value) {
    return "Not scheduled";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Not scheduled";
  }

  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function buildQuestionCount(marks) {
  const total = Math.max(3, Math.round(Number(marks || 80) / 10));
  return `${total} questions`;
}

function buildFallbackTest({ title, marks, durationMinutes, papers, template }) {
  const topicBank = buildTopicBank(papers);
  const questionPattern = template?.questionTemplate?.length
    ? template.questionTemplate
    : parseQuestionTemplate(template?.primaryText || papers.map((paper) => paper.extractedText || "").join("\n\n"));
  const safePattern = questionPattern.length
    ? questionPattern
    : [
        { label: "Q.1", marks: ["[20]"], prompt: "Attempt the following.", subparts: [{ label: "A", marks: ["[10]"] }, { label: "B", marks: ["[10]"] }] },
        { label: "Q.2", marks: ["[20]"], prompt: "Attempt the following.", subparts: [{ label: "A", marks: ["[10]"] }, { label: "B", marks: ["[10]"] }] }
      ];

  let topicIndex = 0;
  const nextTopic = () => {
    const topic = topicBank[topicIndex % Math.max(1, topicBank.length)];
    topicIndex += 1;
    return topic?.prompt || "Explain the key concept with suitable steps and examples.";
  };

  const questions = safePattern.map((question) => {
    if (question.subparts.length) {
      return [
        `${question.label} ${question.prompt || "Attempt the following."}`.trim(),
        "",
        ...question.subparts.map((subpart) => `${subpart.label}. ${nextTopic()} ${subpart.marks[0] || question.marks[0] || "[10]"}`)
      ].join("\n");
    }

    return `${question.label} ${nextTopic()} ${question.marks[0] || "[10]"}`;
  });

  return formatExamMarkdownLayout([
    `# ${title}`,
    "",
    `**Time: ${durationMinutes} minutes**`,
    `**Max. Marks: ${marks}**`,
    "",
    "## Instructions",
    ...((template?.instructions?.length ? template.instructions : DEFAULT_PAPER_INSTRUCTIONS).map((line) => `- ${line}`)),
    "",
    questions.join("\n\n")
  ].join("\n"));
}

function serializeSession(session) {
  return {
    _id: session._id,
    title: session.title,
    date: session.date || formatDateTime(session.startAt),
    count: session.count || buildQuestionCount(session.marks),
    mode: session.mode,
    status: session.status,
    attentionScore: session.attentionScore,
    marks: session.marks,
    durationMinutes: session.durationMinutes,
    startAt: session.startAt,
    endsAt: session.endsAt,
    endedAt: session.endedAt,
    generatedTest: session.generatedTest || "",
    generatedPaper: session.generatedPaper || null,
    callAcceptedAt: session.callAcceptedAt,
    lastAlert: session.lastAlert || "",
    warningCount: session.warningCount || 0,
    sharedInviteId: session.sharedInviteId || "",
    sharedRoomId: session.sharedRoomId || "",
    sharedByName: session.sharedByName || "",
    sharedParticipants: Array.isArray(session.sharedParticipants) ? session.sharedParticipants : []
  };
}

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function buildSharedJoinDeadline(startAt) {
  return new Date(new Date(startAt).getTime() + 15 * 60 * 1000);
}

function buildIncomingCall(session) {
  if (!session?.startAt) {
    return null;
  }

  const now = Date.now();
  const startAt = new Date(session.startAt).getTime();
  const diffMs = startAt - now;
  const ringWindowMs = 15 * 60 * 1000;
  const isDue = diffMs <= 0 && diffMs >= -ringWindowMs && session.status === "scheduled";

  return {
    due: isDue,
    startAt: session.startAt,
    startsInMinutes: Math.max(0, Math.ceil(diffMs / 60000)),
    accepted: Boolean(session.callAcceptedAt),
    expired: diffMs < -ringWindowMs
  };
}

async function resolveCurrentSession(userId) {
  const now = Date.now();
  const activeSessions = await ExamSession.find({ userId, status: "active" }).sort({ createdAt: -1 });

  for (const activeSession of activeSessions) {
    const hasAcceptedCall = Boolean(activeSession.callAcceptedAt);
    const hasValidStartAt = activeSession.startAt && !Number.isNaN(new Date(activeSession.startAt).getTime());
    const hasValidEndsAt = activeSession.endsAt && !Number.isNaN(new Date(activeSession.endsAt).getTime());

    if (hasValidEndsAt && new Date(activeSession.endsAt).getTime() <= now) {
      activeSession.status = "completed";
      activeSession.endedAt = new Date();
      activeSession.lastAlert = "Time is up. Upload your paper now.";
      await activeSession.save();
      continue;
    }

    if (!hasAcceptedCall || !hasValidStartAt) {
      activeSession.status = "left";
      activeSession.endedAt = activeSession.endedAt || new Date();
      activeSession.lastAlert = "A stale test session was closed automatically.";
      await activeSession.save();
      continue;
    }

    return activeSession;
  }

  const scheduledSessions = await ExamSession.find({ userId, status: "scheduled" }).sort({ startAt: 1, createdAt: -1 });

  if (!scheduledSessions.length) {
    return null;
  }

  const ringWindowMs = 15 * 60 * 1000;
  const dueSession = scheduledSessions.find((session) => {
    if (!session?.startAt) {
      return false;
    }

    const startAt = new Date(session.startAt).getTime();
    return startAt <= now && startAt >= now - ringWindowMs;
  });

  return dueSession || scheduledSessions[0];
}

async function loadSharedParticipants(session) {
  if (!session) {
    return [];
  }

  let inviteMessage = null;

  if (session.sharedInviteId) {
    inviteMessage = await ChatMessage.findOne({ "practiceInvite.inviteId": session.sharedInviteId }).lean();
  } else if (session._id) {
    inviteMessage = await ChatMessage.findOne({ "practiceInvite.sessionId": session._id }).lean();
  }

  if (!inviteMessage?.practiceInvite) {
    return [];
  }

  const ownerParticipant = inviteMessage.practiceInvite.invitedByEmail
    ? [
        {
          email: inviteMessage.practiceInvite.invitedByEmail,
          name: inviteMessage.practiceInvite.invitedByName || "Host",
          joinedAt: inviteMessage.createdAt || inviteMessage.practiceInvite.startAt || null,
          isHost: true
        }
      ]
    : [];

  const joinedParticipants = Array.isArray(inviteMessage.practiceInvite.joiners)
    ? inviteMessage.practiceInvite.joiners.map((joiner) => ({
        email: joiner.email || "",
        name: joiner.name || joiner.email || "Student",
        joinedAt: joiner.joinedAt || null,
        isHost: false
      }))
    : [];

  const uniqueParticipants = new Map();

  [...ownerParticipant, ...joinedParticipants].forEach((participant) => {
    const key = normalizeEmail(participant.email) || String(participant.name || "").trim().toLowerCase();

    if (!key || uniqueParticipants.has(key)) {
      return;
    }

    uniqueParticipants.set(key, participant);
  });

  return [...uniqueParticipants.values()];
}

// Structured analysis from the planner-ai paper RAG. PDFs are only stored once analysed: many
// question-paper PDFs have scrambled text layers, so a plain-text fallback would store gibberish
// and later generate a nonsense test.
async function analysePaperPdf(file) {
  try {
    return await ingestPaper(file.buffer, file.originalname);
  } catch (error) {
    if (error.status === 400) {
      throw error;
    }
    console.error("paper analysis unavailable:", error.message);
    throw new Error(`the paper analyser is not available right now (${error.message}). Please try again in a minute.`);
  }
}

function getUploadedFiles(req) {
  return [...(req.files?.files || []), ...(req.files?.file || []), ...(req.file ? [req.file] : [])];
}

router.get("/papers", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.json({ papers: [] });
  }

  const papers = await PreviousPaper.find({ userId: req.user._id }).sort({ createdAt: -1 });
  return res.json({ papers: papers.map(serializePaper) });
});

router.post("/papers", upload.fields([{ name: "files", maxCount: 20 }, { name: "file", maxCount: 20 }]), async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ message: "Database unavailable. Start MongoDB and try again." });
  }

  const files = getUploadedFiles(req);

  if (!files.length) {
    return res.status(400).json({ message: "Please upload at least one PDF or text file" });
  }

  const createdPapers = [];
  const warnings = [];

  // One at a time: the analyser OCRs scanned pages and calls the model per paper.
  for (const file of files) {
    try {
      const analysed = file.mimetype === "application/pdf" ? await analysePaperPdf(file) : null;
      const extractedText = analysed?.layout_text?.trim() || (await extractDocumentText(file)).trim();

      if (!extractedText) {
        warnings.push(`"${file.originalname}" did not contain readable text.`);
        continue;
      }

      const paper = await PreviousPaper.create({
        userId: req.user._id,
        fileName: file.originalname,
        mimeType: file.mimetype,
        extractedText,
        extractedImages: (analysed?.figures || []).map((figure) => ({
          diagramId: figure.id,
          pageNumber: figure.page,
          width: figure.width,
          height: figure.height,
          dataUrl: figure.dataUrl
        })),
        pageTexts: [],
        subject: analysed?.structure?.subject || analysed?.meta?.subject || "",
        structure: analysed?.structure || null,
        structureMethod: analysed?.structure_method || "",
        tables: analysed?.tables || [],
        ocrPages: analysed?.ocr_pages || 0,
        pageCount: analysed?.page_count || 0
      });

      createdPapers.push(serializePaper(paper));
    } catch (error) {
      console.error("practice-paper upload error:", error);
      warnings.push(`"${file.originalname}": ${error.message || "could not be processed"}`);
    }
  }

  if (!createdPapers.length) {
    return res.status(400).json({ message: warnings.join(" ") || "None of the uploaded papers could be read." });
  }

  return res.status(201).json({
    papers: createdPapers,
    paper: createdPapers[0],
    warning: warnings.join(" ")
  });
});

router.delete("/papers/:paperId", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ message: "Database unavailable. Start MongoDB and try again." });
  }

  const paperId = String(req.params.paperId || "").trim();
  const deleteQuery = { userId: req.user._id };

  if (mongoose.Types.ObjectId.isValid(paperId)) {
    deleteQuery._id = paperId;
  } else {
    deleteQuery.fileName = paperId;
  }

  const deletedPaper = await PreviousPaper.findOneAndDelete(deleteQuery);

  if (!deletedPaper) {
    return res.status(404).json({ message: "Paper not found" });
  }

  return res.json({ success: true, paperId });
});

router.post("/generate-test", async (req, res) => {
  const marks = Math.max(10, Number(req.body.marks || 80));
  const durationMinutes = Math.max(10, Number(req.body.durationMinutes || 60));
  const startAt = req.body.startAt ? new Date(req.body.startAt) : null;
  const mode = req.body.mode || "focus";
  const title = String(req.body.title || "AI Generated Practice Test").trim();
  const requestedPaperIds = Array.isArray(req.body.paperIds) ? req.body.paperIds : [];
  const providedGeneratedTest = String(req.body.generatedTest || "").trim();

  if (!providedGeneratedTest && !requestedPaperIds.length) {
    return res.status(400).json({ message: "Upload and select at least one previous year paper first." });
  }

  if (!startAt || Number.isNaN(startAt.getTime())) {
    return res.status(400).json({ message: "Please choose a valid test start time." });
  }

  if (mongoose.connection.readyState !== 1) {
    const session = {
      _id: "demo-session",
      title,
      date: formatDateTime(startAt),
      count: buildQuestionCount(marks),
      mode,
      status: "scheduled",
      attentionScore: 92,
      marks,
      durationMinutes,
      startAt,
      generatedTest:
        providedGeneratedTest ||
        `# ${title}\n\n- Total marks: ${marks}\n- Duration: ${durationMinutes} minutes\n\n## Demo test\n- Database is offline, so connect MongoDB to generate a paper from uploads.`
    };

    exams.unshift(session);
    return res.status(201).json({ session, warning: "Database is offline, so this is a demo scheduled test." });
  }

  if (providedGeneratedTest) {
    const session = await ExamSession.create({
      userId: req.user._id,
      title,
      date: formatDateTime(startAt),
      count: buildQuestionCount(marks),
      mode,
      status: "scheduled",
      attentionScore: 92,
      marks,
      durationMinutes,
      startAt,
      generatedTest: formatExamMarkdownLayout(providedGeneratedTest)
    });

    return res.status(201).json({
      session: serializeSession(session),
      papers: [],
      warning: ""
    });
  }

  const papers = await PreviousPaper.find({ userId: req.user._id, _id: { $in: requestedPaperIds } }).sort({ createdAt: -1 });

  if (!papers.length) {
    return res.status(400).json({ message: "The selected papers are not available anymore." });
  }

  const requestedOrder = new Map(requestedPaperIds.map((paperId, index) => [String(paperId), index]));
  papers.sort((a, b) => (requestedOrder.get(String(a._id)) ?? Number.MAX_SAFE_INTEGER) - (requestedOrder.get(String(b._id)) ?? Number.MAX_SAFE_INTEGER));

  // The planner-ai paper RAG writes a new paper in the exact format of the uploads (numbering,
  // marks, choices, figures, tables). PDFs uploaded before that existed have only raw text, which
  // is often scrambled (protected fonts), so they are left out instead of producing a broken test.
  // Only plain-text uploads still use the original single-prompt generator below.
  const structuredPapers = papers.filter((paper) => paper.structure?.questions?.length);
  const legacyPdfs = papers.filter((paper) => !paper.structure?.questions?.length && paper.mimeType === "application/pdf");
  const textPapers = papers.filter((paper) => !paper.structure?.questions?.length && paper.mimeType !== "application/pdf");
  const legacyWarning = legacyPdfs.length
    ? `${legacyPdfs.length} older PDF${legacyPdfs.length === 1 ? " was" : "s were"} skipped; remove and upload ${legacyPdfs.length === 1 ? "it" : "them"} again to include ${legacyPdfs.length === 1 ? "it" : "them"}. `
    : "";

  if (!structuredPapers.length && !textPapers.length) {
    return res.status(400).json({
      message:
        "The selected papers were uploaded before Lakshya could read question papers properly. Remove them and upload the PDFs again, then generate the test."
    });
  }

  if (structuredPapers.length) {
    try {
      const result = await generatePracticeTest({
        papers: structuredPapers.map((paper) => ({
          id: String(paper._id),
          structure: paper.structure,
          figures: (paper.extractedImages || []).map((image) => ({
            id: image.diagramId,
            page: image.pageNumber,
            width: image.width,
            height: image.height
          })),
          tables: paper.tables || []
        })),
        title,
        marks,
        duration_minutes: durationMinutes
      });

      const catalog = buildDiagramCatalog(structuredPapers);
      const figureSources = new Map(catalog.map((diagram) => [diagram.token, diagram.dataUrl]));
      const generatedPaper = {
        ...result.paper,
        questions: (result.paper.questions || []).map((question) => ({
          ...question,
          parts: (question.parts || []).map((part) => ({
            ...part,
            figure: part.figure && figureSources.has(part.figure) ? { token: part.figure, src: figureSources.get(part.figure) } : null
          }))
        }))
      };
      const paperMarks = Number(generatedPaper.total_marks) || marks;

      const session = await ExamSession.create({
        userId: req.user._id,
        title,
        date: formatDateTime(startAt),
        count: buildQuestionCount(paperMarks),
        mode,
        status: "scheduled",
        attentionScore: 92,
        marks: paperMarks,
        durationMinutes,
        startAt,
        paperIds: structuredPapers.map((paper) => paper._id),
        generatedTest: sanitizeGeneratedTest(replaceDiagramTokens(result.markdown || "", catalog)),
        generatedPaper
      });

      return res.status(201).json({
        session: serializeSession(session),
        papers: structuredPapers.map(serializePaper),
        warning: `${legacyWarning}${(result.warnings || []).join(" ")}`.trim()
      });
    } catch (error) {
      console.error("practice-test RAG generation failed:", error.message);
      return res.status(error.status === 400 ? 400 : 503).json({
        message: `The test could not be generated right now (${error.message}). Please try again in a minute.`
      });
    }
  }

  // Only plain-text uploads reach the original generator.
  papers.splice(0, papers.length, ...textPapers);

  const context = papers.map((paper, index) => `Paper ${index + 1}: ${paper.fileName}\n${paper.extractedText.slice(0, 5000)}`).join("\n\n");
  const diagramCatalog = buildDiagramCatalog(papers);
  const paperFormatProfile = buildPaperFormatProfile(papers);
  const questionImageHints = buildQuestionImageHints(papers);
  const paperTemplate = buildPaperTemplate(papers);
  const templateSummary = buildTemplateSummary(paperTemplate);
  const topicBank = buildTopicBank(papers);
  const diagramContext = diagramCatalog.length
    ? diagramCatalog
        .map(
          (diagram) =>
            `- Token: ${diagram.token}\n  Source: ${diagram.fileName}\n  Page: ${diagram.pageNumber}\n  Size: ${diagram.width}x${diagram.height}`
        )
        .join("\n")
    : "No extracted diagrams were available.";
  const questionImageContext = questionImageHints.length
    ? questionImageHints.map((hint) => `- ${hint.token}: ${hint.promptLine} (${hint.fileName}, page ${hint.pageNumber})`).join("\n")
    : "No page-linked question image hints were available.";
  const topicBankContext = topicBank.length
    ? topicBank.map((topic, index) => `- Topic ${index + 1}: ${topic.prompt} (seen ${topic.count} times)`).join("\n")
    : "No repeated topic bank could be built from the uploaded papers.";

  let generatedTest = "";
  let warning = "";
  const model = getModel();

  if (!model) {
    generatedTest = buildFallbackTest({ title, marks, durationMinutes, papers, template: paperTemplate });
    warning = "AI model is not configured, so the test was generated from extracted paper text.";
  } else {
    try {
      generatedTest = await generateGroqText({
        modelConfig: model,
        systemPrompt:
          "You are Lakshya's exam generator. Analyze previous year question papers, detect the recurring topics and formatting pattern, and create a fresh paper in the same exam-paper style. Always respond as a clean markdown exam paper only.",
        userPrompt: `Create a complete practice test in markdown.

Requirements:
- Test title: ${title}
- Total marks: ${marks}
- Duration: ${durationMinutes} minutes
- Analyze the uploaded previous year papers and identify the common section patterns before writing.
- Generate a new paper that follows the same paper layout style, numbering style, instructions style, section ordering, and mark distribution pattern as closely as possible.
- The uploaded paper format profile below is mandatory. Do not invent new section types that are absent in the profile.
- The primary formatting template below is mandatory. Follow the same question ordering and subpart pattern as closely as possible.
- Do not copy the source text verbatim for the whole paper. Instead, create a fresh paper based on repeated patterns and highly asked topics.
- Use the repeated-topic analysis internally, but do not reveal phrases like "most important questions", "most asked questions", or "repeated questions" inside the final paper.
- If the source papers contain diagrams, tables, block diagrams, flow charts, circuits, graphs, or labelled figures, include equivalent diagram questions in the generated paper.
- If a real extracted diagram token is relevant, insert it exactly like this:
  [[DIAGRAM:paperId:page-imageIndex|Short caption]]
- Only use tokens from the extracted diagram list below.
- If no real token fits, render the diagram directly in markdown using fenced \`text\` blocks with neat ASCII diagrams or tables.
- If the format profile says there is no MCQ section, do not generate MCQs.
- Keep spacing readable and paper-like, for example:
  - Time and Max. Marks at the top
  - Instructions block
  - Questions like Q.1, Q.2
  - Subparts like A., B., C.
  - Marks shown beside each part like [05], [10]
- Prefer the topics that appear repeatedly across papers.
- The final answer must begin directly with the paper, not with commentary.
- Do not append any teacher note, answer key, or recap after the paper.

Previous year papers:
"""${context}"""

Mandatory paper format profile:
${paperFormatProfile}

Primary question template from ${paperTemplate.sourceFileName}:
${templateSummary || "No clear question template detected."}

Primary instruction style:
${paperTemplate.instructions.map((line) => `- ${line}`).join("\n")}

Repeated topic bank:
${topicBankContext}

Extracted diagram tokens:
${diagramContext}

Question-image matching hints:
${questionImageContext}` 
      });
      generatedTest = formatExamMarkdownLayout(replaceDiagramTokens(generatedTest, diagramCatalog));
      if (looksLikeBrokenGeneratedTest(generatedTest)) {
        generatedTest = buildFallbackTest({ title, marks, durationMinutes, papers, template: paperTemplate });
        warning = "The AI response did not match the uploaded paper pattern, so Lakshya rebuilt the paper using the extracted exam structure.";
      }
    } catch (error) {
      console.error("generate-test error:", error);
      generatedTest = buildFallbackTest({ title, marks, durationMinutes, papers, template: paperTemplate });
      warning = "AI generation was unavailable, so the test was built directly from your uploaded papers.";
    }
  }

  generatedTest = formatExamMarkdownLayout(generatedTest);

  const session = await ExamSession.create({
    userId: req.user._id,
    title,
    date: formatDateTime(startAt),
    count: buildQuestionCount(marks),
    mode,
    status: "scheduled",
    attentionScore: 92,
    marks,
    durationMinutes,
    startAt,
    paperIds: papers.map((paper) => paper._id),
    generatedTest
  });

  return res.status(201).json({
    session: serializeSession(session),
    papers: papers.map(serializePaper),
    warning: `${legacyWarning}${warning}`.trim()
  });
});

router.get("/upcoming", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.json({ exams: [] });
  }

  const sessions = await ExamSession.find({ userId: req.user._id }).sort({ startAt: 1, createdAt: -1 });
  return res.json({ exams: sessions.map(serializeSession) });
});

router.get("/active", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.json({ session: null, incomingCall: null });
  }

  const activeSession = await resolveCurrentSession(req.user._id);
  const sharedParticipants = await loadSharedParticipants(activeSession);

  return res.json({
    session: activeSession ? serializeSession({ ...activeSession.toObject(), sharedParticipants }) : null,
    incomingCall: buildIncomingCall(activeSession)
  });
});

router.delete("/:sessionId", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    const targetIndex = exams.findIndex((session) => session._id === req.params.sessionId);

    if (targetIndex === -1) {
      return res.status(404).json({ message: "Scheduled test not found" });
    }

    exams.splice(targetIndex, 1);
    return res.json({ success: true, sessionId: req.params.sessionId });
  }

  const session = await ExamSession.findOne({ _id: req.params.sessionId, userId: req.user._id });

  if (!session) {
    return res.status(404).json({ message: "Scheduled test not found" });
  }

  if (session.status === "active") {
    return res.status(400).json({ message: "You cannot remove a test that is already active" });
  }

  await ExamSession.deleteOne({ _id: req.params.sessionId, userId: req.user._id });
  return res.json({ success: true, sessionId: req.params.sessionId });
});

router.post("/start", async (req, res) => {
  const sessionPayload = {
    title: req.body.title || "Practice Session",
    date: "Today",
    count: buildQuestionCount(req.body.marks || 80),
    mode: req.body.mode || "focus",
    status: "active",
    attentionScore: 92,
    marks: Number(req.body.marks || 80),
    durationMinutes: Number(req.body.durationMinutes || 60),
    startAt: new Date(),
    generatedTest: req.body.generatedTest || ""
  };

  if (mongoose.connection.readyState !== 1) {
    exams[0] = { ...exams[0], ...sessionPayload };
    return res.status(201).json({ session: exams[0] });
  }

  const session = await ExamSession.create({
    userId: req.user._id,
    ...sessionPayload
  });

  return res.status(201).json({ session: serializeSession(session) });
});

async function activateScheduledSession(sessionId, userId) {
  const acceptedAt = new Date();
  const scheduledSession = await ExamSession.findOne({ _id: sessionId, userId });

  if (!scheduledSession) {
    return null;
  }

  const session = await ExamSession.findOneAndUpdate(
    { _id: sessionId, userId },
    {
      status: "active",
      callAcceptedAt: acceptedAt,
      endsAt: new Date(acceptedAt.getTime() + Number(scheduledSession.durationMinutes || 60) * 60000)
    },
    { new: true }
  );

  return session;
}

router.post("/:sessionId/accept-call", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.json({
      session: {
        ...exams[0],
        status: "active",
        callAcceptedAt: new Date().toISOString(),
        endsAt: new Date(Date.now() + Number(exams[0].durationMinutes || 60) * 60000).toISOString()
      }
    });
  }

  const session = await activateScheduledSession(req.params.sessionId, req.user._id);

  if (!session) {
    return res.status(404).json({ message: "Scheduled test not found" });
  }

  return res.json({ session: serializeSession(session) });
});

// The student declined the incoming test call: the test is skipped and stops ringing.
router.post("/:sessionId/decline-call", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.json({ session: { ...exams[0], status: "declined" } });
  }

  const session = await ExamSession.findOneAndUpdate(
    { _id: req.params.sessionId, userId: req.user._id, status: "scheduled" },
    { status: "declined", declinedAt: new Date(), endedAt: new Date(), lastAlert: "You declined the test call." },
    { new: true }
  );

  if (!session) {
    return res.status(404).json({ message: "No ringing test found to decline." });
  }

  return res.json({ session: serializeSession(session) });
});

router.post("/:sessionId/auto-start", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.json({
      session: {
        ...exams[0],
        status: "active",
        callAcceptedAt: new Date().toISOString(),
        endsAt: new Date(Date.now() + Number(exams[0].durationMinutes || 60) * 60000).toISOString()
      }
    });
  }

  const session = await ExamSession.findOne({ _id: req.params.sessionId, userId: req.user._id });

  if (!session) {
    return res.status(404).json({ message: "Scheduled test not found" });
  }

  if (session.status === "active" && session.callAcceptedAt) {
    return res.json({ session: serializeSession(session) });
  }

  const startAt = session.startAt ? new Date(session.startAt).getTime() : NaN;
  const now = Date.now();
  const ringWindowMs = 15 * 60 * 1000;

  if (Number.isNaN(startAt) || now < startAt || now > startAt + ringWindowMs) {
    return res.status(400).json({ message: "This test is not ready to auto-start yet." });
  }

  const activatedSession = await activateScheduledSession(req.params.sessionId, req.user._id);

  if (!activatedSession) {
    return res.status(404).json({ message: "Scheduled test not found" });
  }

  return res.json({ session: serializeSession(activatedSession) });
});

router.post("/:sessionId/share-to-room", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ message: "Database unavailable. Start MongoDB and try again." });
  }

  const roomId = String(req.body.roomId || "").trim();

  if (!mongoose.Types.ObjectId.isValid(roomId)) {
    return res.status(400).json({ message: "Choose a valid study room before sending the invite." });
  }

  const session = await ExamSession.findOne({ _id: req.params.sessionId, userId: req.user._id });

  if (!session) {
    return res.status(404).json({ message: "Practice test not found" });
  }

  if (!session.generatedTest) {
    return res.status(400).json({ message: "Only generated practice tests can be shared with a study room." });
  }

  if (!session.startAt || Number.isNaN(new Date(session.startAt).getTime())) {
    return res.status(400).json({ message: "This practice test is missing a valid start time." });
  }

  const room = await ChatRoom.findById(roomId);

  if (!room) {
    return res.status(404).json({ message: "Study room not found" });
  }

  const requesterEmail = normalizeEmail(req.user.email);
  const isMember = room.members.some((member) => normalizeEmail(member.email) === requesterEmail);

  if (!isMember) {
    return res.status(403).json({ message: "You can only share a practice test to a study room you belong to." });
  }

  const inviteId = new mongoose.Types.ObjectId().toString();

  const inviteMessage = await ChatMessage.create({
    roomId: room._id,
    user: {
      userId: req.user._id,
      name: req.user.name || "Student",
      email: req.user.email,
      role: room.members.find((member) => normalizeEmail(member.email) === requesterEmail)?.role || "member"
    },
    text: `${req.user.name || "Your friend"} invited the room to join this practice test at the same time.`,
    kind: "practice-invite",
    practiceInvite: {
      inviteId,
      sessionId: session._id,
      title: session.title,
      marks: Number(session.marks || 80),
      durationMinutes: Number(session.durationMinutes || 60),
      startAt: session.startAt,
      generatedTest: session.generatedTest || "",
      mode: session.mode || "focus",
      invitedByUserId: req.user._id,
      invitedByName: req.user.name || "Student",
      invitedByEmail: req.user.email,
      joiners: []
    }
  });

  return res.status(201).json({
    message: "Practice test invite sent to the study room.",
    room: { _id: String(room._id), name: room.name },
    inviteMessageId: String(inviteMessage._id),
    inviteId
  });
});

router.post("/invites/:inviteId/join", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ message: "Database unavailable. Start MongoDB and try again." });
  }

  const inviteId = String(req.params.inviteId || "").trim();
  const inviteMessage = await ChatMessage.findOne({ "practiceInvite.inviteId": inviteId });

  if (!inviteMessage?.practiceInvite) {
    return res.status(404).json({ message: "Practice test invite not found" });
  }

  const room = await ChatRoom.findById(inviteMessage.roomId);

  if (!room) {
    return res.status(404).json({ message: "Study room not found" });
  }

  const requesterEmail = normalizeEmail(req.user.email);
  const isMember = room.members.some((member) => normalizeEmail(member.email) === requesterEmail);

  if (!isMember) {
    return res.status(403).json({ message: "You must be a member of this study room to join the practice test." });
  }

  const invite = inviteMessage.practiceInvite;
  const startAt = new Date(invite.startAt);

  if (Number.isNaN(startAt.getTime()) || !String(invite.generatedTest || "").trim()) {
    return res.status(400).json({ message: "This practice invite is incomplete and cannot be joined." });
  }

  if (Date.now() > buildSharedJoinDeadline(startAt).getTime()) {
    return res.status(400).json({ message: "The join window for this practice test has closed." });
  }

  if (normalizeEmail(invite.invitedByEmail) === requesterEmail) {
    return res.status(400).json({ message: "You already own this practice test." });
  }

  const existingSession = await ExamSession.findOne({
    userId: req.user._id,
    sharedInviteId: inviteId
  });

  if (existingSession) {
    return res.json({
      message: "You already joined this practice test.",
      session: serializeSession(existingSession),
      alreadyJoined: true
    });
  }

  // The structured paper is not copied into chat messages; take it from the shared session.
  const originSession = invite.sessionId ? await ExamSession.findById(invite.sessionId).select("generatedPaper").lean() : null;

  const session = await ExamSession.create({
    userId: req.user._id,
    title: invite.title || "Shared Practice Test",
    date: formatDateTime(startAt),
    count: buildQuestionCount(invite.marks),
    mode: invite.mode || "focus",
    status: "scheduled",
    attentionScore: 92,
    marks: Number(invite.marks || 80),
    durationMinutes: Number(invite.durationMinutes || 60),
    startAt,
    generatedTest: invite.generatedTest || "",
    generatedPaper: originSession?.generatedPaper || null,
    sharedInviteId: inviteId,
    sharedOriginSessionId: invite.sessionId,
    sharedRoomId: room._id,
    sharedByUserId: invite.invitedByUserId || null,
    sharedByName: invite.invitedByName || ""
  });

  invite.joiners.push({
    userId: req.user._id,
    name: req.user.name || "Student",
    email: req.user.email,
    sessionId: session._id,
    joinedAt: new Date()
  });
  inviteMessage.markModified("practiceInvite");
  await inviteMessage.save();

  return res.status(201).json({
    message: "You joined the shared practice test.",
    session: serializeSession(session),
    alreadyJoined: false
  });
});

// One webcam frame from the live proctor call -> computer-vision verdict from the proctor-ai service.
// Frames are forwarded in memory only; nothing is stored.
router.post("/:sessionId/proctor-frame", async (req, res) => {
  const image = typeof req.body.image === "string" ? req.body.image : "";
  const baseline = req.body.baseline && typeof req.body.baseline === "object" ? req.body.baseline : null;

  if (!image.startsWith("data:image/") || image.length > 3 * 1024 * 1024) {
    return res.status(400).json({ message: "Send one JPEG frame as a data URL (under 2 MB)." });
  }

  if (mongoose.connection.readyState === 1) {
    if (!mongoose.Types.ObjectId.isValid(req.params.sessionId)) {
      return res.status(404).json({ message: "Active session not found" });
    }

    const session = await ExamSession.findOne({ _id: req.params.sessionId, userId: req.user._id }).select("status").lean();
    if (!session || session.status !== "active") {
      return res.status(404).json({ message: "Active session not found" });
    }
  }

  try {
    const result = await analyzeFrame({
      image,
      baseline: baseline && Number.isFinite(Number(baseline.yaw)) && Number.isFinite(Number(baseline.pitch))
        ? { yaw: Number(baseline.yaw), pitch: Number(baseline.pitch) }
        : null
    });
    return res.json({ result });
  } catch (error) {
    return res.status(error.status || 502).json({ message: error.message });
  }
});

router.post("/:sessionId/proctor-alert", async (req, res) => {
  const message = String(req.body.message || "No cheating, focus on your paper.").trim();
  const attentionScore = Math.max(40, Math.min(99, Number(req.body.attentionScore || 82)));

  if (mongoose.connection.readyState !== 1) {
    return res.json({
      session: {
        ...exams[0],
        attentionScore,
        lastAlert: message
      }
    });
  }

  const session = await ExamSession.findOneAndUpdate(
    { _id: req.params.sessionId, userId: req.user._id },
    { attentionScore, lastAlert: message, $inc: { warningCount: 1 } },
    { new: true }
  );

  if (!session) {
    return res.status(404).json({ message: "Active session not found" });
  }

  return res.json({ session: serializeSession(session) });
});

router.post("/:sessionId/finish", async (req, res) => {
  const reason = String(req.body.reason || "completed").trim();
  const message = reason === "time-up" ? "Time is up. Upload your paper now." : "Test ended. Upload your paper now.";

  if (mongoose.connection.readyState !== 1) {
    return res.json({
      session: {
        ...exams[0],
        status: "completed",
        endedAt: new Date().toISOString(),
        lastAlert: message
      }
    });
  }

  const session = await ExamSession.findOneAndUpdate(
    { _id: req.params.sessionId, userId: req.user._id },
    { status: "completed", endedAt: new Date(), lastAlert: message },
    { new: true }
  );

  if (!session) {
    return res.status(404).json({ message: "Session not found" });
  }

  return res.json({ session: serializeSession(session) });
});

router.post("/:sessionId/leave", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.json({
      session: {
        ...exams[0],
        status: "left",
        endedAt: new Date().toISOString(),
        lastAlert: "You left the test. Upload your paper now."
      }
    });
  }

  const session = await ExamSession.findOneAndUpdate(
    { _id: req.params.sessionId, userId: req.user._id },
    { status: "left", endedAt: new Date(), lastAlert: "You left the test. Upload your paper now." },
    { new: true }
  );

  if (!session) {
    return res.status(404).json({ message: "Session not found" });
  }

  return res.json({ session: serializeSession(session) });
});

module.exports = router;
