import { Clock3, FileText, Send, Sparkles, Trash2, Upload, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { chatApi, examApi, trackStudyEvent } from "../api/client";

function toLocalDateTimeInput(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function formatStartTime(value) {
  if (!value) {
    return "Not scheduled";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Not scheduled";
  }

  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function isSampleScheduledTest(session) {
  const title = String(session?.title || "").trim().toLowerCase();
  const date = String(session?.date || "").trim().toLowerCase();
  const count = String(session?.count || "").trim().toLowerCase();

  return (
    (title === "physics mock test" || title === "math chapter test") &&
    (!session?.startAt || date === "mar 14" || date === "mar 16" || count === "30 questions" || count === "25 questions")
  );
}

function PracticeTestsPage() {
  const [papers, setPapers] = useState([]);
  const [selectedPaperIds, setSelectedPaperIds] = useState([]);
  const [upcomingSessions, setUpcomingSessions] = useState([]);
  const [studyRooms, setStudyRooms] = useState([]);
  const [selectedShareRoomId, setSelectedShareRoomId] = useState("");
  const [status, setStatus] = useState("");
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [removingSessionId, setRemovingSessionId] = useState("");
  const [sharingSessionId, setSharingSessionId] = useState("");
  const [form, setForm] = useState({
    title: "AI Generated Mock Test",
    marks: "80",
    durationMinutes: "60",
    startAt: toLocalDateTimeInput(new Date(Date.now() + 10 * 60000))
  });
  useEffect(() => {
    Promise.allSettled([examApi.listPapers(), examApi.upcoming(), chatApi.listRooms()]).then(
      ([papersResult, upcomingResult, roomsResult]) => {
      if (papersResult.status === "fulfilled") {
        const nextPapers = papersResult.value.papers || [];
        setPapers(nextPapers);
        setSelectedPaperIds(nextPapers.map((paper) => paper._id));
      }

      if (upcomingResult.status === "fulfilled") {
        const nextUpcomingSessions = (upcomingResult.value.exams || []).filter((session) => !isSampleScheduledTest(session));
        setUpcomingSessions(nextUpcomingSessions);
      }

        if (roomsResult.status === "fulfilled") {
          const nextRooms = roomsResult.value.rooms || [];
          setStudyRooms(nextRooms);
          setSelectedShareRoomId((current) => current || nextRooms[0]?._id || "");
        }
      }
    );
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      Promise.allSettled([examApi.upcoming()]).then(([upcomingResult]) => {
        if (upcomingResult.status === "fulfilled") {
          const nextUpcomingSessions = (upcomingResult.value.exams || []).filter((session) => !isSampleScheduledTest(session));
          setUpcomingSessions(nextUpcomingSessions);
        }
      });
    }, 15000);

    return () => window.clearInterval(intervalId);
  }, []);

  async function uploadPaper(event) {
    const files = Array.from(event.target.files || []);

    if (!files.length) {
      return;
    }

    setUploading(true);
    setStatus("");

    try {
      const formData = new FormData();
      files.forEach((file) => {
        formData.append("files", file);
      });
      const data = await examApi.uploadPapers(formData);
      const uploadedPapers = data.papers || (data.paper ? [data.paper] : []);

      setPapers((current) => [...uploadedPapers, ...current]);
      setSelectedPaperIds((current) => [...uploadedPapers.map((paper) => paper._id), ...current]);
      setStatus(
        uploadedPapers.length === 1
          ? `${uploadedPapers[0].fileName} uploaded for test generation.`
          : `${uploadedPapers.length} papers uploaded for test generation.`
      );
    } catch (error) {
      setStatus(error.message);
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  function togglePaper(paperId) {
    setSelectedPaperIds((current) => (current.includes(paperId) ? current.filter((id) => id !== paperId) : [...current, paperId]));
  }

  async function removePaper(paper) {
    const targetPaperId = paper?._id;
    const targetPaperFileName = String(paper?.fileName || "").trim().toLowerCase();

    try {
      await examApi.deletePaper(paper);
      setPapers((current) =>
        current.filter((item) => item._id !== targetPaperId && String(item.fileName || "").trim().toLowerCase() !== targetPaperFileName)
      );
      setSelectedPaperIds((current) => current.filter((id) => id !== targetPaperId));
      setStatus("Paper removed.");
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function generateTest() {
    setGenerating(true);
    setStatus("");

    try {
      const data = await examApi.generateTest({
        title: form.title,
        marks: Number(form.marks),
        durationMinutes: Number(form.durationMinutes),
        startAt: new Date(form.startAt).toISOString(),
        paperIds: selectedPaperIds,
        mode: "focus"
      });

      setUpcomingSessions((current) => [data.session, ...current.filter((item) => item._id !== data.session._id && !isSampleScheduledTest(item))]);
      trackStudyEvent({ feature: "tests", label: `Scheduled practice test: ${form.title || "Mock test"}` });
      setStatus(data.warning || "Mock test generated and scheduled. Lakshya will start it automatically at the selected time.");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setGenerating(false);
    }
  }

  async function removeScheduledTest(sessionId) {
    if (!sessionId || removingSessionId) {
      return;
    }

    setRemovingSessionId(sessionId);
    setStatus("");

    try {
      await examApi.deleteSession(sessionId);
      setUpcomingSessions((current) => current.filter((session) => session._id !== sessionId));
      setStatus("Scheduled test removed.");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setRemovingSessionId("");
    }
  }

  async function shareSessionToRoom(sessionId) {
    if (!selectedShareRoomId) {
      setStatus("Choose a study room first, then send the invite.");
      return;
    }

    setSharingSessionId(sessionId);
    setStatus("");

    try {
      const data = await examApi.shareToRoom(sessionId, { roomId: selectedShareRoomId });
      const roomName = studyRooms.find((room) => room._id === selectedShareRoomId)?.name || data.room?.name || "your study room";
      setStatus(`Practice test invite sent to ${roomName}. Friends can join it from the Study Hub chat.`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setSharingSessionId("");
    }
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <div>
          <h1>Practice Tests</h1>
          <p>Upload previous year papers, generate an AI mock test, and schedule the proctored exam call.</p>
        </div>
      </div>

      <div className="practice-grid">
        <aside className="practice-sidebar panel">
          <label className="upload-panel practice-upload-card">
            <div className="upload-icon">
              <Upload size={34} />
            </div>
            <h3>{uploading ? "Uploading..." : "Upload previous year papers"}</h3>
            <p>Upload one or many PDF or text files at once. Lakshya will use them to generate an exam-style test.</p>
            <input type="file" accept=".pdf,.txt,text/plain,application/pdf" multiple onChange={uploadPaper} hidden />
          </label>

          <div className="practice-papers">
            <div className="panel-title">
              <FileText size={18} />
              <h2>Uploaded papers</h2>
            </div>
            {papers.length ? (
              <div className="practice-paper-list">
                {papers.map((paper) => (
                  <article className={`practice-paper-card ${selectedPaperIds.includes(paper._id) ? "active" : ""}`} key={paper._id}>
                    <button className="practice-paper-main" type="button" onClick={() => togglePaper(paper._id)}>
                      <strong>{paper.fileName}</strong>
                      <span>
                        {paper.mimeType === "application/pdf"
                          ? `PDF uploaded${paper.diagramCount ? ` - ${paper.diagramCount} diagram${paper.diagramCount > 1 ? "s" : ""} extracted` : ""}`
                          : "Text file uploaded"}
                      </span>
                    </button>
                    <button className="practice-paper-remove" type="button" aria-label={`Remove ${paper.fileName}`} onClick={() => removePaper(paper)}>
                      <Trash2 size={16} />
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <p className="muted-copy">Upload at least one previous year paper to begin.</p>
            )}
          </div>
        </aside>

        <section className="practice-main">
          <section className="panel practice-builder-panel">
            <div className="panel-title">
              <Sparkles size={18} />
              <h2>Generate Test</h2>
            </div>

            <div className="practice-builder-form">
              <label>
                <span>Test title</span>
                <input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} type="text" />
              </label>
              <label>
                <span>Marks</span>
                <input value={form.marks} onChange={(event) => setForm((current) => ({ ...current, marks: event.target.value }))} type="number" min="10" step="10" />
              </label>
              <label>
                <span>Duration in minutes</span>
                <input
                  value={form.durationMinutes}
                  onChange={(event) => setForm((current) => ({ ...current, durationMinutes: event.target.value }))}
                  type="number"
                  min="10"
                  step="5"
                />
              </label>
              <label>
                <span>Test start time</span>
                <input value={form.startAt} onChange={(event) => setForm((current) => ({ ...current, startAt: event.target.value }))} type="datetime-local" />
              </label>
              <label>
                <span>Study room for invites</span>
                <select value={selectedShareRoomId} onChange={(event) => setSelectedShareRoomId(event.target.value)}>
                  {studyRooms.length ? (
                    studyRooms.map((studyRoom) => (
                      <option key={studyRoom._id} value={studyRoom._id}>
                        {studyRoom.name}
                      </option>
                    ))
                  ) : (
                    <option value="">No study room available</option>
                  )}
                </select>
              </label>
            </div>

            <div className="practice-presets">
              {[80, 60, 40].map((marks) => (
                <button key={marks} className="chip" type="button" onClick={() => setForm((current) => ({ ...current, marks: String(marks) }))}>
                  {marks} marks
                </button>
              ))}
            </div>

            <div className="button-row">
              <button className="primary-button" type="button" onClick={generateTest} disabled={generating}>
                {generating ? "Generating..." : "Generate Test"}
              </button>
              <span className="subtle">
                {studyRooms.length
                  ? "Lakshya will create the paper, start it automatically at the selected time, and let you send the same test to your study room."
                  : "Lakshya will create the paper and move you directly into AI Proctor at the chosen time. Create a Study Hub room to invite friends."}
              </span>
            </div>
          </section>

          <section className="practice-preview-grid practice-scheduled-grid">
            <article className="panel">
              <div className="panel-title">
                <Clock3 size={18} />
                <h2>Scheduled Tests</h2>
              </div>
              <div className="exam-list">
                {upcomingSessions.length ? (
                  upcomingSessions.map((session) => (
                    <div className="exam-card" key={session._id || session.title}>
                      <div>
                        <strong>{session.title}</strong>
                        <p>{formatStartTime(session.startAt || session.date)}</p>
                      </div>
                      <div className="practice-scheduled-meta">
                        <span>{`${session.marks || 80} marks - ${session.durationMinutes || 60} min`}</span>
                        <button
                          className="secondary-button compact practice-session-share"
                          type="button"
                          onClick={() => shareSessionToRoom(session._id)}
                          disabled={!studyRooms.length || sharingSessionId === session._id}
                        >
                          <Send size={14} />
                          {sharingSessionId === session._id ? "Sending..." : "Invite Study Room"}
                        </button>
                        <button
                          className="practice-session-remove"
                          type="button"
                          onClick={() => removeScheduledTest(session._id)}
                          disabled={removingSessionId === session._id || session.status === "active"}
                        >
                          <Trash2 size={14} />
                          {removingSessionId === session._id ? "Removing..." : "Remove"}
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="muted-copy">No scheduled tests yet.</p>
                )}
              </div>
              <p className="muted-copy practice-preview-note">Generated papers stay hidden here and will open automatically in AI Proctor at the scheduled time.</p>
              {studyRooms.length ? (
                <p className="muted-copy practice-preview-note practice-share-note">
                  <Users size={14} /> Invite the selected study room and your friends will get a join button in chat for the same test timing.
                </p>
              ) : null}
            </article>
          </section>

          {status ? <div className="planner-status">{status}</div> : null}
        </section>
      </div>
    </div>
  );
}

export default PracticeTestsPage;
