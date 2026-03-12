import { Send, Sparkles } from "lucide-react";

function ConceptExplainerPage() {
  return (
    <div className="screen chat-screen">
      <div className="screen-header compact-header">
        <div>
          <h1>AI Concept Explainer</h1>
          <p>Ask any question and get exam-ready explanations.</p>
        </div>
      </div>
      <section className="explainer-body">
        <div className="ask-center">
          <div className="upload-icon">
            <Sparkles size={38} />
          </div>
          <h2>Ask me anything!</h2>
          <p>Try: "Explain inflation in simple terms"</p>
          <div className="chip-row">
            <button className="chip">What is Inflation?</button>
            <button className="chip">Explain Newton's 3rd Law</button>
            <button className="chip">What is DNA replication?</button>
          </div>
        </div>
        <div className="chat-input-row">
          <input type="text" placeholder="Ask a question..." />
          <button className="send-button" type="button">
            <Send size={18} />
          </button>
        </div>
      </section>
    </div>
  );
}

export default ConceptExplainerPage;
