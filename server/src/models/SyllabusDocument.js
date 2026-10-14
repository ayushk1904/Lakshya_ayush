const mongoose = require("mongoose");

const unitSchema = new mongoose.Schema(
  {
    number: Number,
    title: String,
    hours: Number,
    importance: { type: Number, default: 2 },
    topics: [String]
  },
  { _id: false }
);

const subjectSchema = new mongoose.Schema(
  {
    key: String,
    name: String,
    code: String,
    semester: Number,
    kind: { type: String, default: "theory" },
    units: [unitSchema]
  },
  { _id: false }
);

const chunkSchema = new mongoose.Schema(
  {
    subjectKey: String,
    unitNumber: Number,
    text: String
  },
  { _id: false }
);

const syllabusDocumentSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    fileName: { type: String, required: true, trim: true },
    status: { type: String, enum: ["processing", "ready", "failed"], default: "processing" },
    progress: { done: { type: Number, default: 0 }, total: { type: Number, default: 0 } },
    error: { type: String, default: "" },
    extractionMode: { type: String, default: "" },
    rawText: { type: String, default: "" },
    semesters: [Number],
    subjects: [subjectSchema],
    chunks: [chunkSchema],
    // Optional-course group -> chosen subject key, e.g. { CSDLO601: "CSDLO6012" }
    electiveChoices: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { timestamps: true }
);

module.exports = mongoose.models.SyllabusDocument || mongoose.model("SyllabusDocument", syllabusDocumentSchema);
