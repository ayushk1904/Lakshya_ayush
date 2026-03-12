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
    { _id: "physics-room", name: "Physics Study Room", onlineCount: 3, subject: "Physics" }
  ],
  messages: [
    { _id: "msg-1", user: { name: "Priya" }, time: "10:32 AM", text: "Hey everyone! Ready for tomorrow's physics test?" },
    { _id: "msg-2", user: { name: "Rahul" }, time: "10:33 AM", text: "I'm stuck on thermodynamics. Can someone explain entropy?" },
    {
      _id: "msg-3",
      user: { name: "AI Assistant", role: "ai" },
      time: "10:33 AM",
      text: "Entropy is a measure of disorder in a system. Think of it like a messy room that tends to get messier over time."
    }
  ],
  members: [
    { name: "Priya", status: "online" },
    { name: "Rahul", status: "online" },
    { name: "Ananya", status: "online" },
    { name: "Karthik", status: "away" }
  ]
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

export const fallbackProgress = {
  stats: [
    ["Total Study Hours", "48h"],
    ["Goals Completed", "18/25"],
    ["Improvement", "+12%"],
    ["Achievements", "4/6"]
  ],
  weeklyHours: [2, 3, 2.5, 4, 3.5, 5, 4.5],
  trendScores: [65, 70, 68, 74],
  subjects: [
    ["Mathematics", 75, "purple"],
    ["Physics", 60, "green"],
    ["Chemistry", 85, "gold"],
    ["Computer Science", 90, "red"]
  ],
  achievements: ["7-Day Streak", "Perfect Score", "Early Bird", "Night Owl", "Quick Learner", "Consistent"]
};
