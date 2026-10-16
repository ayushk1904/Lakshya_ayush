const mongoose = require("mongoose");

const previousPaperSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    fileName: { type: String, required: true, trim: true },
    mimeType: { type: String, required: true },
    extractedText: { type: String, default: "" },
    extractedImages: [
      {
        diagramId: { type: String, required: true },
        pageNumber: { type: Number, required: true },
        width: { type: Number, required: true },
        height: { type: Number, required: true },
        dataUrl: { type: String, required: true }
      }
    ],
    pageTexts: [
      {
        pageNumber: { type: Number, required: true },
        text: { type: String, required: true }
      }
    ],
    // Filled by the planner-ai paper RAG: questions with numbering/marks/types, data tables, and
    // how the text was read ("ocr" pages for PDFs whose text layer is unreadable).
    subject: { type: String, default: "" },
    structure: { type: mongoose.Schema.Types.Mixed, default: null },
    structureMethod: { type: String, default: "" },
    tables: { type: mongoose.Schema.Types.Mixed, default: [] },
    ocrPages: { type: Number, default: 0 },
    pageCount: { type: Number, default: 0 },
    // PDFs are read in the background after upload ("analysing" -> "ready" or "failed").
    // contentHash lets a PDF that was already read (by anyone) be reused instantly.
    status: { type: String, enum: ["ready", "analysing", "failed"], default: "ready" },
    statusMessage: { type: String, default: "" },
    contentHash: { type: String, default: "", index: true }
  },
  { timestamps: true }
);

module.exports = mongoose.models.PreviousPaper || mongoose.model("PreviousPaper", previousPaperSchema);
