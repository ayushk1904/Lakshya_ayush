import { FileText, Send, Sparkles, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { conceptExplainerApi } from "../api/client";

function ConceptExplainerPage() {
  const [documents, setDocuments] = useState([]);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState([]);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [status, setStatus] = useState("");
  const [uploading, setUploading] = useState(false);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    conceptExplainerApi
      .listDocuments()
      .then((data) => {
        setDocuments(data.documents || []);
        setSelectedDocumentIds((data.documents || []).map((document) => document._id));
      })
      .catch(() => {});
  }, []);

  async function uploadDocument(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setUploading(true);
    setStatus("");

    try {
      const formData = new FormData();
      formData.append("file", file);
      const data = await conceptExplainerApi.uploadDocument(formData);
      setDocuments((current) => [data.document, ...current]);
      setSelectedDocumentIds((current) => [data.document._id, ...current]);
      setStatus(`${data.document.fileName} uploaded and ready for explanations.`);
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

  async function askQuestion() {
    if (!question.trim()) {
      return;
    }

    setAsking(true);
    setStatus("");

    try {
      const data = await conceptExplainerApi.askQuestion({
        question,
        documentIds: selectedDocumentIds
      });
      setAnswer(data.answer);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setAsking(false);
    }
  }

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
                    <button
                      className={`explainer-document-card ${selectedDocumentIds.includes(document._id) ? "active" : ""}`}
                      key={document._id}
                      type="button"
                      onClick={() => toggleDocument(document._id)}
                    >
                      <strong>{document.fileName}</strong>
                      <span>{document.summary || "Ready to use for topic explanations."}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="muted-copy">No documents uploaded yet.</p>
              )}
            </div>
          </aside>

          <div className="explainer-main">
            {!answer ? (
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
                    Explain Newton's 3rd Law
                  </button>
                  <button className="chip" type="button" onClick={() => setQuestion("What is DNA replication?")}>
                    What is DNA replication?
                  </button>
                </div>
              </div>
            ) : (
              <div className="explainer-answer">
                <div className="panel-title">
                  <Sparkles size={18} />
                  <h3>AI explanation</h3>
                </div>
                <div className="explainer-markdown">
                  <ReactMarkdown>{answer}</ReactMarkdown>
                </div>
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
