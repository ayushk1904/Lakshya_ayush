import { Upload } from "lucide-react";

function AnswerEvaluatorPage() {
  return (
    <div className="screen narrow">
      <div className="screen-header">
        <div>
          <h1>Answer Evaluation</h1>
          <p>Upload your handwritten answer and get AI feedback.</p>
        </div>
      </div>
      <section className="upload-panel large-center">
        <div className="upload-icon">
          <Upload size={44} />
        </div>
        <h2>Upload Answer Photo</h2>
        <p>OCR, topper benchmarking, keyword gaps, and a rewrite-ready ideal answer in one flow.</p>
        <button className="primary-button">
          <Upload size={16} />
          Upload & Evaluate
        </button>
      </section>
    </div>
  );
}

export default AnswerEvaluatorPage;
