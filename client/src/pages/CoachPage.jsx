import { FileText, Mic, MicOff, PhoneOff, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { studyPlanApi, trackStudyEvent } from "../api/client";
import { useAuth } from "../context/AuthContext";

const FIRST_USE_SUMMARY = "Upload your study PDF and Lakshya will turn it into an oral revision round with spoken questions, answer checks, and instant feedback.";
const FIRST_USE_PROMPT = "Upload your study file below, then click Start Voice Revision to begin.";

function cleanTopic(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function inferSubjectFromTopic(topic) {
  const normalized = cleanTopic(topic).toLowerCase();

  if (/(physics|electrostatics|motion|force|wave|current|energy|thermo|magnet)/.test(normalized)) return "Physics";
  if (/(chemistry|atom|molecule|organic|reaction|bond|acid|base|equilibrium)/.test(normalized)) return "Chemistry";
  if (/(math|mathematics|algebra|integration|differentiation|probability|matrix|vector)/.test(normalized)) return "Mathematics";
  if (/(biology|cell|genetics|human|ecosystem|plant|animal|respiration)/.test(normalized)) return "Biology";

  return "General";
}

function parseUploadedTopics(topicsText) {
  return String(topicsText || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [subjectRaw, chapterRaw, topicRaw, durationRaw, priorityRaw] = line.split("|").map((part) => part.trim());
      const subject = subjectRaw || inferSubjectFromTopic(topicRaw || chapterRaw || line);
      const topic = cleanTopic(topicRaw || chapterRaw || line);

      return {
        id: `uploaded-${index + 1}`,
        subject,
        chapter: cleanTopic(chapterRaw || `Topic ${index + 1}`),
        topic,
        duration: durationRaw || "",
        priority: priorityRaw || "medium"
      };
    });
}

function normalizeRevisionItems(items) {
  return (Array.isArray(items) ? items : [])
    .map((item, index) => ({
      id: item?.id || `uploaded-${index + 1}`,
      subject: cleanTopic(item?.subject || inferSubjectFromTopic(item?.topic || item?.question || "")),
      chapter: cleanTopic(item?.chapter || `Chapter ${index + 1}`),
      topic: cleanTopic(item?.topic || item?.question || `Topic ${index + 1}`),
      question: cleanTopic(item?.question || ""),
      expectedPoints: Array.isArray(item?.expectedPoints) ? item.expectedPoints.map((value) => cleanTopic(value)).filter(Boolean) : []
    }))
    .filter((item) => item.topic);
}

// Converts the coach's verdict into a 0-100 score for My Progress.
function scoreFromHeading(heading) {
  const normalized = String(heading || "").toLowerCase();

  if (normalized.includes("partly")) {
    return 60;
  }

  if (normalized.includes("right")) {
    return 100;
  }

  return 20;
}

function toneFromHeading(heading) {
  const normalized = String(heading || "").toLowerCase();

  if (normalized.includes("right")) {
    return "strong";
  }

  if (normalized.includes("partly")) {
    return "medium";
  }

  return "needs-work";
}

function isIDontKnowReply(text) {
  const normalized = cleanTopic(text).toLowerCase();
  return /^(i\s*(do not|don't)\s*know|not sure|no idea|i am not sure|i'm not sure|can you explain|please explain)/.test(normalized);
}

function shouldRetryTranscript(text, confidence) {
  const normalized = cleanTopic(text);
  const wordCount = normalized ? normalized.split(/\s+/).length : 0;

  if (!normalized) {
    return true;
  }

  if (isIDontKnowReply(normalized)) {
    return false;
  }

  if (wordCount <= 2) {
    return true;
  }

  if (confidence > 0 && confidence < 0.58 && wordCount < 10) {
    return true;
  }

  return false;
}

function isRepeatRequest(text) {
  const normalized = cleanTopic(text).toLowerCase();
  return /(repeat( the)? question|say that again|come again|pardon|sorry repeat|repeat please|what was the question)/.test(normalized);
}

function CoachPage() {
  const { user } = useAuth();
  const [uploadedTopics, setUploadedTopics] = useState([]);
  const [studyMaterial, setStudyMaterial] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const [sessionStage, setSessionStage] = useState("idle");
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [callActive, setCallActive] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [answerDraft, setAnswerDraft] = useState("");
  const [currentPrompt, setCurrentPrompt] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [askedTopics, setAskedTopics] = useState([]);
  const [answerHistory, setAnswerHistory] = useState([]);
  const [uploadedFileName, setUploadedFileName] = useState("");
  const recognitionRef = useRef(null);
  const transcriptRef = useRef("");
  const confidenceRef = useRef(0);
  const shouldAutoSubmitRef = useRef(false);
  const silenceTimerRef = useRef(null);
  const speechTimerRef = useRef(null);
  const learnerName = cleanTopic(user?.name).split(" ")[0] || "there";

  function speakText(text) {
    if (!text || !("speechSynthesis" in window)) {
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
  }

  function queueSpeech(text, delay = 450) {
    if (!text || !("speechSynthesis" in window)) {
      return;
    }

    if (speechTimerRef.current) {
      window.clearTimeout(speechTimerRef.current);
    }

    window.speechSynthesis.cancel();
    speechTimerRef.current = window.setTimeout(() => {
      speakText(text);
      speechTimerRef.current = null;
    }, delay);
  }

  useEffect(() => {
    if (!isVoiceMode || !currentPrompt) {
      return;
    }

    queueSpeech(currentPrompt);
  }, [currentPrompt, isVoiceMode]);

  useEffect(() => {
    return () => {
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
      if (speechTimerRef.current) {
        window.clearTimeout(speechTimerRef.current);
      }
      if (silenceTimerRef.current) {
        window.clearTimeout(silenceTimerRef.current);
      }
      recognitionRef.current?.stop?.();
    };
  }, []);

  async function startAiRevisionSession(topicsInput = uploadedTopics, studyMaterialInput = studyMaterial) {
    setCallActive(true);
    setIsSubmitting(true);

    try {
      const data = await studyPlanApi.startVoiceRevision({
        learnerName,
        studyMaterial: studyMaterialInput,
        topics: topicsInput,
        questionIndex: 0,
        askedTopics: []
      });
      const intro = cleanTopic(data.intro);
      const questionText = cleanTopic(data.question);
      const spokenOpening = cleanTopic(`${intro ? `${intro} ` : ""}OK, let's start the revision. ${questionText}`);
      const nextQuestion = {
        topic: data.topic,
        question: questionText,
        expectedPoints: Array.isArray(data.expectedPoints) ? data.expectedPoints : []
      };

      setQuestionIndex(0);
      setCurrentQuestion(nextQuestion);
      setAskedTopics(nextQuestion?.topic ? [nextQuestion.topic] : []);
      setAnswerHistory([]);
      setFeedback(null);
      setSessionStage(questionText ? "question" : "await-upload");
      setCurrentPrompt(spokenOpening || questionText);
      if (data.warning) {
        setUploadStatus(data.warning);
      }
    } catch (error) {
      setCallActive(false);
      setSessionStage("await-upload");
      setCurrentQuestion(null);
      setCurrentPrompt("I could not start the AI voice revision right now. Please try again.");
      setUploadStatus(error.message || "Unable to start voice revision.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function beginVoiceRevision() {
    setFeedback(null);
    setAnswerDraft("");

    if (!uploadedTopics.length) {
      const greeting = `Hi ${learnerName}. Welcome back to Lakshya. Let's start the revision. First of all, upload your study file using the button below, and once it is uploaded, click Start Voice Revision again.`;
      setSessionStage("await-upload");
      setCallActive(false);
      setIsVoiceMode(true);
      setCurrentPrompt(greeting);
      return;
    }

    setIsVoiceMode(true);
    await startAiRevisionSession();
  }

  async function submitAnswer(answerOverride) {
    const answer = cleanTopic(answerOverride || answerDraft);
    if (!answer) {
      return;
    }

    if (sessionStage !== "question" || !currentQuestion) {
      return;
    }

    if (isRepeatRequest(answer)) {
      const repeatReply = `OK, so I asked: ${currentQuestion.question}`;
      setCurrentPrompt(repeatReply);
      setAnswerDraft("");
      transcriptRef.current = "";
      queueSpeech(repeatReply, 250);
      return;
    }

    if (isIDontKnowReply(answer)) {
      const explainReply = `No problem. I will tell you the answer. ${currentQuestion.expectedPoints?.join(". ")}. ${currentQuestion.question}`;
      setCurrentPrompt(explainReply);
      setAnswerDraft("");
      transcriptRef.current = "";
      queueSpeech(explainReply, 250);
      return;
    }

    setIsSubmitting(true);

    try {
      const data = await studyPlanApi.evaluateVoiceRevision({
        learnerName,
        answer,
        studyMaterial,
        topics: uploadedTopics,
        currentQuestion,
        questionIndex,
        askedTopics,
        previousAnswers: answerHistory
      });
      const nextFeedback = {
        heading: data.evaluation?.heading || "Partly right",
        verdict: data.evaluation?.verdict || "Keep going",
        detail: data.evaluation?.feedback || "Refine your answer with more topic-specific points.",
        tone: toneFromHeading(data.evaluation?.heading)
      };
      const nextQuestion = data.nextQuestion
        ? {
            topic: data.nextQuestion.topic,
            question: cleanTopic(data.nextQuestion.question),
            expectedPoints: Array.isArray(data.nextQuestion.expectedPoints) ? data.nextQuestion.expectedPoints : []
          }
        : null;
      const nextPrompt = cleanTopic(
        data.coachReply ||
          (nextQuestion
            ? `${nextFeedback.heading}. ${nextFeedback.detail} Next question. ${nextQuestion.question}`
            : `Nice work, ${learnerName}. ${nextFeedback.detail} Revision round complete.`)
      );

      setFeedback(nextFeedback);
      setAnswerDraft("");
      transcriptRef.current = "";
      setAnswerHistory((current) => [
        ...current,
        {
          questionTopic: currentQuestion.topic,
          question: currentQuestion.question,
          answer,
          feedback: nextFeedback.heading
        }
      ]);

      if (nextQuestion && !data.isComplete) {
        setQuestionIndex((current) => current + 1);
        setCurrentQuestion(nextQuestion);
        setAskedTopics((current) => (nextQuestion.topic ? [...current, nextQuestion.topic] : current));
        setSessionStage("question");
        setCurrentPrompt(nextPrompt);
        queueSpeech(nextPrompt, 700);
      } else {
        const roundHeadings = [...answerHistory.map((entry) => entry.feedback), nextFeedback.heading];
        trackStudyEvent({
          feature: "coach",
          type: "score",
          score: roundHeadings.reduce((sum, heading) => sum + scoreFromHeading(heading), 0) / roundHeadings.length,
          label: `Voice revision round (${roundHeadings.length} questions)`
        });
        setCurrentQuestion(null);
        setSessionStage("complete");
        setCurrentPrompt(nextPrompt);
        queueSpeech(nextPrompt, 700);
      }

      if (data.warning) {
        setUploadStatus(data.warning);
      }
    } catch (error) {
      setUploadStatus(error.message || "Unable to evaluate your answer right now.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function toggleListening() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setUploadStatus("Voice capture is not available in this browser. You can still type your answers.");
      return;
    }

    if (isListening) {
      if (silenceTimerRef.current) {
        window.clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      recognitionRef.current?.stop?.();
      setIsListening(false);
      return;
    }

    transcriptRef.current = "";
    confidenceRef.current = 0;
    shouldAutoSubmitRef.current = true;
    const recognition = new SpeechRecognition();
    recognition.lang = "en-IN";
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.maxAlternatives = 5;

    const queueAutoStop = () => {
      if (silenceTimerRef.current) {
        window.clearTimeout(silenceTimerRef.current);
      }

      silenceTimerRef.current = window.setTimeout(() => {
        recognitionRef.current?.stop?.();
      }, 4500);
    };

    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript || "")
        .join(" ");
      const confidences = Array.from(event.results)
        .map((result) => result[0]?.confidence || 0)
        .filter((value) => Number.isFinite(value) && value > 0);

      if (confidences.length) {
        confidenceRef.current = Math.max(confidenceRef.current, ...confidences);
      }

      transcriptRef.current = transcript.trim();
      setAnswerDraft(transcript.trim());
      queueAutoStop();
    };
    recognition.onend = () => {
      if (silenceTimerRef.current) {
        window.clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      setIsListening(false);
      const finalTranscript = cleanTopic(transcriptRef.current);
      const finalConfidence = confidenceRef.current;
      confidenceRef.current = 0;

      if (shouldAutoSubmitRef.current && shouldRetryTranscript(finalTranscript, finalConfidence)) {
        setCurrentPrompt("I did not catch that clearly. Please say your answer once more, a little slower and in one full sentence.");
        return;
      }

      if (shouldAutoSubmitRef.current && finalTranscript) {
        submitAnswer(finalTranscript);
      }
    };
    recognition.onerror = () => {
      if (silenceTimerRef.current) {
        window.clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      setIsListening(false);
    };
    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }

  async function uploadQuestionFile(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setUploading(true);
    setUploadStatus("");

    try {
      const formData = new FormData();
      formData.append("file", file);
      const data = await studyPlanApi.fromPdf(formData);
      const parsedTopics = normalizeRevisionItems(data.revisionItems).length
        ? normalizeRevisionItems(data.revisionItems)
        : parseUploadedTopics(data.topicsText);
      setUploadedTopics(parsedTopics);
      setStudyMaterial(String(data.extractedText || ""));
      setUploadedFileName(file.name);
      setSessionStage(parsedTopics.length ? "ready" : "await-upload");
      setCurrentPrompt("");
      setFeedback(null);
      setAnswerDraft("");
      transcriptRef.current = "";
      setQuestionIndex(0);
      setCurrentQuestion(null);
      setAskedTopics([]);
      setAnswerHistory([]);
      setUploadStatus(
        parsedTopics.length
          ? `${file.name} uploaded and analyzed. Click Start Voice Revision to begin your questions.`
          : `${file.name} uploaded, but Lakshya could not extract enough revision topics. Try another PDF.`
      );

      if (isVoiceMode && parsedTopics.length) {
        await startAiRevisionSession(parsedTopics, String(data.extractedText || ""));
      }
    } catch (error) {
      setUploadStatus(error.message || "Unable to process the uploaded PDF.");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  function closeVoiceCall() {
    setCallActive(false);
    setIsVoiceMode(false);
    setIsListening(false);
    shouldAutoSubmitRef.current = false;
    if (silenceTimerRef.current) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (speechTimerRef.current) {
      window.clearTimeout(speechTimerRef.current);
      speechTimerRef.current = null;
    }
    recognitionRef.current?.stop?.();
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }

  const callHeadline =
    sessionStage === "await-upload"
      ? "Waiting for your study PDF"
      : sessionStage === "complete"
        ? "Revision complete"
        : isListening
          ? "Lakshya is listening"
          : isSubmitting
            ? "Lakshya is checking your answer"
            : "Lakshya AI voice coach";

  const voiceLaunchActive = isVoiceMode || callActive || isSubmitting || sessionStage !== "idle";
  const voiceButtonLabel =
    isSubmitting && sessionStage !== "question"
      ? "Starting voice revision"
      : voiceLaunchActive
        ? "Voice revision ready"
        : "Start voice revision";
  const callBody =
    sessionStage === "question"
      ? currentQuestion?.question || "Lakshya is preparing the next question."
      : currentPrompt || "Upload your study file to begin the revision call.";

  return (
    <div className="screen">
      <div className="screen-header">
        <div>
          <h1>Last-Minute Strategy & Voice Coach</h1>
          <p>When the exam is tomorrow, Lakshya compresses your syllabus into an hourly execution roadmap.</p>
        </div>
      </div>

      <section className="panel coach-launch-panel">
        <span className="coach-launch-kicker">Voice revision</span>
        <h2>Start your oral revision with Lakshya AI</h2>
        <p>{FIRST_USE_SUMMARY}</p>
        <div className="voice-callout coach-launch-callout">
          <Mic size={18} />
          <span>"{FIRST_USE_PROMPT}"</span>
        </div>
        <div className="coach-launch-actions">
          <button
            className={`coach-voice-button ${voiceLaunchActive ? "is-active" : ""}`}
            type="button"
            onClick={() => { setIsVoiceMode(true); beginVoiceRevision(); }}
            disabled={uploading || isSubmitting}
            aria-pressed={voiceLaunchActive}
            aria-label={voiceButtonLabel}
            title={voiceButtonLabel}
          >
            <span className="coach-voice-button-ring" aria-hidden="true" />
            <span className="coach-voice-button-icon" aria-hidden="true">
              {voiceLaunchActive ? <Mic size={34} /> : <MicOff size={34} />}
            </span>
          </button>
        </div>
        <div className="coach-launch-upload">
          <label className="upload-panel coach-upload-drop coach-upload-drop-inline">
            <div className="upload-icon">
              <FileText size={32} />
            </div>
            <h3>{uploading ? "Uploading..." : "Upload revision PDF"}</h3>
            <p>Upload a PDF with questions or topic lists. Lakshya will use it for oral revision prompts.</p>
            <input type="file" accept="application/pdf" onChange={uploadQuestionFile} hidden />
          </label>
          {uploadStatus ? <div className="success-banner coach-upload-status">{uploadStatus}</div> : null}
        </div>
      </section>

      {callActive ? (
        <div className="call-screen-overlay">
          <div className="call-screen voice-call-screen">
            <div className="call-screen-topbar">
              <div>
                <span className="call-screen-label">Voice call</span>
                <h3>Lakshya AI Revision Call</h3>
                <p>{sessionStage === "question" ? "AI is asking questions from your uploaded PDF." : "Lakshya is guiding your revision."}</p>
              </div>
              <button className="icon-action" type="button" onClick={closeVoiceCall} aria-label="Close voice call">
                <X size={18} />
              </button>
            </div>

            <div className="call-screen-stage">
              <div className="call-screen-main">
                <div className="call-screen-voice-panel">
                  <div className="audio-wave">
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>
                  <strong>{callHeadline}</strong>
                  <p>{callBody}</p>
                </div>
              </div>

              <aside className="call-screen-sidebar">
                <div className="call-mini-stat">
                  <span>Study file</span>
                  <strong>{uploadedFileName || "Waiting for upload"}</strong>
                </div>
                <div className="call-mini-stat">
                  <span>Question</span>
                  <strong>{currentQuestion ? `${questionIndex + 1} of ${Math.max(uploadedTopics.length, questionIndex + 1)}` : "Not started"}</strong>
                </div>
                <div className="call-mini-stat">
                  <span>Feedback</span>
                  <strong>{feedback ? `${feedback.heading} - ${feedback.verdict}` : "Waiting for first answer"}</strong>
                </div>
                <div className="call-mini-stat">
                  <span>Status</span>
                  <strong>{isListening ? "Listening now" : isSubmitting ? "AI thinking" : sessionStage === "complete" ? "Call complete" : "Connected"}</strong>
                </div>
              </aside>
            </div>

            <div className="call-screen-controls">
              <button
                className={`call-control ${isListening ? "active" : ""}`}
                type="button"
                onClick={toggleListening}
                disabled={sessionStage !== "question" || isSubmitting}
              >
                {isListening ? <MicOff size={18} /> : <Mic size={18} />}
                <span>{isListening ? "Stop answer" : "Answer by voice"}</span>
              </button>
              <button className="call-control end-call" type="button" onClick={closeVoiceCall}>
                <PhoneOff size={18} />
                <span>End call</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default CoachPage;
