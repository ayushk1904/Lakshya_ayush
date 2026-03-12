function pad(value) {
  return String(value).padStart(2, "0");
}

function formatTime(date) {
  let hours = date.getHours();
  const minutes = pad(date.getMinutes());
  const meridiem = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return `${hours}:${minutes} ${meridiem}`;
}

function isoFromDateTime(dateString, timeString) {
  const [year, month, day] = dateString.split("-").map(Number);
  const [hours, minutes] = timeString.split(":").map(Number);
  return new Date(year, month - 1, day, hours, minutes, 0, 0);
}

function normalizePriority(priority = "medium") {
  const normalized = String(priority).trim().toLowerCase();
  if (normalized === "high" || normalized === "low") {
    return normalized;
  }
  return "medium";
}

function parseTopics(topicsInput = "") {
  return String(topicsInput)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [subject = "General Study", chapter = "Focused Revision", topic = "Key Concepts", minutes = "60", priority = "medium"] =
        line.split("|").map((part) => part.trim());

      const durationMinutes = Math.max(25, Number.parseInt(minutes, 10) || 60);

      return {
        id: `topic-${index + 1}`,
        subject,
        chapter,
        topic,
        durationMinutes,
        priority: normalizePriority(priority)
      };
    })
    .sort((left, right) => {
      const weight = { high: 0, medium: 1, low: 2 };
      return weight[left.priority] - weight[right.priority];
    });
}

function defaultTopics() {
  return parseTopics(
    [
      "Physics | Chapter 2 | Thermodynamics | 90 | high",
      "Mathematics | Definite Integration | Formula revision and solved examples | 75 | medium",
      "Chemistry | Organic Reactions | Name reactions and mechanisms | 60 | medium",
      "Revision | Flashcards | Recall yesterday's weak areas | 45 | low"
    ].join("\n")
  );
}

function createReminderText(session) {
  return `Start with the ${session.subject} ${session.chapter} and focus on ${session.topic} first.`;
}

function buildSchedule(payload = {}) {
  const studyDate = payload.studyDate || new Date().toISOString().slice(0, 10);
  const startTime = payload.startTime || "07:00";
  const endTime = payload.endTime || "21:00";
  const breakMinutes = Math.max(0, Number.parseInt(payload.breakMinutes, 10) || 15);
  const reminderLeadMinutes = Math.max(0, Number.parseInt(payload.reminderLeadMinutes, 10) || 5);
  const rawTopics = parseTopics(payload.topicsInput);
  const topics = rawTopics.length ? rawTopics : defaultTopics();

  const current = isoFromDateTime(studyDate, startTime);
  const endOfDay = isoFromDateTime(studyDate, endTime);
  const sessions = [];

  for (const item of topics) {
    const sessionStart = new Date(current);
    const sessionEnd = new Date(sessionStart.getTime() + item.durationMinutes * 60 * 1000);

    if (sessionEnd > endOfDay) {
      break;
    }

    const reminderAt = new Date(sessionStart.getTime() - reminderLeadMinutes * 60 * 1000);
    const reminderText = createReminderText(item);

    sessions.push({
      ...item,
      startAt: sessionStart.toISOString(),
      endAt: sessionEnd.toISOString(),
      reminderAt: reminderAt.toISOString(),
      reminderLeadMinutes,
      time: `${formatTime(sessionStart)} - ${formatTime(sessionEnd)}`,
      task: `${item.subject} - ${item.chapter}: ${item.topic}`,
      tag: item.priority,
      reminderText
    });

    current.setTime(sessionEnd.getTime() + breakMinutes * 60 * 1000);
  }

  const subjectTotals = new Map();
  for (const session of sessions) {
    subjectTotals.set(session.subject, (subjectTotals.get(session.subject) || 0) + session.durationMinutes);
  }

  const studyProgress = Array.from(subjectTotals.entries()).map(([name, value]) => ({
    name,
    value: Math.min(100, Math.max(20, Math.round((value / 180) * 100)))
  }));

  const totalMinutes = sessions.reduce((sum, session) => sum + session.durationMinutes, 0);

  return {
    studyDate,
    syllabusName: payload.syllabusName || "Custom Study Plan",
    studyWindow: {
      startTime,
      endTime,
      breakMinutes,
      reminderLeadMinutes
    },
    summary: {
      totalSessions: sessions.length,
      totalMinutes,
      focusMessage:
        sessions[0]?.reminderText || "Your study plan is ready. Start with the highest-priority topic and stay consistent."
    },
    studyProgress,
    sessions,
    todayPlan: sessions.map(({ time, task, tag, reminderAt, reminderText }) => ({
      time,
      task,
      tag,
      reminderAt,
      reminderText
    })),
    coach: {
      summary: `Lakshya planned ${sessions.length} focused sessions for ${studyDate} with ${breakMinutes}-minute breaks between study blocks.`,
      voicePrompt:
        sessions[0]?.reminderText || "Your study plan is ready. Open the first task and begin your session now.",
      roadmap: sessions.map((session) => ({
        time: session.time,
        task: `${session.subject}: ${session.topic}`,
        note: `${session.chapter} · reminder ${reminderLeadMinutes} min before`
      }))
    }
  };
}

module.exports = {
  buildSchedule,
  defaultTopics
};
