// routes/studyPlanRoutes.js
const express = require("express");
const multer = require("multer");
const { PDFParse } = require("pdf-parse");
const StudyPlan = require("../models/StudyPlan"); // adjust path if different
const jwt = require("jsonwebtoken");
const authMiddleware = require("../middleware/authMiddleware");
const { todayInAppZone } = require("./studyPlannerRoutes");

const router = express.Router();

// File upload in memory
const upload = multer({ storage: multer.memoryStorage() });

function inferSubject(line) {
  const normalized = line.toLowerCase();

  if (/(algebra|calculus|geometry|trigonometry|mathematics|math)/.test(normalized)) {
    return "Mathematics";
  }

  if (/(physics|motion|force|energy|electric|magnet|wave)/.test(normalized)) {
    return "Physics";
  }

  if (/(chemistry|atom|molecule|reaction|acid|base|organic)/.test(normalized)) {
    return "Chemistry";
  }

  if (/(biology|cell|genetics|human body|ecosystem|plant|animal)/.test(normalized)) {
    return "Biology";
  }

  return "General";
}

function topicLineFromText(line, index) {
  const cleanLine = line.replace(/\s+/g, " ").trim();
  const subject = inferSubject(cleanLine);
  const chapter = `Chapter ${index + 1}`;
  const topic = cleanLine.slice(0, 80);
  const minutes = cleanLine.length > 90 ? 90 : cleanLine.length > 45 ? 60 : 45;
  const priority = index < 3 ? "high" : index < 7 ? "medium" : "low";

  return `${subject} | ${chapter} | ${topic} | ${minutes} | ${priority}`;
}

function extractTopicLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 8)
    .filter((line) => /[a-zA-Z]/.test(line))
    .filter((line) => !/^page\s+\d+/i.test(line))
    .filter((line) => !/(telegram|whatsapp|instagram|youtube|subscribe|follow us|join link|http|www\.|@\w+)/i.test(line))
    .filter((line) => !/^[^a-zA-Z]*$/.test(line))
    .filter((line) => {
      const compact = line.replace(/\s+/g, " ").trim();
      const upperChars = compact.replace(/[^A-Z]/g, "").length;
      return !(upperChars >= 6 && upperChars >= compact.replace(/[^A-Za-z]/g, "").length * 0.7);
    })
    .slice(0, 12)
    .map(topicLineFromText);
}

function questionFromTopic(item) {
  if (item?.question) {
    return String(item.question).trim();
  }

  return `Explain ${item.topic} from ${item.chapter} in ${item.subject}. Start with the core idea, then tell me one formula, step, or application.`;
}

function expectedPointsFromTopic(item) {
  const points = Array.isArray(item?.expectedPoints) ? item.expectedPoints.filter(Boolean).map((value) => String(value)) : [];
  return points.length ? points : [item?.subject, item?.chapter, item?.topic].filter(Boolean).map((value) => String(value));
}

function normalizeRevisionItem(item, index) {
  const subject = cleanText(item?.subject) || inferSubject(String(item?.topic || item?.question || ""));
  const chapter = cleanText(item?.chapter) || `Chapter ${index + 1}`;
  const topic = cleanText(item?.topic) || cleanText(item?.question) || `Topic ${index + 1}`;
  const question = cleanText(item?.question) || `Explain ${topic} from ${chapter} in ${subject}.`;
  const expectedPoints = Array.isArray(item?.expectedPoints)
    ? item.expectedPoints.map((value) => cleanText(value)).filter(Boolean).slice(0, 5)
    : [];

  return {
    id: item?.id || `uploaded-${index + 1}`,
    subject,
    chapter,
    topic,
    question,
    expectedPoints: expectedPoints.length ? expectedPoints : [subject, chapter, topic].filter(Boolean)
  };
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeWeightage(value) {
  const normalized = cleanText(value).toLowerCase();
  if (normalized === "high" || normalized === "medium" || normalized === "low") {
    return normalized;
  }
  return "medium";
}

function normalizeDifficulty(value) {
  const normalized = cleanText(value).toLowerCase();
  if (normalized === "easy" || normalized === "medium" || normalized === "hard") {
    return normalized;
  }
  return "medium";
}

function normalizePlannerItem(item, index) {
  const subject = cleanText(item?.subject) || inferSubject(`${item?.chapter || ""} ${item?.topic || ""}`);
  const chapter = cleanText(item?.chapter) || `Chapter ${index + 1}`;
  const topic = cleanText(item?.topic) || chapter;
  const estimatedMinutes = Math.max(35, Number.parseInt(item?.estimatedMinutes, 10) || 60);
  const weightage = normalizeWeightage(item?.weightage);
  const difficulty = normalizeDifficulty(item?.difficulty);
  const priorityScore = { high: 3, medium: 2, low: 1 }[weightage] + { easy: 2, medium: 1, hard: 0 }[difficulty];
  const priority = priorityScore >= 4 ? "high" : priorityScore === 3 ? "medium" : "low";

  return {
    id: item?.id || `planner-${index + 1}`,
    subject,
    chapter,
    topic,
    weightage,
    difficulty,
    estimatedMinutes,
    recommendedOrder: Math.max(1, Number.parseInt(item?.recommendedOrder, 10) || index + 1),
    reason: cleanText(item?.reason) || "Recommended based on the syllabus structure and likely scoring value.",
    priority
  };
}

function buildFallbackPlannerItems(revisionItems = []) {
  const grouped = new Map();

  revisionItems.forEach((item, index) => {
    const key = `${item.subject}__${item.chapter}`;
    const current = grouped.get(key) || {
      subject: item.subject,
      chapter: item.chapter,
      topic: item.topic,
      estimatedMinutes: 0,
      count: 0,
      firstIndex: index
    };

    current.estimatedMinutes += 50;
    current.count += 1;
    grouped.set(key, current);
  });

  return Array.from(grouped.values())
    .sort((left, right) => right.count - left.count || left.firstIndex - right.firstIndex)
    .map((item, index, all) =>
      normalizePlannerItem(
        {
          subject: item.subject,
          chapter: item.chapter,
          topic: item.topic,
          estimatedMinutes: Math.max(40, item.estimatedMinutes),
          weightage: index === 0 ? "high" : index < Math.ceil(all.length / 2) ? "medium" : "low",
          difficulty: "medium",
          recommendedOrder: index + 1,
          reason:
            index === 0
              ? "Start here because this chapter appears central in the syllabus."
              : "Schedule after the earlier chapters for steady progress."
        },
        index
      )
    );
}

async function extractRevisionItemsWithAi({ modelConfig, text }) {
  const aiResult = await generateModelJson({
    modelConfig,
    systemPrompt: `You are Lakshya AI preparing a voice revision session from a student's uploaded PDF.
Return valid JSON only.
Extract 6 to 12 clean revision items from the study material.
Ignore ads, social links, join groups text, navigation labels, headers, footers, and noisy OCR fragments.
Each item must come from the actual study content and should be suitable for viva/oral revision.
JSON format:
{
  "items": [
    {
      "subject": "string",
      "chapter": "string",
      "topic": "string",
      "question": "string",
      "expectedPoints": ["string", "string", "string"]
    }
  ]
}`,
    userPrompt: `Create clean revision items from this uploaded PDF text.

Rules:
- Only use real study content from the PDF.
- Do not include junk text like "join telegram", URLs, page labels, or OCR garbage.
- Questions should sound natural and oral, like a teacher asking in a viva.
- expectedPoints should contain the key ideas a correct spoken answer should mention.
- Prefer conceptual questions over broken sentence fragments.

PDF text:
"""${text.slice(0, 14000)}"""`,
    temperature: modelConfig.provider === "xai" ? 0.1 : 0.15
  });

  const rawItems = Array.isArray(aiResult?.items) ? aiResult.items : [];
  return rawItems.map(normalizeRevisionItem).filter((item) => item.topic && item.question).slice(0, 12);
}

async function extractPlannerItemsWithAi({ modelConfig, text }) {
  const aiResult = await generateModelJson({
    modelConfig,
    systemPrompt: `You are Lakshya AI building a study plan from a student's syllabus PDF.
Return valid JSON only.
Read the syllabus carefully and extract the most important study chapters or units.
For each item, estimate:
- subject
- chapter
- one short topic focus
- weightage: high, medium, or low
- difficulty: easy, medium, or hard
- estimatedMinutes: realistic study time for a single focused block
- recommendedOrder: integer rank where 1 means study first
- reason: one short sentence explaining why this chapter should be placed there

Rules:
- Use only information supported by the syllabus text. Infer weightage conservatively from repetition, chapter prominence, unit wording, and syllabus structure.
- Prefer chapter or unit names over noisy fragments.
- Ignore headers, page numbers, ads, contact info, URLs, and OCR garbage.
- Return 4 to 12 items.

JSON format:
{
  "items": [
    {
      "subject": "string",
      "chapter": "string",
      "topic": "string",
      "weightage": "high|medium|low",
      "difficulty": "easy|medium|hard",
      "estimatedMinutes": 60,
      "recommendedOrder": 1,
      "reason": "string"
    }
  ],
  "planSummary": "string"
}`,
    userPrompt: `Analyze this syllabus PDF text and prepare a chapterwise study-planning breakdown.

Important:
- Rank easy high-value chapters earlier when reasonable.
- If the syllabus gives no explicit marks distribution, infer likely importance carefully and do not overclaim certainty.
- Keep chapter names clean and student-friendly.

PDF text:
"""${text.slice(0, 18000)}"""`,
    temperature: modelConfig.provider === "xai" ? 0.1 : 0.15
  });

  const rawItems = Array.isArray(aiResult?.items) ? aiResult.items : [];
  const items = rawItems
    .map(normalizePlannerItem)
    .filter((item) => item.chapter && item.topic)
    .sort((left, right) => left.recommendedOrder - right.recommendedOrder)
    .slice(0, 12);

  return {
    items,
    planSummary: cleanText(aiResult?.planSummary)
  };
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

async function generateModelJson({ modelConfig, systemPrompt, userPrompt, temperature = 0.3 }) {
  const response = await fetch(modelConfig.baseUrl, {
    method: "POST",
    signal: AbortSignal.timeout(30000),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${modelConfig.apiKey}`
    },
    body: JSON.stringify({
      model: modelConfig.model,
      // gpt-oss thinks at "medium" by default; "low" answers about twice as fast with the same quality here.
      ...(String(modelConfig.model).startsWith("openai/gpt-oss") ? { reasoning_effort: "low" } : {}),
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

function buildFallbackQuestion({ learnerName, topics, questionIndex }) {
  const topic = topics[questionIndex] || topics.find(Boolean) || topics[0];
  const safeName = learnerName || "there";

  if (!topic) {
    return {
      intro: `Hi ${safeName}. Welcome back to Lakshya. I could not extract enough study material from your file yet.`,
      question: "Please upload a clearer study PDF and then start voice revision again.",
      topic: "",
      expectedPoints: ["clear topic text from the uploaded PDF"],
      source: "fallback"
    };
  }

  return {
    intro: questionIndex === 0 ? `Hi ${safeName}. Welcome back to Lakshya. I have analyzed your study file. Let's start the revision.` : "",
    question: questionFromTopic(topic),
    topic: topic.topic,
    expectedPoints: expectedPointsFromTopic(topic),
    source: "fallback"
  };
}

function normalizeTopicKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function pickNextUnusedTopic(topics, askedTopics, preferredIndex = 0) {
  const askedSet = new Set((askedTopics || []).map(normalizeTopicKey).filter(Boolean));
  const candidates = Array.isArray(topics) ? topics : [];

  for (let index = preferredIndex; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const key = normalizeTopicKey(candidate?.topic || candidate?.chapter || candidate?.subject);
    if (candidate && (!key || !askedSet.has(key))) {
      return candidate;
    }
  }

  return candidates.find(Boolean) || null;
}

function sanitizeNextQuestion(nextQuestion, topics, askedTopics, preferredIndex) {
  if (nextQuestion && typeof nextQuestion === "object") {
    const topicKey = normalizeTopicKey(nextQuestion.topic || nextQuestion.question);
    const askedSet = new Set((askedTopics || []).map(normalizeTopicKey).filter(Boolean));

    if (topicKey && !askedSet.has(topicKey)) {
      return {
        intro: String(nextQuestion.intro || ""),
        question: String(nextQuestion.question || ""),
        topic: String(nextQuestion.topic || ""),
        expectedPoints: Array.isArray(nextQuestion.expectedPoints) ? nextQuestion.expectedPoints.map((item) => String(item)) : []
      };
    }
  }

  const fallbackTopic = pickNextUnusedTopic(topics, askedTopics, preferredIndex);
  if (!fallbackTopic) {
    return null;
  }

  return {
    intro: "",
    question: questionFromTopic(fallbackTopic),
    topic: String(fallbackTopic.topic || ""),
    expectedPoints: expectedPointsFromTopic(fallbackTopic)
  };
}

function evaluateFallbackAnswer({ answer, question }) {
  const normalizedAnswer = String(answer || "").toLowerCase();
  const keywords = Array.isArray(question?.expectedPoints)
    ? question.expectedPoints.flatMap((item) => String(item || "").toLowerCase().match(/[a-z0-9]{4,}/g) || [])
    : [];
  const matches = keywords.filter((keyword) => normalizedAnswer.includes(keyword));
  const answerWords = normalizedAnswer.match(/[a-z0-9]{2,}/g) || [];
  const coverage = keywords.length ? matches.length / keywords.length : 0;

  if (answerWords.length < 6) {
    return {
      heading: "Wrong or incomplete",
      verdict: "Try again",
      feedback: "Your answer is too short. Add the definition, one key relation, and one example from the topic.",
      scoreLabel: "Needs improvement",
      source: "fallback"
    };
  }

  if (coverage >= 0.5) {
    return {
      heading: "Right answer",
      verdict: "Correct",
      feedback: "Good recall. To improve further, make the answer more structured and add one precise formula or exam-style example.",
      scoreLabel: "Strong",
      source: "fallback"
    };
  }

  if (coverage >= 0.2) {
    return {
      heading: "Partly right",
      verdict: "Almost there",
      feedback: "You are on the right track, but your answer needs more topic-specific detail and a clearer explanation.",
      scoreLabel: "Medium",
      source: "fallback"
    };
  }

  return {
    heading: "Wrong answer",
    verdict: "Needs improvement",
    feedback: "Your answer misses the main points. Focus on the core concept, one supporting detail, and one application or formula.",
    scoreLabel: "Needs improvement",
    source: "fallback"
  };
}

// Build a day schedule: takes topics lines and converts to timed sessions
function buildDaySchedule(studyDate, startTime, breakMinutes, topics, reminderLeadMinutes) {
  let current = new Date(`${studyDate}T${startTime}:00`);

  const sessions = [];
  let totalMinutes = 0;

  topics.forEach((line, index) => {
    const parts = line.split("|").map((p) => p.trim());
    if (parts.length < 5) return;

    const [subject, chapter, topic, minutesStr, priorityRaw] = parts;
    const durationMinutes = Number(minutesStr) || 60;
    const priority = (priorityRaw || "medium").toLowerCase();

    const startAt = new Date(current);
    const endAt = new Date(startAt.getTime() + durationMinutes * 60 * 1000);
    const reminderAt = new Date(
      startAt.getTime() - (reminderLeadMinutes || 5) * 60 * 1000
    );

    const formatTime = (date) =>
      date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

    const timeLabel = `${formatTime(startAt)} - ${formatTime(endAt)}`;

    sessions.push({
      id: String(index + 1),
      subject,
      chapter,
      topic,
      durationMinutes,
      priority,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      reminderAt: reminderAt.toISOString(),
      reminderLeadMinutes,
      time: timeLabel,
      task: `${subject} - ${chapter}: ${topic}`,
      tag: priority,
      reminderText: `Your ${subject} block is starting. Focus on ${topic}.`
    });

    totalMinutes += durationMinutes;

    // Move current time forward by session duration + break
    current = new Date(endAt.getTime() + (breakMinutes || 10) * 60 * 1000);
  });

  return { sessions, totalMinutes };
}

// Route 1: upload PDF and turn extracted text into topic lines without an AI dependency
router.post("/from-pdf", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const parser = new PDFParse({ data: req.file.buffer });
    const pdfData = await parser.getText();
    const text = pdfData.text || "";
    const model = getModel();
    let revisionItems = [];
    let plannerItems = [];
    let planSummary = "";

    if (model) {
      try {
        revisionItems = await extractRevisionItemsWithAi({ modelConfig: model, text });
      } catch (error) {
        console.error("from-pdf AI extraction error:", error);
      }

      try {
        const plannerResult = await extractPlannerItemsWithAi({ modelConfig: model, text });
        plannerItems = plannerResult.items || [];
        planSummary = plannerResult.planSummary || "";
      } catch (error) {
        console.error("from-pdf AI planner error:", error);
      }
    }

    if (!revisionItems.length) {
      revisionItems = extractTopicLines(text).map((line, index) => {
        const [subjectRaw, chapterRaw, topicRaw] = line.split("|").map((part) => part.trim());
        return normalizeRevisionItem(
          {
            subject: subjectRaw,
            chapter: chapterRaw,
            topic: topicRaw,
            question: `Explain ${topicRaw} from ${chapterRaw} in ${subjectRaw}. Start with the core idea, then tell me one formula, step, or application.`
          },
          index
        );
      });
    }

    if (!revisionItems.length) {
      return res.status(400).json({ error: "Could not extract usable study topics from this PDF" });
    }

    if (!plannerItems.length) {
      plannerItems = buildFallbackPlannerItems(revisionItems);
    }

    const orderedPlannerItems = [...plannerItems].sort((left, right) => left.recommendedOrder - right.recommendedOrder);

    return res.json({
      topicsText: orderedPlannerItems
        .map((item) => `${item.subject} | ${item.chapter} | ${item.topic} | ${item.estimatedMinutes} | ${item.priority}`)
        .join("\n"),
      revisionItems,
      plannerItems: orderedPlannerItems,
      planSummary,
      extractedText: text.slice(0, 18000)
    });
  } catch (err) {
    console.error("from-pdf error:", err);
    return res.status(500).json({ error: "Failed to process PDF" });
  }
});

router.post("/voice-revision/start", authMiddleware, async (req, res) => {
  try {
    const learnerName = String(req.body.learnerName || req.user?.name || "").trim().split(" ")[0] || "there";
    const studyMaterial = String(req.body.studyMaterial || "").trim();
    const topics = Array.isArray(req.body.topics) ? req.body.topics : [];
    const questionIndex = Math.max(Number(req.body.questionIndex) || 0, 0);
    const askedTopics = Array.isArray(req.body.askedTopics) ? req.body.askedTopics : [];

    if (!studyMaterial && !topics.length) {
      return res.status(400).json({ message: "Study material is required to start voice revision." });
    }

    const model = getModel();

    if (!model) {
      return res.json(buildFallbackQuestion({ learnerName, topics, questionIndex }));
    }

    const aiResult = await generateModelJson({
      modelConfig: model,
      systemPrompt: `You are Lakshya AI, a warm but concise oral revision coach for Indian students.
Return valid JSON only.
Create one spoken revision question at a time from the uploaded study material.
Keep the tone natural and motivating.
The question must be answerable from the provided material.
Never ask about website text, ads, social media links, watermarks, or OCR garbage.
Only ask about the actual academic content of the uploaded PDF.
The JSON response must include:
- intro: string
- question: string
- topic: string
- expectedPoints: string[]`,
      userPrompt: `Student name: ${learnerName}
Question index: ${questionIndex}

Create the next oral revision question from this uploaded material.
- If question index is 0, include a short welcome line in "intro".
- If question index is greater than 0, keep "intro" empty.
- Ask a short natural viva-style question, not a long paragraph.
- expectedPoints should list 3 to 5 core ideas the answer should contain.
- Do not repeat or rephrase a topic that was already asked.
- Prefer the next unasked topic from the extracted topics list.
- Reject junk text like links, calls to action, channel names, or broken OCR phrases.

Already asked topics:
${JSON.stringify(askedTopics, null, 2)}

Topics extracted from the PDF:
${JSON.stringify(topics, null, 2)}

Study material excerpt:
"""${studyMaterial.slice(0, 12000)}"""`,
      temperature: model.provider === "xai" ? 0.15 : 0.2
    });

    const safeQuestion = sanitizeNextQuestion(
      {
        intro: aiResult.intro,
        question: aiResult.question,
        topic: aiResult.topic,
        expectedPoints: aiResult.expectedPoints
      },
      topics,
      askedTopics,
      questionIndex
    );

    return res.json({
      intro: String(aiResult.intro || ""),
      question: String(safeQuestion?.question || ""),
      topic: String(safeQuestion?.topic || ""),
      expectedPoints: Array.isArray(safeQuestion?.expectedPoints) ? safeQuestion.expectedPoints.map((item) => String(item)) : [],
      source: "groq"
    });
  } catch (error) {
    console.error("voice-revision start error:", error);
    return res.json({
      ...buildFallbackQuestion({
        learnerName: String(req.body.learnerName || req.user?.name || "").trim().split(" ")[0] || "there",
        topics: Array.isArray(req.body.topics) ? req.body.topics : [],
        questionIndex: Math.max(Number(req.body.questionIndex) || 0, 0)
      }),
      warning: "The AI model was unavailable, so Lakshya started revision using a fallback question."
    });
  }
});

router.post("/voice-revision/evaluate", authMiddleware, async (req, res) => {
  try {
    const learnerName = String(req.body.learnerName || req.user?.name || "").trim().split(" ")[0] || "there";
    const answer = String(req.body.answer || "").trim();
    const studyMaterial = String(req.body.studyMaterial || "").trim();
    const currentQuestion = req.body.currentQuestion && typeof req.body.currentQuestion === "object" ? req.body.currentQuestion : {};
    const topics = Array.isArray(req.body.topics) ? req.body.topics : [];
    const questionIndex = Math.max(Number(req.body.questionIndex) || 0, 0);
    const askedTopics = Array.isArray(req.body.askedTopics) ? req.body.askedTopics : [];
    const previousAnswers = Array.isArray(req.body.previousAnswers) ? req.body.previousAnswers : [];

    if (!answer) {
      return res.status(400).json({ message: "Answer is required." });
    }

    const model = getModel();

    if (!model) {
      const evaluation = evaluateFallbackAnswer({ answer, question: currentQuestion });
      const nextQuestion = topics[questionIndex + 1]
        ? buildFallbackQuestion({ learnerName, topics, questionIndex: questionIndex + 1 })
        : null;

      return res.json({
        evaluation,
        coachReply: nextQuestion
          ? `${evaluation.heading}. ${evaluation.feedback} Next question. ${nextQuestion.question}`
          : `No problem. ${evaluation.feedback} Revision round complete.`,
        nextQuestion,
        isComplete: !nextQuestion
      });
    }

    const aiResult = await generateModelJson({
      modelConfig: model,
      systemPrompt: `You are Lakshya AI, an oral revision coach.
Return valid JSON only.
Evaluate the student's answer against the question and study material.
Be honest, supportive, specific, and logically correct.
You must not hallucinate mistakes in a correct answer.
You must judge spoken paraphrases fairly using meaning, not exact wording.
When the student answer is basically correct, say so.
The JSON response must include:
- evaluation: { heading: string, verdict: string, feedback: string, scoreLabel: string }
- coachReply: string
- nextQuestion: { intro: string, question: string, topic: string, expectedPoints: string[] } | null
- isComplete: boolean`,
      userPrompt: `Student name: ${learnerName}
Current question index: ${questionIndex}

Evaluate the student's answer.

Rules:
- heading should be one of: "Right answer", "Partly right", "Wrong answer", "Wrong or incomplete"
- verdict should be short, like "Correct", "Almost there", "Needs improvement", or "Try again"
- feedback must clearly say what was right or wrong and how to improve
- Be generous about correct paraphrasing, synonyms, and natural spoken answers.
- Do not mark an answer wrong only because it is not worded exactly like the notes.
- If the student states the core concept correctly in simple language, prefer "Right answer" or "Partly right" over "Wrong answer".
- Only mark "Wrong answer" when the student clearly misses or contradicts the concept.
- If the student says they do not know, are not sure, or asks you to explain, respond warmly like "No problem. I will tell you the answer."
- When the student does not know, provide the answer clearly from the notes before moving on.
- coachReply should sound like a natural spoken tutor, not a template.
- Vary your wording across turns.
- If the answer is correct, acknowledge that first, then improve it gently.
- If the answer is unclear because the transcript seems broken, ask the student to repeat it instead of claiming it is wrong.
- If there is enough material for another question, generate nextQuestion
- Do not repeat or rephrase topics already asked.
- If revision should end, return nextQuestion as null and isComplete as true

Already asked topics:
${JSON.stringify(askedTopics, null, 2)}

Previous answer history:
${JSON.stringify(previousAnswers.slice(-4), null, 2)}

Current question:
${JSON.stringify(currentQuestion, null, 2)}

Student answer:
"""${answer}"""

Topics extracted from the PDF:
${JSON.stringify(topics, null, 2)}

Study material excerpt:
"""${studyMaterial.slice(0, 12000)}"""`,
      temperature: model.provider === "xai" ? 0.1 : 0.15
    });

    const evaluation = aiResult.evaluation && typeof aiResult.evaluation === "object" ? aiResult.evaluation : {};
    const nextQuestion = sanitizeNextQuestion(
      aiResult.nextQuestion && typeof aiResult.nextQuestion === "object" ? aiResult.nextQuestion : null,
      topics,
      askedTopics,
      questionIndex + 1
    );
    const coachReply = cleanText(
      aiResult.coachReply ||
        (nextQuestion
          ? `${String(evaluation.heading || "Partly right")}. ${String(evaluation.feedback || "")} Next question. ${String(nextQuestion.question || "")}`
          : `${String(evaluation.feedback || "Good effort.")} Revision round complete.`)
    );

    return res.json({
      evaluation: {
        heading: String(evaluation.heading || "Partly right"),
        verdict: String(evaluation.verdict || "Keep going"),
        feedback: String(evaluation.feedback || "Refine your answer with more topic-specific points."),
        scoreLabel: String(evaluation.scoreLabel || "Medium"),
        source: "groq"
      },
      coachReply,
      nextQuestion: nextQuestion
        ? {
            intro: String(nextQuestion.intro || ""),
            question: String(nextQuestion.question || ""),
            topic: String(nextQuestion.topic || ""),
            expectedPoints: Array.isArray(nextQuestion.expectedPoints) ? nextQuestion.expectedPoints.map((item) => String(item)) : []
          }
        : null,
      isComplete: Boolean(aiResult.isComplete) || !nextQuestion
    });
  } catch (error) {
    console.error("voice-revision evaluate error:", error);
    const currentQuestion = req.body.currentQuestion && typeof req.body.currentQuestion === "object" ? req.body.currentQuestion : {};
    const topics = Array.isArray(req.body.topics) ? req.body.topics : [];
    const questionIndex = Math.max(Number(req.body.questionIndex) || 0, 0);
    const evaluation = evaluateFallbackAnswer({ answer: req.body.answer, question: currentQuestion });
    const nextQuestion = topics[questionIndex + 1]
      ? buildFallbackQuestion({
          learnerName: String(req.body.learnerName || req.user?.name || "").trim().split(" ")[0] || "there",
          topics,
          questionIndex: questionIndex + 1
        })
      : null;

    return res.json({
      evaluation,
      coachReply: nextQuestion
        ? `${evaluation.heading}. ${evaluation.feedback} Next question. ${nextQuestion.question}`
        : `No problem. ${evaluation.feedback} Revision round complete.`,
      nextQuestion,
      isComplete: !nextQuestion,
      warning: "The AI model was unavailable, so Lakshya evaluated your answer using the fallback checker."
    });
  }
});

// Route 2: generate full plan with proper timetable and reminders
router.post("/generate-plan", async (req, res) => {
  try {
    const {
      userId,
      syllabusName,
      studyDate,
      startTime,
      endTime,
      breakMinutes,
      reminderLeadMinutes,
      topicsInput
    } = req.body;

    const topics = (topicsInput || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (!topics.length) {
      return res.status(400).json({ error: "No topics provided" });
    }

    const breakMins = Number(breakMinutes) || 10;
    const reminderLead = Number(reminderLeadMinutes) || 5;

    const { sessions, totalMinutes } = buildDaySchedule(
      studyDate,
      startTime,
      breakMins,
      topics,
      reminderLead
    );

    const plan = new StudyPlan({
      userId: userId || null,
      studyDate,
      syllabusName,
      studyWindow: {
        startTime,
        endTime,
        breakMinutes: breakMins,
        reminderLeadMinutes: reminderLead
      },
      summary: {
        totalSessions: sessions.length,
        totalMinutes,
        focusMessage:
          "Start with your first session and follow the timeline to complete your plan."
      },
      studyProgress: [],
      sessions,
      todayPlan: [],
      coach: {
        summary: "",
        voicePrompt: "",
        roadmap: []
      }
    });

    await plan.save();

    return res.json({ plan });
  } catch (err) {
    console.error("generate-plan error:", err);
    return res.status(500).json({ error: "Failed to generate plan" });
  }
});

// Route 3: today's plan (for initial load)
router.get("/today-plan", async (req, res) => {
  try {
    const today = todayInAppZone();
    const authHeader = req.headers.authorization || "";
    let userId = null;
    try {
      userId = authHeader.startsWith("Bearer ")
        ? jwt.verify(authHeader.slice(7), process.env.JWT_SECRET || "lakshya-dev-secret").userId
        : null;
    } catch (_error) {
      userId = null;
    }

    if (userId) {
      const latest = await StudyPlan.findOne({ userId, details: { $exists: true } }).sort({ createdAt: -1 }).lean();
      const todayEntry = latest?.details?.days?.find((day) => day.date === today);
      if (todayEntry) {
        const sessions = latest.sessions.filter((session) => session.startAt?.startsWith(today));
        return res.json({
          ...latest,
          studyDate: today,
          sessions,
          todayPlan: todayEntry.items
            .filter((item) => item.type === "study" || item.type === "revision")
            .map((item) => ({ time: `${item.start} - ${item.end}`, task: `${item.subject}: ${item.unit}`, tag: item.priority }))
        });
      }
    }

    const plan = await StudyPlan.findOne({ studyDate: today, ...(userId ? { userId } : {}) }).sort({
      createdAt: -1
    });

    if (!plan) {
      return res.json({});
    }

    return res.json(plan);
  } catch (err) {
    console.error("today-plan error:", err);
    return res.status(500).json({ error: "Failed to fetch today's plan" });
  }
});

module.exports = router;
