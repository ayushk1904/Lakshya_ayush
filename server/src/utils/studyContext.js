// Keep prompts small while retrieving matching passages from the whole document.
function buildStudyContext(documents, question = "", maxChars = 12000) {
  const stopWords = new Set(["what", "when", "where", "which", "that", "this", "with", "from", "explain", "different", "also", "give", "example", "diagram"]);
  const terms = [...new Set(String(question).toLowerCase().match(/[a-z0-9]{3,}/g) || [])].filter((term) => !stopWords.has(term));
  const chunks = documents.flatMap((document, documentIndex) => {
    const text = String(document.extractedText || "").replace(/\s+/g, " ").trim();
    const parts = [];
    for (let offset = 0; offset < text.length; offset += 1000) {
      const content = text.slice(offset, offset + 1200);
      const lower = content.toLowerCase();
      const score = terms.reduce((total, term) => total + (lower.includes(term) ? 1 : 0), 0);
      parts.push({ content, fileName: document.fileName, documentIndex, offset, score });
    }
    // Without a query (quiz), sample throughout each document for topic coverage.
    return parts.map((part, index) => ({ ...part, sampleRank: index === 0 ? 0 : index === Math.floor(parts.length / 2) ? 1 : index === parts.length - 1 ? 2 : 3 + index }));
  });
  chunks.sort((a, b) => terms.length && a.score !== b.score ? b.score - a.score : a.sampleRank - b.sampleRank || a.documentIndex - b.documentIndex);
  const selected = [];
  let remaining = maxChars;
  for (const chunk of chunks) {
    if (remaining < 100) break;
    const label = `[${chunk.fileName}, passage at character ${chunk.offset}]\n`;
    const content = chunk.content.slice(0, Math.max(0, remaining - label.length - 2));
    if (!content) continue;
    const passage = label + content;
    selected.push(passage);
    remaining -= passage.length + 2;
  }
  return selected.join("\n\n");
}

module.exports = { buildStudyContext };
