import { Award, CheckCircle2, FileUp, Sparkles, Target, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { answerEvaluatorApi, trackStudyEvent } from "../api/client";

function AnswerEvaluatorPage() {
  const studentInputRef = useRef(null);
  const topperInputRef = useRef(null);
  const [studentFile, setStudentFile] = useState(null);
  const [topperFile, setTopperFile] = useState(null);
  const [evaluation, setEvaluation] = useState(null);
  const [status, setStatus] = useState("");
  const [evaluating, setEvaluating] = useState(false);

  function handleStudentFileChange(event) {
    const file = event.target.files?.[0] || null;
    setStudentFile(file);
  }

  function handleTopperFileChange(event) {
    const file = event.target.files?.[0] || null;
    setTopperFile(file);
  }

  async function evaluateAnswers() {
    if (!studentFile || !topperFile) {
      setStatus("Please upload both your solution and the topper's solution.");
      return;
    }

    setEvaluating(true);
    setStatus("");

    try {
      const formData = new FormData();
      formData.append("studentSolution", studentFile);
      formData.append("topperSolution", topperFile);

      const data = await answerEvaluatorApi.evaluate(formData);
      setEvaluation(data.evaluation || null);
      setStatus(data.warning || "");

      if (Number.isFinite(Number(data.evaluation?.marks))) {
        trackStudyEvent({ feature: "evaluator", type: "score", score: Number(data.evaluation.marks), label: `Answer evaluation: ${studentFile.name}` });
      }
    } catch (error) {
      setEvaluation(null);
      setStatus(error.message);
    } finally {
      setEvaluating(false);
    }
  }

  return (
    <div className="screen narrow">
      <div className="screen-header">
        <div>
          <h1>Answer Evaluator</h1>
          <p>Upload your solution and a topper's solution to compare coverage, receive marks, and see where you can improve.</p>
        </div>
      </div>

      <section className="panel evaluator-shell">
        <div className="evaluator-upload-grid">
          <article className="evaluator-upload-card">
            <div className="upload-icon">
              <FileUp size={34} />
            </div>
            <h2>Upload Your Solution</h2>
            <p>Use a PDF or text file containing your own answer.</p>
            <button className="primary-button" type="button" onClick={() => studentInputRef.current?.click()}>
              <Upload size={16} />
              {studentFile ? "Change Your Solution" : "Choose Your Solution"}
            </button>
            <input
              ref={studentInputRef}
              type="file"
              accept=".pdf,.txt,text/plain,application/pdf"
              hidden
              onChange={handleStudentFileChange}
            />
            <span className="evaluator-file-name">{studentFile ? studentFile.name : "No file selected yet."}</span>
          </article>

          <article className="evaluator-upload-card">
            <div className="upload-icon">
              <Award size={34} />
            </div>
            <h2>Upload Topper's Solution</h2>
            <p>Use a PDF or text file of a strong/topper answer for comparison.</p>
            <button className="secondary-button" type="button" onClick={() => topperInputRef.current?.click()}>
              <Upload size={16} />
              {topperFile ? "Change Topper Solution" : "Choose Topper Solution"}
            </button>
            <input
              ref={topperInputRef}
              type="file"
              accept=".pdf,.txt,text/plain,application/pdf"
              hidden
              onChange={handleTopperFileChange}
            />
            <span className="evaluator-file-name">{topperFile ? topperFile.name : "No file selected yet."}</span>
          </article>
        </div>

        <div className="button-row evaluator-actions">
          <button className="primary-button" type="button" onClick={evaluateAnswers} disabled={evaluating}>
            <Sparkles size={16} />
            {evaluating ? "Evaluating..." : "Evaluate Answers"}
          </button>
          <span className="subtle">Lakshya compares concept coverage, structure, completeness, and clarity against the topper's answer.</span>
        </div>

        {status ? <div className="planner-status">{status}</div> : null}
      </section>

      {evaluation ? (
        <section className="evaluator-results">
          <article className="panel evaluator-score-panel">
            <div className="evaluator-score-copy">
              <span className="sidebar-kicker">Evaluation Result</span>
              <strong>{evaluation.verdict || "Answer checked"}</strong>
              <p>{evaluation.summary}</p>
            </div>
            <div className="evaluator-score-badge">
              <span>Marks</span>
              <strong>{evaluation.marks ?? "--"}/100</strong>
            </div>
          </article>

          <div className="evaluator-results-grid">
            <article className="panel evaluator-result-card">
              <div className="panel-title">
                <CheckCircle2 size={18} />
                <h2>What You Did Well</h2>
              </div>
              <div className="signal-list">
                {(evaluation.strengths || []).length ? (
                  evaluation.strengths.map((item, index) => <p key={`${item}-${index}`}>{item}</p>)
                ) : (
                  <p>Strong points will appear here after evaluation.</p>
                )}
              </div>
            </article>

            <article className="panel evaluator-result-card">
              <div className="panel-title">
                <Target size={18} />
                <h2>Where To Improve</h2>
              </div>
              <div className="signal-list">
                {(evaluation.improvements || []).length ? (
                  evaluation.improvements.map((item, index) => <p key={`${item}-${index}`}>{item}</p>)
                ) : (
                  <p>Improvement suggestions will appear here after evaluation.</p>
                )}
              </div>
            </article>
          </div>

          <div className="evaluator-results-grid">
            <article className="panel evaluator-result-card">
              <div className="panel-title">
                <Sparkles size={18} />
                <h2>Feedback</h2>
              </div>
              <div className="signal-list">
                {(evaluation.feedback || []).map((item, index) => (
                  <p key={`${item}-${index}`}>{item}</p>
                ))}
              </div>
            </article>

            <article className="panel evaluator-result-card">
              <div className="panel-title">
                <Award size={18} />
                <h2>Concept Comparison</h2>
              </div>
              <div className="evaluator-concept-groups">
                <div>
                  <strong>Matched concepts</strong>
                  <div className="chip-row evaluator-chip-row">
                    {(evaluation.matchedConcepts || []).length ? (
                      evaluation.matchedConcepts.map((item, index) => (
                        <span className="chip" key={`${item}-${index}`}>
                          {item}
                        </span>
                      ))
                    ) : (
                      <span className="subtle">No matched concepts available.</span>
                    )}
                  </div>
                </div>
                <div>
                  <strong>Missing concepts</strong>
                  <div className="chip-row evaluator-chip-row">
                    {(evaluation.missingConcepts || []).length ? (
                      evaluation.missingConcepts.map((item, index) => (
                        <span className="chip" key={`${item}-${index}`}>
                          {item}
                        </span>
                      ))
                    ) : (
                      <span className="subtle">No missing concepts detected.</span>
                    )}
                  </div>
                </div>
              </div>
            </article>
          </div>
        </section>
      ) : null}
    </div>
  );
}

export default AnswerEvaluatorPage;
