const mongoose = require("mongoose");

const previousPaperSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    fileName: { type: String, required: true, trim: true },
    mimeType: { type: String, required: true },
    extractedText: { type: String, required: true },
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
    ]
  },
  { timestamps: true }
);

module.exports = mongoose.models.PreviousPaper || mongoose.model("PreviousPaper", previousPaperSchema);
