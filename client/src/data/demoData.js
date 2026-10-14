export const fallbackDashboard = {
  studyProgress: [
    { name: "Physics", value: 72 },
    { name: "Mathematics", value: 58 },
    { name: "Chemistry", value: 45 },
    { name: "Biology", value: 30 }
  ],
  todayPlan: [
    { time: "9:00 AM", task: "Physics - Chapter 3: Laws of Motion", tag: "high" },
    { time: "11:00 AM", task: "Math - Integration Practice", tag: "medium" },
    { time: "2:00 PM", task: "Chemistry - Organic Reactions", tag: "high" },
    { time: "4:00 PM", task: "Revision - Previous Day Topics", tag: "low" }
  ],
  upcomingExams: [
    { _id: "exam-1", title: "Physics Mock Test", date: "Mar 14", count: "30 questions" },
    { _id: "exam-2", title: "Math Chapter Test", date: "Mar 16", count: "25 questions" }
  ]
};

export const fallbackChat = {
  rooms: [
    { _id: "physics-room", name: "Lakshya Study Room", avatarUrl: "", onlineCount: 1, subject: "General", members: [], invites: [] }
  ],
  messages: [
    {
      _id: "msg-1",
      user: { name: "Lakshya AI", role: "ai" },
      time: "10:33 AM",
      text: "Invite a friend by email to start collaborating here."
    }
  ],
  members: [],
  invites: []
};

export const fallbackCoach = {
  summary:
    "Physics Chapters 2 and 5 carry the most marks. Lakshya schedules them during your highest-energy hours.",
  voicePrompt: "Good morning! It's time to start Chapter 2. Let's stay focused.",
  roadmap: [
    { time: "8:00 AM - 10:00 AM", task: "Chapter 2: Electrostatics", note: "High weightage" },
    { time: "10:30 AM - 11:30 AM", task: "Chapter 4: Short Notes Revision", note: "Quick win" },
    { time: "12:00 PM - 1:30 PM", task: "Numericals Drill", note: "Peak focus block" },
    { time: "3:00 PM - 4:00 PM", task: "Topper Answers Review", note: "Presentation boost" },
    { time: "6:00 PM - 7:00 PM", task: "Formula Recap + Flash Revision", note: "Retention block" }
  ]
};
