const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const { PDFParse } = require("pdf-parse");
const authMiddleware = require("../middleware/authMiddleware");
const ConceptDocument = require("../models/ConceptDocument");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
const YOUTUBE_API_BASE_URL = "https://www.googleapis.com/youtube/v3/search";

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

async function generateConceptAnswerSet({ modelConfig, question, context }) {
  const systemPrompt = `You are Lakshya's AI Concept Explainer.
Use the provided study documents as the main source of truth.
Explain topics in easy language for exam preparation.
Always respond in clean markdown.`;

  const detailedPrompt = `Answer the student's question in easy language.

Rules:
- Start with a short plain-language definition.
- Break the answer into short sections with markdown headings.
- If the question asks for a solution, show the steps clearly.
- Use bullet points where they improve readability.
- If a diagram would help, include a simple ASCII diagram in a fenced code block.
- If the original PDF likely had a diagram, explain it in words and provide a clean ASCII version when possible.
- Mention if the document does not fully cover the topic.
- End with a quick recap in 2 bullet points.

Question:
${question}

Study documents:
"""${context}"""`;

  const easyPrompt = `Create a second, simpler explanation for the same student question.

Rules:
- Write for a student who wants the easiest possible explanation.
- Keep it short, friendly, and very clear.
- Use markdown.
- Start with the heading "## Easy Explanation".
- Use only 3 to 5 short points or mini paragraphs.
- If the topic involves a process or solution, explain it in very simple step-by-step form.
- Avoid long technical wording unless absolutely needed.
- End with a short "### In one line" summary.

Question:
${question}

Study documents:
"""${context}"""`;

  const [answer, easyExplanation] = await Promise.all([
    generateGroqText({
      modelConfig,
      systemPrompt,
      userPrompt: detailedPrompt
    }),
    generateGroqText({
      modelConfig,
      systemPrompt,
      userPrompt: easyPrompt
    })
  ]);

  return { answer, easyExplanation };
}

async function generateQuizWithModel({ modelConfig, documents, questionCount }) {
  const systemPrompt = `You are Lakshya's study game generator.
Create a quiz only from the provided study documents.
Return valid JSON only. Do not include markdown fences or extra text.`;

  const userPrompt = `Build a study quiz from these uploaded notes.

Rules:
- Return a JSON object with keys "title" and "questions".
- "title" should be a short study-game name.
- "questions" must be an array of exactly ${questionCount} items.
- Each question object must contain:
  - "prompt": string
  - "options": array of 4 short strings
  - "answerIndex": number from 0 to 3
  - "explanation": short string that teaches the idea
  - "sourceLabel": short string with the source document name
- Every question must be answerable from the notes.
- Keep wording simple for students.
- Avoid duplicate questions.

Study documents:
"""${documents.map((document, index) => `Document ${index + 1}: ${document.fileName}\n${document.extractedText.slice(0, 5000)}`).join("\n\n")}"""`;

  const raw = await generateGroqText({
    modelConfig,
    systemPrompt,
    userPrompt
  });

  const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
  const parsed = JSON.parse(cleaned);
  const questions = Array.isArray(parsed?.questions) ? parsed.questions : [];

  return {
    title: String(parsed?.title || "PDF Quiz Challenge").trim() || "PDF Quiz Challenge",
    questions: questions.slice(0, questionCount).map((question, index) => ({
      id: `ai-question-${index + 1}`,
      prompt: String(question?.prompt || "").trim(),
      options: Array.isArray(question?.options)
        ? question.options.map((option) => String(option || "").trim()).filter(Boolean).slice(0, 4)
        : [],
      answerIndex: Number.isInteger(question?.answerIndex) ? question.answerIndex : 0,
      explanation: String(question?.explanation || "").trim(),
      sourceLabel: String(question?.sourceLabel || "").trim() || documents[0]?.fileName || "Study document"
    }))
  };
}

function getYoutubeApiKey() {
  return process.env.YOUTUBE_API_KEY || "";
}

function buildYoutubeSearchQuery(question) {
  return `${String(question || "").trim()} exam concept explained`;
}

async function fetchYoutubeVideos(question) {
  const apiKey = getYoutubeApiKey();
  const query = String(question || "").trim();

  if (!apiKey || !query) {
    return [];
  }

  const params = new URLSearchParams({
    key: apiKey,
    part: "snippet",
    type: "video",
    maxResults: "4",
    order: "relevance",
    q: buildYoutubeSearchQuery(query),
    videoEmbeddable: "true",
    safeSearch: "moderate",
    relevanceLanguage: "en"
  });

  const response = await fetch(`${YOUTUBE_API_BASE_URL}?${params.toString()}`, {
    method: "GET",
    signal: AbortSignal.timeout(12000)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.error?.message || "YouTube request failed");
  }

  return (data.items || [])
    .map((item) => {
      const videoId = item?.id?.videoId;

      if (!videoId) {
        return null;
      }

      return {
        id: videoId,
        title: item?.snippet?.title || "YouTube video",
        channelTitle: item?.snippet?.channelTitle || "YouTube",
        description: item?.snippet?.description || "",
        thumbnail:
          item?.snippet?.thumbnails?.medium?.url ||
          item?.snippet?.thumbnails?.high?.url ||
          item?.snippet?.thumbnails?.default?.url ||
          "",
        url: `https://www.youtube.com/watch?v=${videoId}`,
        embedUrl: `https://www.youtube.com/embed/${videoId}`
      };
    })
    .filter(Boolean);
}

function splitIntoSections(text) {
  return text
    .split(/\n\s*\n+/)
    .map((section) => section.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function normalizeExtractedText(text) {
  return String(text || "")
    .normalize("NFKC")
    .replace(/([A-Za-z])Θ([A-Za-z])/g, "$1ti$2")
    .replace(/([A-Za-z])Σ([A-Za-z])/g, "$1tt$2");
}

function normalizeDocuments(documents) {
  return documents.map((document) => {
    const plainDocument = typeof document.toObject === "function" ? document.toObject() : document;

    return {
      ...plainDocument,
      extractedText: normalizeExtractedText(plainDocument.extractedText)
    };
  });
}

function scoreSection(section, questionTerms) {
  const normalizedSection = section.toLowerCase();

  return questionTerms.reduce((score, term) => {
    if (!term || term.length < 3 || !normalizedSection.includes(term)) {
      return score;
    }

    return score + (normalizedSection.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
  }, 0);
}

function buildFallbackAnswer({ question, documents }) {
  const questionTerms = Array.from(
    new Set(
      question
        .toLowerCase()
        .match(/[a-z0-9]{3,}/g)
        ?.filter((term) => !["what", "when", "where", "which", "their", "there", "about", "explain"].includes(term)) || []
    )
  );

  const rankedSections = documents
    .flatMap((document) =>
      splitIntoSections(document.extractedText).map((section) => ({
        fileName: document.fileName,
        section,
        score: scoreSection(section, questionTerms)
      }))
    )
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);

  if (!rankedSections.length) {
    const firstDocument = documents[0];
    const preview = splitIntoSections(firstDocument.extractedText)[0] || firstDocument.extractedText.slice(0, 500).trim();

    return [
      "## Notes-Based Response",
      "",
      `I could not reach the AI model, so here is the best answer I can assemble from **${firstDocument.fileName}**.`,
      "",
      "### What your notes currently show",
      preview || "The uploaded document is available, but I could not find a readable passage to quote from it.",
      "",
      "### Next step",
      `Try asking a more specific question about a chapter, formula, or definition from **${firstDocument.fileName}** so I can match the most relevant part of your notes.`
    ].join("\n");
  }

  const sources = Array.from(new Set(rankedSections.map((item) => item.fileName)));

  return [
    "## Notes-Based Response",
    "",
    "I could not reach the AI model, so I answered directly from your uploaded study material.",
    "",
    "### Relevant points from your documents",
    ...rankedSections.map((item) => `- **${item.fileName}:** ${item.section.slice(0, 420).trim()}`),
    "",
    "### Quick recap",
    `- I matched this answer using ${sources.join(", ")}.`,
    "- Ask a more specific follow-up if you want a cleaner step-by-step explanation."
  ].join("\n");
}

function buildFallbackEasyExplanation({ question, documents }) {
  const firstDocument = documents[0];
  const preview = splitIntoSections(firstDocument.extractedText)[0] || firstDocument.extractedText.slice(0, 280).trim();

  return [
    "## Easy Explanation",
    "",
    `Here is a simpler version of **${question}** from your notes.`,
    "",
    preview || "Your notes are available, but I could not find a short passage to simplify.",
    "",
    "### In one line",
    "This topic becomes easier when you focus on the main idea first and then learn the important terms."
  ].join("\n");
}

function splitIntoSentences(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function extractKeywords(text) {
  return Array.from(
    new Set(
      String(text || "")
        .toLowerCase()
        .match(/[a-z][a-z-]{3,}/g) || []
    )
  ).filter((word) => !["that", "this", "with", "from", "into", "there", "their", "which", "about", "because", "these"].includes(word));
}

function pickBlankWord(sentence, globalKeywords) {
  const originalWords = Array.from(new Set(String(sentence || "").match(/\b[A-Za-z][A-Za-z-]{3,}\b/g) || []));
  const preferred = originalWords
    .filter((word) => !["This", "That", "These", "Those", "When", "Where", "Which", "Because"].includes(word))
    .sort((left, right) => right.length - left.length);

  const answer = preferred[0];
  if (!answer) {
    return null;
  }

  const distractors = globalKeywords
    .filter((word) => word.toLowerCase() !== answer.toLowerCase())
    .sort((left, right) => Math.abs(left.length - answer.length) - Math.abs(right.length - answer.length))
    .slice(0, 3);

  if (distractors.length < 3) {
    return null;
  }

  return {
    answer,
    options: [answer, ...distractors]
  };
}

function shuffleOptions(options, answer) {
  const shuffled = [...options].sort(() => Math.random() - 0.5);
  const answerIndex = shuffled.findIndex((option) => option.toLowerCase() === String(answer || "").toLowerCase());
  return { shuffled, answerIndex: answerIndex >= 0 ? answerIndex : 0 };
}

function buildFallbackQuiz({ documents, questionCount }) {
  const globalKeywords = Array.from(
    new Set(
      documents
        .flatMap((document) => extractKeywords(document.extractedText))
        .filter(Boolean)
    )
  );

  const candidates = documents.flatMap((document) =>
    splitIntoSentences(document.extractedText)
      .filter((sentence) => sentence.length >= 55 && sentence.length <= 220)
      .map((sentence) => ({ fileName: document.fileName, sentence }))
  );

  const questions = [];

  for (const candidate of candidates) {
    if (questions.length >= questionCount) {
      break;
    }

    const blankWord = pickBlankWord(candidate.sentence, globalKeywords);
    if (!blankWord) {
      continue;
    }

    const maskedSentence = candidate.sentence.replace(new RegExp(`\\b${blankWord.answer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`), "_____");
    const { shuffled, answerIndex } = shuffleOptions(blankWord.options, blankWord.answer);

    if (maskedSentence === candidate.sentence || answerIndex < 0) {
      continue;
    }

    questions.push({
      id: `fallback-question-${questions.length + 1}`,
      prompt: `Complete this statement from your notes:\n\n${maskedSentence}`,
      options: shuffled,
      answerIndex,
      explanation: candidate.sentence,
      sourceLabel: candidate.fileName
    });
  }

  return {
    title: "PDF Quiz Challenge",
    questions: questions.slice(0, questionCount)
  };
}

function normalizeQuizPayload(quiz, fallbackDocuments, questionCount) {
  const normalizedQuestions = Array.isArray(quiz?.questions)
    ? quiz.questions
        .map((question, index) => {
          const options = Array.isArray(question?.options)
            ? question.options.map((option) => String(option || "").trim()).filter(Boolean).slice(0, 4)
            : [];

          return {
            id: String(question?.id || `quiz-question-${index + 1}`),
            prompt: String(question?.prompt || "").trim(),
            options,
            answerIndex: Number.isInteger(question?.answerIndex) ? question.answerIndex : 0,
            explanation: String(question?.explanation || "").trim(),
            sourceLabel: String(question?.sourceLabel || "").trim() || fallbackDocuments[0]?.fileName || "Study document"
          };
        })
        .filter((question) => question.prompt && question.options.length === 4 && question.answerIndex >= 0 && question.answerIndex < 4)
        .slice(0, questionCount)
    : [];

  if (!normalizedQuestions.length) {
    return buildFallbackQuiz({ documents: fallbackDocuments, questionCount });
  }

  return {
    title: String(quiz?.title || "PDF Quiz Challenge").trim() || "PDF Quiz Challenge",
    questions: normalizedQuestions
  };
}

function serializeDocument(document) {
  return {
    _id: document._id,
    fileName: document.fileName,
    mimeType: document.mimeType,
    summary: document.summary,
    uploadedAt: document.createdAt
  };
}

async function extractDocumentText(file) {
  if (file.mimetype === "application/pdf") {
    const parser = new PDFParse({ data: file.buffer });
    const parsed = await parser.getText();
    return normalizeExtractedText(parsed.text);
  }

  if (file.mimetype.startsWith("text/")) {
    return normalizeExtractedText(file.buffer.toString("utf8"));
  }

  throw new Error("Only PDF and text files are supported right now");
}

router.get("/documents", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ message: "Database unavailable. Start MongoDB and try again." });
  }

  const documents = await ConceptDocument.find({ userId: req.user._id }).sort({ createdAt: -1 });
  return res.json({ documents: documents.map(serializeDocument) });
});

router.post("/documents", upload.single("file"), async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ message: "Database unavailable. Start MongoDB and try again." });
  }

  if (!req.file) {
    return res.status(400).json({ message: "Please upload a PDF or text document" });
  }

  try {
    const extractedText = (await extractDocumentText(req.file)).trim();

    if (!extractedText) {
      return res.status(400).json({ message: "The uploaded document did not contain readable text" });
    }

    const document = await ConceptDocument.create({
      userId: req.user._id,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      extractedText,
      summary: ""
    });

    return res.status(201).json({ document: serializeDocument(document) });
  } catch (error) {
    console.error("concept-documents upload error:", error);
    return res.status(500).json({ message: error.message || "Failed to process the uploaded document" });
  }
});

router.delete("/documents/:documentId", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ message: "Database unavailable. Start MongoDB and try again." });
  }

  const deletedDocument = await ConceptDocument.findOneAndDelete({
    _id: req.params.documentId,
    userId: req.user._id
  });

  if (!deletedDocument) {
    return res.status(404).json({ message: "Document not found" });
  }

  return res.json({ success: true, documentId: req.params.documentId });
});

router.get("/videos", async (req, res) => {
  const question = String(req.query.question || "").trim();

  if (!question) {
    return res.status(400).json({ message: "Question is required" });
  }

  try {
    const videos = await fetchYoutubeVideos(question);
    return res.json({ videos });
  } catch (error) {
    console.error("concept-explainer standalone youtube error:", error);
    return res.status(500).json({ message: "Failed to fetch related videos" });
  }
});

router.post("/ask", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ message: "Database unavailable. Start MongoDB and try again." });
  }

  const question = String(req.body.question || "").trim();
  const requestedDocumentIds = Array.isArray(req.body.documentIds) ? req.body.documentIds : [];

  if (!question) {
    return res.status(400).json({ message: "Question is required" });
  }

  const model = getModel();

  const query = { userId: req.user._id };
  if (requestedDocumentIds.length) {
    query._id = { $in: requestedDocumentIds };
  }

  const documents = normalizeDocuments(await ConceptDocument.find(query).sort({ createdAt: -1 }));

  if (!documents.length) {
    return res.status(400).json({ message: "Upload at least one study document before asking the AI explainer." });
  }

  const context = documents
    .map((document, index) => `Document ${index + 1}: ${document.fileName}\n${document.extractedText.slice(0, 6000)}`)
    .join("\n\n");
  let videos = [];

  try {
    videos = await fetchYoutubeVideos(question);
  } catch (error) {
    console.error("concept-explainer youtube error:", error);
  }

  if (!model) {
    return res.json({
      answer: buildFallbackAnswer({ question, documents }),
      easyExplanation: buildFallbackEasyExplanation({ question, documents }),
      videos,
      documents: documents.map(serializeDocument),
      source: "fallback",
      warning: "The AI model is not configured, so the answer was generated directly from your uploaded notes."
    });
  }

  try {
    const { answer, easyExplanation } = await generateConceptAnswerSet({
      modelConfig: model,
      question,
      context
    });

    return res.json({
      answer,
      easyExplanation,
      videos,
      documents: documents.map(serializeDocument),
      source: "groq"
    });
  } catch (error) {
    console.error("concept-explainer ask error:", error);
    return res.json({
      answer: buildFallbackAnswer({ question, documents }),
      easyExplanation: buildFallbackEasyExplanation({ question, documents }),
      videos,
      documents: documents.map(serializeDocument),
      source: "fallback",
      warning: "The AI model was unavailable, so the answer was generated directly from your uploaded notes."
    });
  }
});

router.post("/game", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ message: "Database unavailable. Start MongoDB and try again." });
  }

  const requestedDocumentIds = Array.isArray(req.body.documentIds) ? req.body.documentIds : [];
  const requestedCount = Number.parseInt(req.body.questionCount, 10);
  const questionCount = Number.isFinite(requestedCount) ? Math.min(Math.max(requestedCount, 3), 10) : 5;

  const query = { userId: req.user._id };
  if (requestedDocumentIds.length) {
    query._id = { $in: requestedDocumentIds };
  }

  const documents = normalizeDocuments(await ConceptDocument.find(query).sort({ createdAt: -1 }));

  if (!documents.length) {
    return res.status(400).json({ message: "Upload at least one study document before starting the quiz game." });
  }

  const model = getModel();

  try {
    const quiz = model
      ? normalizeQuizPayload(await generateQuizWithModel({ modelConfig: model, documents, questionCount }), documents, questionCount)
      : buildFallbackQuiz({ documents, questionCount });

    if (!quiz.questions.length) {
      return res.status(400).json({ message: "Lakshya could not build quiz questions from that PDF. Try a clearer study document." });
    }

    return res.json({
      quiz,
      source: model ? "groq" : "fallback",
      warning: model ? "" : "AI quiz generation is unavailable, so Lakshya built the game directly from your uploaded notes."
    });
  } catch (error) {
    console.error("concept-explainer game error:", error);
    const quiz = buildFallbackQuiz({ documents, questionCount });

    if (!quiz.questions.length) {
      return res.status(500).json({ message: "Failed to create a study game from the uploaded PDF." });
    }

    return res.json({
      quiz,
      source: "fallback",
      warning: "Lakshya could not reach the AI model, so the quiz was built directly from your uploaded notes."
    });
  }
});

module.exports = router;
