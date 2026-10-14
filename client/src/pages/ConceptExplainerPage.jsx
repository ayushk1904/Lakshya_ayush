import { ExternalLink, FileQuestion, FileText, PlayCircle, RotateCcw, Send, Sparkles, Trash2, Trophy, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import mermaid from "mermaid";
import { conceptExplainerApi, getConceptExplainerAssetBaseUrl, trackStudyEvent } from "../api/client";

function normalizeDiagramText(text) {
  const value = String(text || "").trim();

  if (!value) {
    return "";
  }

  const fencedMatch = value.match(/^```(?:mermaid)?\s*([\s\S]*?)\s*```$/i);
  if (fencedMatch) {
    return fencedMatch[1].trim();
  }

  return value;
}

function looksLikeMermaidDiagram(text) {
  const value = normalizeDiagramText(text);

  if (!value) {
    return false;
  }

  // Always return true if there's any content — let mermaid try to render it
  // If it fails, the error handler will show raw code instead
  return true;
}

function calculateQuizScore(quiz, answers) {
  const questions = quiz?.questions || [];

  return questions.reduce((score, question) => {
    return answers[question.id] === question.answerIndex ? score + 1 : score;
  }, 0);
}

function ConceptExplainerPage() {
  const conceptExplainerAssetBaseUrl = getConceptExplainerAssetBaseUrl();
  const [documents, setDocuments] = useState([]);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState([]);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [easyExplanation, setEasyExplanation] = useState("");
  const [videos, setVideos] = useState([]);
  const [status, setStatus] = useState("");
  const [uploading, setUploading] = useState(false);
  const [asking, setAsking] = useState(false);
  const [startingGame, setStartingGame] = useState(false);
  const [diagram, setDiagram] = useState(null);
  const [diagramSvg, setDiagramSvg] = useState("");
  const [diagramError, setDiagramError] = useState(false);
  const [images, setImages] = useState([]);
  const [quiz, setQuiz] = useState(null);
  const [quizAnswers, setQuizAnswers] = useState({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [quizQuestionCount, setQuizQuestionCount] = useState(5);
  const mermaidIdRef = useRef(0);

  useEffect(() => {
    mermaid.initialize({ startOnLoad: false, theme: "default" });
  }, []);

  useEffect(() => {
    let isCancelled = false;

    async function renderDiagram() {
      if (!diagram) {
        setDiagramSvg("");
        setDiagramError(false);
        return;
      }

      const normalizedDiagram = normalizeDiagramText(diagram);

      if (!looksLikeMermaidDiagram(normalizedDiagram)) {
        setDiagramSvg("");
        setDiagramError(true);
        return;
      }

      try {
        mermaidIdRef.current += 1;
        const renderId = `concept-explainer-diagram-${mermaidIdRef.current}`;
        const { svg } = await mermaid.render(renderId, normalizedDiagram);

        if (!isCancelled) {
          setDiagramSvg(svg);
          setDiagramError(false);
        }
      } catch (_error) {
        if (!isCancelled) {
          setDiagramSvg("");
          setDiagramError(true);
        }
      }
    }

    renderDiagram();

    return () => {
      isCancelled = true;
    };
  }, [diagram]);

  useEffect(() => {
    conceptExplainerApi
      .listDocuments()
      .then((data) => {
        setDocuments(data.documents || []);
        setSelectedDocumentIds((data.documents || []).map((document) => document._id));
        if (data.hiddenLegacyCount) {
          setStatus(
            `${data.hiddenLegacyCount} older shared PDF${data.hiddenLegacyCount > 1 ? "s were" : " was"} hidden from Concept Explainer during cleanup.`
          );
        }
      })
      .catch((error) => {
        setStatus(error.message || "Unable to connect to the concept explainer right now.");
      });
  }, []);

  async function uploadDocument(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setUploading(true);
    setStatus("");

    try {
      const data = await conceptExplainerApi.uploadDocument(file);
      setDocuments((current) => {
        const nextDocuments = current.filter(
          (document) => String(document.fileName || "").trim().toLowerCase() !== String(data.document.fileName || "").trim().toLowerCase()
        );

        return [data.document, ...nextDocuments];
      });
      setSelectedDocumentIds((current) => Array.from(new Set([data.document._id, ...current.filter(Boolean)])));
      setStatus(data.warning || `${data.document.fileName} uploaded and ready for explanations.`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  function toggleDocument(documentId) {
    setSelectedDocumentIds((current) =>
      current.includes(documentId) ? current.filter((id) => id !== documentId) : [...current, documentId]
    );
  }

  async function removeDocument(document) {
    try {
      setStatus("");
      await conceptExplainerApi.deleteDocument(document);
      setDocuments((current) => current.filter((item) => item._id !== document._id));
      setSelectedDocumentIds((current) => current.filter((id) => id !== document._id));
      setStatus("Document removed.");
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function askQuestion() {
    if (!question.trim()) {
      return;
    }

    setAsking(true);
    setStatus("");
    setEasyExplanation("");
    setVideos([]);

    try {
      const data = await conceptExplainerApi.askQuestion({
        question,
        documentIds: selectedDocumentIds
      });
      setAnswer(data.answer);
      setEasyExplanation(data.easyExplanation || "");
      setDiagram(data.diagram || null);
      setImages(data.images || []);
      setVideos(data.videos || []);
      setStatus(data.warning || "");
      trackStudyEvent({ feature: "explainer", label: `Asked: ${question.trim()}` });
    } catch (error) {
      setAnswer("");
      setEasyExplanation("");
      setDiagram(null);
      setImages([]);
      setVideos([]);
      setStatus(error.message);
    } finally {
      setAsking(false);
    }
  }

  async function startQuizGame() {
    if (!documents.length) {
      setStatus("Upload a study PDF first, then Lakshya can turn it into a quiz game.");
      return;
    }

    setStartingGame(true);
    setStatus("");

    try {
      const data = await conceptExplainerApi.startGame({
        questionCount: quizQuestionCount,
        documentIds: selectedDocumentIds
      });
      setQuiz(data.quiz);
      setQuizAnswers({});
      setQuizSubmitted(false);
      setStatus(data.warning || "PDF quiz challenge is ready.");
    } catch (error) {
      setQuiz(null);
      setQuizAnswers({});
      setQuizSubmitted(false);
      setStatus(error.message);
    } finally {
      setStartingGame(false);
    }
  }

  function selectQuizAnswer(questionId, optionIndex) {
    if (quizSubmitted) {
      return;
    }

    setQuizAnswers((current) => ({
      ...current,
      [questionId]: optionIndex
    }));
  }

  function submitQuizGame() {
    if (!quiz?.questions?.length || quizSubmitted) {
      return;
    }

    setQuizSubmitted(true);
    trackStudyEvent({
      feature: "explainer",
      type: "score",
      score: (calculateQuizScore(quiz, quizAnswers) / quiz.questions.length) * 100,
      label: quiz.title || "PDF quiz challenge"
    });
  }

  const quizQuestions = quiz?.questions || [];
  const answeredQuizCount = quizQuestions.filter((question) => typeof quizAnswers[question.id] === "number").length;
  const quizScore = calculateQuizScore(quiz, quizAnswers);

  return (
    <div className="screen chat-screen">
      <div className="screen-header compact-header">
        <div>
          <h1>AI Concept Explainer</h1>
          <p>Upload study documents and get clear explanations from your own notes.</p>
        </div>
      </div>
      <section className="explainer-body">
        <div className="explainer-grid">
          <aside className="explainer-sidebar">
            <label className="upload-panel explainer-upload-card">
              <div className="upload-icon">
                <Upload size={32} />
              </div>
              <h3>{uploading ? "Uploading..." : "Upload study document"}</h3>
              <p>PDF and text files are supported. The AI will study the document after upload.</p>
              <input type="file" accept=".pdf,.txt,text/plain,application/pdf" onChange={uploadDocument} hidden />
            </label>

            <div className="explainer-documents">
              <div className="panel-title">
                <FileText size={18} />
                <h3>Study documents</h3>
              </div>
              {documents.length ? (
                <div className="explainer-document-list">
                  {documents.map((document) => (
                    <article
                      className={`explainer-document-card ${selectedDocumentIds.includes(document._id) ? "active" : ""}`}
                      key={document._id}
                    >
                      <button className="explainer-document-main" type="button" onClick={() => toggleDocument(document._id)}>
                        <strong>{document.fileName}</strong>
                        <span>
                          {document.mimeType === "application/pdf" ? "PDF uploaded" : "Text document uploaded"}
                        </span>
                      </button>
                      <button
                        aria-label={`Remove ${document.fileName}`}
                        className="explainer-document-remove"
                        type="button"
                        onClick={() => removeDocument(document)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="muted-copy">No documents uploaded yet.</p>
              )}
            </div>

            <section className="explainer-support-panel explainer-game-launch">
              <div className="panel-title">
                <FileQuestion size={18} />
                <h3>PDF Quiz Game</h3>
              </div>
              <p>Turn the selected study PDF into a quick challenge with score, answers, and revision notes.</p>
              <div className="explainer-game-chip-row">
                {[3, 5, 8].map((count) => (
                  <button
                    key={count}
                    className={`chip ${quizQuestionCount === count ? "explainer-game-chip-active" : ""}`}
                    type="button"
                    onClick={() => setQuizQuestionCount(count)}
                  >
                    {count} questions
                  </button>
                ))}
              </div>
              <button className="primary-button" type="button" onClick={startQuizGame} disabled={startingGame || !documents.length}>
                {startingGame ? "Building quiz..." : "Start quiz game"}
              </button>
            </section>
          </aside>

          <div className="explainer-main">
            {!answer && !quiz ? (
              <div className="ask-center">
                <div className="upload-icon">
                  <Sparkles size={38} />
                </div>
                <h2>Ask me anything!</h2>
                <p>Try: "Explain inflation in simple terms"</p>
                <div className="chip-row">
                  <button className="chip" type="button" onClick={() => setQuestion("What is Inflation?")}>
                    What is Inflation?
                  </button>
                  <button className="chip" type="button" onClick={() => setQuestion("Explain Newton's 3rd Law")}>
                    Explain Newton&apos;s 3rd Law
                  </button>
                  <button className="chip" type="button" onClick={() => setQuestion("What is DNA replication?")}>
                    What is DNA replication?
                  </button>
                </div>
              </div>
            ) : (
              <div className="explainer-answer">
                {quiz ? (
                  <section className="explainer-support-panel explainer-quiz-panel">
                    <div className="explainer-quiz-header">
                      <div>
                        <div className="panel-title">
                          <Trophy size={18} />
                          <h3>{quiz.title || "PDF Quiz Challenge"}</h3>
                        </div>
                        <p>
                          {quizSubmitted
                            ? `Score: ${quizScore}/${quizQuestions.length}`
                            : `${answeredQuizCount}/${quizQuestions.length} answered`}
                        </p>
                      </div>
                      <button className="secondary-button" type="button" onClick={startQuizGame} disabled={startingGame}>
                        <RotateCcw size={16} />
                        {startingGame ? "Refreshing..." : "New quiz"}
                      </button>
                    </div>

                    <div className="explainer-quiz-list">
                      {quizQuestions.map((quizQuestion, questionIndex) => {
                        const selectedAnswerIndex = quizAnswers[quizQuestion.id];
                        const isAnswered = typeof selectedAnswerIndex === "number";

                        return (
                          <article className="explainer-quiz-card" key={quizQuestion.id}>
                            <div className="explainer-quiz-card-top">
                              <span className="explainer-quiz-number">Q{questionIndex + 1}</span>
                              <span className="explainer-quiz-source">{quizQuestion.sourceLabel}</span>
                            </div>
                            <h4>{quizQuestion.prompt}</h4>
                            <div className="explainer-quiz-options">
                              {quizQuestion.options.map((option, optionIndex) => {
                                const isCorrect = quizSubmitted && optionIndex === quizQuestion.answerIndex;
                                const isWrongPick = quizSubmitted && selectedAnswerIndex === optionIndex && optionIndex !== quizQuestion.answerIndex;

                                return (
                                  <button
                                    key={`${quizQuestion.id}-${optionIndex}`}
                                    className={`explainer-quiz-option ${
                                      selectedAnswerIndex === optionIndex ? "selected" : ""
                                    } ${isCorrect ? "correct" : ""} ${isWrongPick ? "wrong" : ""}`}
                                    type="button"
                                    onClick={() => selectQuizAnswer(quizQuestion.id, optionIndex)}
                                  >
                                    <span>{String.fromCharCode(65 + optionIndex)}</span>
                                    <strong>{option}</strong>
                                  </button>
                                );
                              })}
                            </div>
                            {quizSubmitted ? (
                              <div className="explainer-quiz-feedback">
                                <strong>{selectedAnswerIndex === quizQuestion.answerIndex ? "Correct" : "Review this one"}</strong>
                                <p>{quizQuestion.explanation}</p>
                              </div>
                            ) : !isAnswered ? (
                              <p className="muted-copy">Choose one answer to continue.</p>
                            ) : null}
                          </article>
                        );
                      })}
                    </div>

                    <div className="explainer-quiz-actions">
                      <button
                        className="primary-button"
                        type="button"
                        onClick={submitQuizGame}
                        disabled={!quizQuestions.length || answeredQuizCount !== quizQuestions.length || quizSubmitted}
                      >
                        {quizSubmitted ? "Quiz submitted" : "Check my score"}
                      </button>
                    </div>
                  </section>
                ) : null}

                {answer ? (
                  <div className="explainer-markdown">
                    <ReactMarkdown>{answer}</ReactMarkdown>
                  </div>
                ) : null}

                {answer && diagram ? (
                  <div className="explainer-diagram">
                    <h3>Diagram</h3>
                    {diagramSvg && !diagramError ? (
                      <div className="mermaid-container" dangerouslySetInnerHTML={{ __html: diagramSvg }} />
                    ) : (
                      <pre className="mermaid-container">
                        <code>{normalizeDiagramText(diagram)}</code>
                      </pre>
                    )}
                  </div>
                ) : null}

                {answer && images.length > 0 && (
                  <div className="explainer-diagram">
                    <h3>📊 Diagram from your PDF</h3>
                    {images.map((img, index) => (
                      <img
                        key={index}
                        src={`${conceptExplainerAssetBaseUrl}/images/${encodeURIComponent(img)}`}
                        alt={`Diagram ${index + 1}`}
                        style={{ maxWidth: "100%", borderRadius: "8px", marginTop: "12px" }}
                      />
                    ))}
                  </div>
                )}

                {answer && easyExplanation ? (
                  <section className="explainer-support-panel">
                    <div className="panel-title">
                      <Sparkles size={18} />
                      <h3>Easy explanation</h3>
                    </div>
                    <div className="explainer-markdown explainer-markdown-secondary">
                      <ReactMarkdown>{easyExplanation}</ReactMarkdown>
                    </div>
                  </section>
                ) : null}

                {answer && videos.length ? (
                  <section className="explainer-videos-panel">
                    <div className="panel-title">
                      <PlayCircle size={18} />
                      <h3>Related videos</h3>
                    </div>
                    <div className="explainer-video-grid">
                      {videos.map((video) => (
                        <article className="explainer-video-card" key={video.id}>
                          <a
                            className="explainer-video-thumb"
                            href={video.url}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`Open ${video.title} on YouTube`}
                          >
                            {video.thumbnail ? <img src={video.thumbnail} alt={video.title} /> : <div className="explainer-video-thumb-fallback" />}
                            <span className="explainer-video-badge">
                              <PlayCircle size={16} />
                              Watch
                            </span>
                          </a>
                          <div className="explainer-video-copy">
                            <strong>{video.title}</strong>
                            <span>{video.channelTitle}</span>
                            <a href={video.url} target="_blank" rel="noreferrer">
                              Open on YouTube
                              <ExternalLink size={14} />
                            </a>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                ) : null}
              </div>
            )}
            {status ? <div className="planner-status explainer-status">{status}</div> : null}
          </div>
        </div>
        <div className="chat-input-row">
          <input value={question} onChange={(e) => setQuestion(e.target.value)} type="text" placeholder="Ask a question about your uploaded study material..." />
          <button className="send-button" type="button" onClick={askQuestion} disabled={asking}>
            <Send size={18} />
          </button>
        </div>
      </section>
    </div>
  );
}

export default ConceptExplainerPage;
