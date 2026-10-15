// Renders a generated practice paper in the layout of the uploaded previous-year papers:
// header line, numbered instructions, then questions with their labels in a left column,
// marks in a right column, and figures/tables directly under the part that uses them.

const ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"];

function formatLabel(template, index) {
  return String(template || "{n}.")
    .replace("{n}", String(index))
    .replace("{a}", String.fromCharCode(96 + index))
    .replace("{A}", String.fromCharCode(64 + index));
}

// "Duration: 2 hours   Marks: 60" -> left and right halves, like the printed header.
function splitHeaderLine(line) {
  const parts = String(line || "").split(/\s{3,}/);
  return parts.length > 1 ? [parts.slice(0, -1).join("   "), parts[parts.length - 1]] : [line, ""];
}

function DataTable({ rows }) {
  const [header, ...body] = rows;
  return (
    <div className="exam-paper-table-wrap">
      <table className="exam-paper-table">
        <thead>
          <tr>
            {header.map((cell, index) => (
              <th key={index}>{cell}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {header.map((_cell, cellIndex) => (
                <td key={cellIndex}>{row[cellIndex] ?? ""}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PartContent({ part }) {
  return (
    <div className="exam-paper-part-body">
      <p>{part.text}</p>
      {part.subitems?.length ? (
        <ol className="exam-paper-subitems">
          {part.subitems.map((item, index) => (
            <li key={index}>
              <span>{ROMAN[index] || index + 1}.</span>
              {item}
            </li>
          ))}
        </ol>
      ) : null}
      {part.table?.length > 1 ? <DataTable rows={part.table} /> : null}
      {part.figure?.src ? (
        <figure className="exam-paper-figure">
          <img src={part.figure.src} alt={`Figure for ${part.label || "this question"}`} />
        </figure>
      ) : null}
    </div>
  );
}

function ExamPaper({ paper }) {
  const instructionTemplate = paper.numbering?.instruction || "{n}.";

  return (
    <article className="exam-paper">
      <header className="exam-paper-header">
        {paper.subject ? <h3>{paper.subject}</h3> : null}
        {(paper.header_lines || []).map((line, index) => {
          const [left, right] = splitHeaderLine(line);
          return (
            <div className="exam-paper-header-line" key={index}>
              <strong>{left}</strong>
              {right ? <strong>{right}</strong> : null}
            </div>
          );
        })}
      </header>

      {paper.instructions?.length ? (
        <section className="exam-paper-instructions">
          <strong>{paper.instructions_heading}</strong>
          <ol>
            {paper.instructions.map((line, index) => (
              <li key={index}>
                <span>{formatLabel(instructionTemplate, index + 1)}</span>
                {line}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <div className="exam-paper-questions">
        {paper.questions.map((question, questionIndex) => (
          <section className="exam-paper-question" key={questionIndex}>
            {question.heading ? (
              <div className="exam-paper-row exam-paper-heading-row">
                <span className="exam-paper-qlabel">{question.label}</span>
                <span className="exam-paper-plabel" />
                <strong className="exam-paper-heading">{question.heading}</strong>
                <span className="exam-paper-marks">{question.marks}</span>
              </div>
            ) : null}
            {question.parts.map((part, partIndex) => (
              <div className="exam-paper-row" key={partIndex}>
                <span className="exam-paper-qlabel">{!question.heading && partIndex === 0 ? question.label : ""}</span>
                <span className="exam-paper-plabel">{part.label}</span>
                <PartContent part={part} />
                <span className="exam-paper-marks">{part.marks || (!question.heading && partIndex === 0 ? question.marks : "")}</span>
              </div>
            ))}
          </section>
        ))}
      </div>
      <p className="exam-paper-end">* * * * * * * * * *</p>
    </article>
  );
}

export default ExamPaper;
