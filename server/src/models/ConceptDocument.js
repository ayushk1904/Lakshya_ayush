const mongoose = require("mongoose");

const conceptDocumentSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    fileName: { type: String, required: true, trim: true },
    mimeType: { type: String, required: true },
    extractedText: { type: String, required: true },
    summary: { type: String, default: "" }
  },
  { timestamps: true }
);

module.exports = mongoose.models.ConceptDocument || mongoose.model("ConceptDocument", conceptDocumentSchema);
