const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const { PDFParse } = require("pdf-parse");
const authMiddleware = require("../middleware/authMiddleware");
const ConceptDocument = require("../models/ConceptDocument");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.use(authMiddleware);

function getModel() {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    return null;
  }

  return {
    apiKey,
    model: process.env.GROQ_MODEL || "llama-3.1-8b-instant"
  };
}

async function generateGroqText({ modelConfig, systemPrompt, userPrompt }) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
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
    return parsed.text || "";
  }

  if (file.mimetype.startsWith("text/")) {
    return file.buffer.toString("utf8");
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

    const model = getModel();
    let summary = "";

    if (model) {
      summary = await generateGroqText({
        modelConfig: model,
        systemPrompt: "You summarize study documents for students in short, useful language.",
        userPrompt: `Summarize this study document in 3 short bullet-style sentences.
Focus on the key chapters, concepts, or themes.

Document:
"""${extractedText.slice(0, 12000)}"""`
      });
    }

    const document = await ConceptDocument.create({
      userId: req.user._id,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      extractedText,
      summary
    });

    return res.status(201).json({ document: serializeDocument(document) });
  } catch (error) {
    console.error("concept-documents upload error:", error);
    return res.status(500).json({ message: error.message || "Failed to process the uploaded document" });
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
  if (!model) {
    return res.status(503).json({ message: "GROQ_API_KEY is missing. Add it to server/.env to use the AI explainer." });
  }

  const query = { userId: req.user._id };
  if (requestedDocumentIds.length) {
    query._id = { $in: requestedDocumentIds };
  }

  const documents = await ConceptDocument.find(query).sort({ createdAt: -1 });

  if (!documents.length) {
    return res.status(400).json({ message: "Upload at least one study document before asking the AI explainer." });
  }

  const context = documents
    .map((document, index) => `Document ${index + 1}: ${document.fileName}\n${document.extractedText.slice(0, 6000)}`)
    .join("\n\n");

  try {
    return res.json({
      answer: await generateGroqText({
        modelConfig: model,
        systemPrompt: `You are Lakshya's AI Concept Explainer.
Use the provided study documents as the main source of truth.
Explain topics in easy language for exam preparation.
Always respond in clean markdown.`,
        userPrompt: `Answer the student's question in easy language.

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
"""${context}"""`
      }),
      documents: documents.map(serializeDocument)
    });
  } catch (error) {
    console.error("concept-explainer ask error:", error);
    return res.status(500).json({ message: "Failed to generate an explanation right now" });
  }
});

module.exports = router;
