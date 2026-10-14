const express = require("express");
const multer = require("multer");
const { PDFParse } = require("pdf-parse");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function getModel() {
  if (process.env.XAI_API_KEY) {
    return {
      provider: "xai",
      apiKey: process.env.XAI_API_KEY,
      baseUrl: "https://api.x.ai/v1/chat/completions",
      model: process.env.XAI_MODEL || "grok-4-1-fast-reasoning"
    };
  }

  if (process.env.GROQ_API_KEY) {
    return {
      provider: "groq",
      apiKey: process.env.GROQ_API_KEY,
      baseUrl: "https://api.groq.com/openai/v1/chat/completions",
      model: process.env.GROQ_MODEL || "openai/gpt-oss-20b"
    };
  }

  return null;
}

async function generateModelJson({ modelConfig, systemPrompt, userPrompt, temperature = 0.2 }) {
  const response = await fetch(modelConfig.baseUrl, {
    method: "POST",
    signal: AbortSignal.timeout(30000),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${modelConfig.apiKey}`
    },
    body: JSON.stringify({
      model: modelConfig.model,
      temperature,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.error?.message || `${modelConfig.provider} request failed`);
  }

  return JSON.parse(data?.choices?.[0]?.message?.content || "{}");
}

async function extractDocumentText(file) {
  if (!file) {
    return "";
  }

  if (file.mimetype === "application/pdf") {
    const parser = new PDFParse({ data: file.buffer });
    const parsed = await parser.getText();
    return cleanText(parsed.text || "");
  }

  if (file.mimetype.startsWith("text/")) {
    return cleanText(file.buffer.toString("utf8"));
  }

  throw new Error("Only PDF and text files are supported for evaluation right now.");
}

function tokenize(text) {
  return Array.from(
    new Set(
      cleanText(text)
        .toLowerCase()
        .match(/[a-z0-9]{3,}/g) || []
    )
  ).filter((term) => !["this", "that", "with", "from", "have", "were", "their", "there", "which"].includes(term));
}

function sentenceChunks(text) {
  return String(text || "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((line) => cleanText(line))
    .filter(Boolean);
}

function buildFallbackEvaluation({ studentText, topperText }) {
  const studentTerms = tokenize(studentText);
  const topperTerms = tokenize(topperText);
  const topperSet = new Set(topperTerms);
  const matchedTerms = studentTerms.filter((term) => topperSet.has(term));
  const missingTerms = topperTerms.filter((term) => !studentTerms.includes(term)).slice(0, 8);
  const overlapRatio = topperTerms.length ? matchedTerms.length / topperTerms.length : 0;
  const lengthRatio = Math.min(1, studentText.length / Math.max(topperText.length, 1));
  const score = Math.max(18, Math.min(96, Math.round(overlapRatio * 70 + lengthRatio * 20 + 10)));
  const matchedChunks = sentenceChunks(topperText).filter((chunk) =>
    matchedTerms.some((term) => chunk.toLowerCase().includes(term))
  );
  const missedChunks = sentenceChunks(topperText).filter((chunk) =>
    missingTerms.some((term) => chunk.toLowerCase().includes(term))
  );

  return {
    marks: score,
    verdict: score >= 80 ? "Strong answer" : score >= 60 ? "Good attempt" : score >= 40 ? "Needs improvement" : "Weak coverage",
    summary:
      score >= 80
        ? "Your answer covers many of the points seen in the topper's solution, but there is still room to sharpen precision."
        : "Your answer partially matches the topper's solution, but it is missing some important concepts and structure.",
    strengths: matchedChunks.slice(0, 3).map((chunk) => `You touched on: ${chunk}`),
    improvements: missingTerms.slice(0, 5).map((term) => `Add clearer explanation around "${term}".`),
    feedback: [
      `Coverage match with topper answer: ${matchedTerms.length}/${Math.max(topperTerms.length, 1)} key terms.`,
      studentText.length < topperText.length * 0.55 ? "Your answer is shorter than the topper's version. Add more complete points and examples." : "Your answer length is reasonably close to the topper's version.",
      missingTerms.length ? `Focus next on these missing ideas: ${missingTerms.slice(0, 4).join(", ")}.` : "You captured most of the major ideas from the topper's answer."
    ],
    matchedConcepts: matchedTerms.slice(0, 8),
    missingConcepts: missingTerms
  };
}

router.post(
  "/evaluate",
  authMiddleware,
  upload.fields([
    { name: "studentSolution", maxCount: 1 },
    { name: "topperSolution", maxCount: 1 }
  ]),
  async (req, res) => {
    const studentFile = req.files?.studentSolution?.[0];
    const topperFile = req.files?.topperSolution?.[0];

    if (!studentFile || !topperFile) {
      return res.status(400).json({ message: "Please upload both your solution and the topper's solution." });
    }

    try {
      const [studentText, topperText] = await Promise.all([extractDocumentText(studentFile), extractDocumentText(topperFile)]);

      if (!studentText || !topperText) {
        return res.status(400).json({ message: "Both uploaded files must contain readable text." });
      }

      const model = getModel();
      const fallbackEvaluation = buildFallbackEvaluation({ studentText, topperText });

      if (!model) {
        return res.json({
          evaluation: fallbackEvaluation,
          source: "fallback",
          warning: "AI evaluation is not configured, so Lakshya used a fallback comparison against the topper's solution."
        });
      }

      try {
        const evaluation = await generateModelJson({
          modelConfig: model,
          systemPrompt: `You are Lakshya AI, an exam answer evaluator.
Compare a student's solution with a topper's solution and return valid JSON only.
Be fair, concise, and exam-oriented.
Score based on concept coverage, structure, accuracy, completeness, and clarity.
Do not invent facts outside the provided answers.

JSON format:
{
  "marks": number,
  "verdict": "string",
  "summary": "string",
  "strengths": ["string"],
  "improvements": ["string"],
  "feedback": ["string"],
  "matchedConcepts": ["string"],
  "missingConcepts": ["string"]
}`,
          userPrompt: `Evaluate the student's solution against the topper's solution.

Rules:
- Give marks out of 100.
- "strengths" should mention what the student did well.
- "improvements" should clearly say where the student can improve.
- "feedback" should be exam-actionable and short.
- "matchedConcepts" should list important ideas present in both answers.
- "missingConcepts" should list important ideas present in the topper answer but missing or weak in the student's answer.

Student solution:
"""${studentText.slice(0, 14000)}"""

Topper solution:
"""${topperText.slice(0, 14000)}"""`,
          temperature: 0.15
        });

        return res.json({
          evaluation: {
            marks: Number.isFinite(Number(evaluation.marks)) ? Math.max(0, Math.min(100, Math.round(Number(evaluation.marks)))) : fallbackEvaluation.marks,
            verdict: cleanText(evaluation.verdict) || fallbackEvaluation.verdict,
            summary: cleanText(evaluation.summary) || fallbackEvaluation.summary,
            strengths: Array.isArray(evaluation.strengths) ? evaluation.strengths.map(cleanText).filter(Boolean).slice(0, 4) : fallbackEvaluation.strengths,
            improvements: Array.isArray(evaluation.improvements)
              ? evaluation.improvements.map(cleanText).filter(Boolean).slice(0, 5)
              : fallbackEvaluation.improvements,
            feedback: Array.isArray(evaluation.feedback) ? evaluation.feedback.map(cleanText).filter(Boolean).slice(0, 5) : fallbackEvaluation.feedback,
            matchedConcepts: Array.isArray(evaluation.matchedConcepts)
              ? evaluation.matchedConcepts.map(cleanText).filter(Boolean).slice(0, 8)
              : fallbackEvaluation.matchedConcepts,
            missingConcepts: Array.isArray(evaluation.missingConcepts)
              ? evaluation.missingConcepts.map(cleanText).filter(Boolean).slice(0, 8)
              : fallbackEvaluation.missingConcepts
          },
          source: model.provider
        });
      } catch (error) {
        console.error("answer-evaluator ai error:", error);
        return res.json({
          evaluation: fallbackEvaluation,
          source: "fallback",
          warning: "AI evaluation was unavailable, so Lakshya used a fallback comparison against the topper's solution."
        });
      }
    } catch (error) {
      console.error("answer-evaluator evaluate error:", error);
      return res.status(500).json({ message: error.message || "Could not evaluate the uploaded solutions." });
    }
  }
);

module.exports = router;
