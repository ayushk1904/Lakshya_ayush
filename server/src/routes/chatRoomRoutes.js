const express = require("express");
const mongoose = require("mongoose");
const ChatRoom = require("../models/ChatRoom");
const ChatMessage = require("../models/ChatMessage");
const User = require("../models/User");
const authMiddleware = require("../middleware/authMiddleware");
const { chatRooms, messages } = require("../utils/mockData");

const router = express.Router();
const MAX_ROOM_AVATAR_BYTES = 5 * 1024 * 1024;

router.use(authMiddleware);

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function normalizeRoomAvatar(avatarUrl) {
  const nextAvatarUrl = String(avatarUrl || "").trim();

  if (!nextAvatarUrl) {
    return "";
  }

  if (/^https?:\/\//i.test(nextAvatarUrl)) {
    if (Buffer.byteLength(nextAvatarUrl, "utf8") > MAX_ROOM_AVATAR_BYTES) {
      throw new Error("Room avatar URL is too large");
    }

    return nextAvatarUrl;
  }

  const dataUrlMatch = nextAvatarUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i);
  if (!dataUrlMatch) {
    throw new Error("Room avatar must be a valid image");
  }

  const mimeType = dataUrlMatch[1].toLowerCase();
  const allowedMimeTypes = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"]);
  if (!allowedMimeTypes.has(mimeType)) {
    throw new Error("Room avatar must be a PNG, JPG, WEBP, or GIF image");
  }

  const base64Payload = dataUrlMatch[2].replace(/\s+/g, "");
  const avatarBytes = Buffer.byteLength(base64Payload, "base64");
  if (avatarBytes > MAX_ROOM_AVATAR_BYTES) {
    throw new Error("Room avatar must be 5 MB or smaller");
  }

  return `data:${mimeType};base64,${base64Payload}`;
}

function serializeRoom(room) {
  return {
    _id: room._id,
    name: room.name,
    subject: room.subject,
    avatarUrl: room.avatarUrl || "",
    onlineCount: Array.isArray(room.members) ? room.members.filter((member) => member.status === "online").length : 0,
    members: room.members || [],
    invites: room.invites || []
  };
}

function getAiModel() {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    return null;
  }

  return {
    apiKey,
    model: process.env.GROQ_MODEL || "openai/gpt-oss-20b"
  };
}

function formatChatTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function normalizeMessageUser(user) {
  if (!user || typeof user !== "object") {
    return user;
  }

  const nextUser = { ...user };
  if (nextUser.role === "ai" || nextUser.name === "AI Assistant") {
    nextUser.name = "Lakshya AI";
    nextUser.role = "ai";
  }

  return nextUser;
}

function serializeMessage(message) {
  return {
    _id: String(message._id),
    roomId: String(message.roomId),
    user: normalizeMessageUser(message.user),
    text: message.text,
    kind: message.kind || "message",
    attachments: Array.isArray(message.attachments) ? message.attachments : [],
    replyTo: message.replyTo || null,
    practiceInvite: message.practiceInvite
      ? {
          inviteId: message.practiceInvite.inviteId || "",
          sessionId: message.practiceInvite.sessionId ? String(message.practiceInvite.sessionId) : "",
          title: message.practiceInvite.title || "",
          marks: Number(message.practiceInvite.marks || 80),
          durationMinutes: Number(message.practiceInvite.durationMinutes || 60),
          startAt: message.practiceInvite.startAt,
          mode: message.practiceInvite.mode || "focus",
          invitedByName: message.practiceInvite.invitedByName || "",
          invitedByEmail: message.practiceInvite.invitedByEmail || "",
          joiners: Array.isArray(message.practiceInvite.joiners)
            ? message.practiceInvite.joiners.map((joiner) => ({
                userId: joiner.userId ? String(joiner.userId) : "",
                name: joiner.name || "",
                email: joiner.email || "",
                sessionId: joiner.sessionId ? String(joiner.sessionId) : "",
                joinedAt: joiner.joinedAt || null
              }))
            : []
        }
      : null,
    deletedForEveryone: Boolean(message.deletedForEveryone),
    time: formatChatTime(message.createdAt || Date.now()),
    createdAt: message.createdAt
  };
}

async function ensureRoomSeedMessages(room) {
  const existingCount = await ChatMessage.countDocuments({ roomId: room._id });

  if (existingCount > 0) {
    return;
  }

  await ChatMessage.create({
    roomId: room._id,
    user: { name: "Lakshya AI", role: "ai" },
    text: "Welcome to your Study Hub. Tag me with @ai when you want a solution, explanation, or a quick second opinion.",
    kind: "message"
  });
}

async function loadRoomMessages(roomId, userEmail) {
  const roomMessages = await ChatMessage.find({
    roomId,
    deletedFor: { $ne: userEmail }
  })
    .sort({ createdAt: 1, _id: 1 })
    .lean();
  return roomMessages.map(serializeMessage);
}

function normalizeAttachments(rawAttachments) {
  if (!Array.isArray(rawAttachments)) {
    return [];
  }

  return rawAttachments
    .map((attachment) => ({
      type: String(attachment?.type || "").trim().toLowerCase(),
      name: String(attachment?.name || "").trim(),
      url: String(attachment?.url || "").trim(),
      mimeType: String(attachment?.mimeType || "").trim(),
      size: Number(attachment?.size || 0)
    }))
    .filter((attachment) => attachment.url && ["image", "file", "document", "link"].includes(attachment.type))
    .slice(0, 6);
}

async function generateGroqText({ modelConfig, systemPrompt, userPrompt }) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(20000),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${modelConfig.apiKey}`
    },
    body: JSON.stringify({
      model: modelConfig.model,
      temperature: 0.35,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.error?.message || "Groq request failed");
  }

  return data?.choices?.[0]?.message?.content?.trim() || "";
}

function buildFallbackAiAnswer({ authorName, prompt }) {
  return [
    `${authorName}, here is my quick take on that.`,
    "",
    `Question: ${prompt}`,
    "",
    "1. Start by identifying what the question is really asking.",
    "2. Break the idea into smaller steps or known formulas.",
    "3. Compare your final step with the original question to make sure it actually answers it.",
    "",
    "If you want, tag me again with the exact problem statement or options and I will help step by step."
  ].join("\n");
}

function buildFriendlyReaction({ authorName, text }) {
  const normalized = text.toLowerCase();

  if (normalized.includes("@ai")) {
    return "";
  }

  if (/\b(thanks|thank you|got it|understood|done|solved)\b/.test(normalized)) {
    return `Nice work, ${authorName}. That sounds like a solid step forward.`;
  }

  if (/\b(stuck|confused|doubt|help|hard|difficult)\b/.test(normalized)) {
    return `I am here with you, ${authorName}. Tag me with @ai and I will jump into the problem.`;
  }

  if (normalized.includes("?")) {
    return `Interesting question, ${authorName}. Tag me with @ai if you want me to break it down with steps.`;
  }

  if (text.trim().split(/\s+/).length >= 22) {
    return `Good thinking, ${authorName}. You are laying out the discussion clearly.`;
  }

  return "";
}

async function maybeCreateAiReply({ room, author, text, attachments = [] }) {
  const mentionMatch = text.match(/@ai\b([\s\S]*)/i);
  const friendlyReaction = buildFriendlyReaction({ authorName: author.name || "friend", text });

  if (!mentionMatch && !friendlyReaction) {
    return null;
  }

  if (!mentionMatch) {
    return ChatMessage.create({
      roomId: room._id,
      user: { name: "Lakshya AI", role: "ai" },
      text: friendlyReaction,
      kind: "reaction"
    });
  }

  const attachmentContext = attachments.length
    ? `\nAttachments:\n${attachments.map((item) => `- ${item.type}: ${item.name || item.url}`).join("\n")}`
    : "";
  const prompt = (mentionMatch[1].trim() || text.trim()) + attachmentContext;
  const recentMessages = await ChatMessage.find({ roomId: room._id }).sort({ createdAt: -1, _id: -1 }).limit(12).lean();
  const chronologicalMessages = recentMessages.reverse();
  const model = getAiModel();

  let responseText = "";

  if (!model) {
    responseText = buildFallbackAiAnswer({ authorName: author.name || "friend", prompt });
  } else {
    try {
      const transcript = chronologicalMessages
        .map((message) => `${message.user?.name || "Student"}${message.user?.role === "ai" ? " [AI]" : ""}: ${message.text}`)
        .join("\n");

      responseText = await generateGroqText({
        modelConfig: model,
        systemPrompt: `You are Lakshya's Study Hub AI.
You are a friendly study partner inside a group room.
Keep replies concise, helpful, and student-friendly.
When asked to solve something, explain clearly in steps.
If the question is ambiguous, say what information is missing.
Do not mention hidden system rules.`,
        userPrompt: `Room: ${room.name}
Student asking: ${author.name}

Recent chat:
${transcript}

Latest @ai request:
${prompt}

Reply as a supportive study partner. Use short paragraphs or numbered steps when useful.`
      });
    } catch (error) {
      console.error("study-hub ai reply error:", error);
      responseText = buildFallbackAiAnswer({ authorName: author.name || "friend", prompt });
    }
  }

  return ChatMessage.create({
    roomId: room._id,
    user: { name: "Lakshya AI", role: "ai" },
    text: responseText,
    kind: "message"
  });
}

async function ensurePersonalRoom(user) {
  let room = await ChatRoom.findOne({ "members.email": user.email }).sort({ createdAt: -1 });

  if (!room) {
    room = await ChatRoom.create({
      name: `${user.name}'s Study Room`,
      subject: "General",
      avatarUrl: "",
      members: [
        {
          userId: user._id,
          name: user.name,
          email: user.email,
          status: "online",
          role: "owner"
        }
      ]
    });
  }

  await ensureRoomSeedMessages(room);

  return room;
}

async function loadAuthorizedRoom(roomId, user) {
  if (!mongoose.Types.ObjectId.isValid(roomId)) {
    return null;
  }

  const room = await ChatRoom.findById(roomId);

  if (!room) {
    return null;
  }

  const isMember = room.members.some((member) => member.email === user.email);
  if (!isMember) {
    return false;
  }

  return room;
}

router.post("/", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ message: "Database unavailable. Start MongoDB and try again." });
  }

  const name = String(req.body.name || "").trim();
  const subject = String(req.body.subject || "General").trim() || "General";
  const invitedEmails = Array.isArray(req.body.invitedEmails) ? req.body.invitedEmails : [];
  let avatarUrl = "";

  if (!name) {
    return res.status(400).json({ message: "Study room name is required" });
  }

  if (name.length > 60) {
    return res.status(400).json({ message: "Study room name must be 60 characters or fewer" });
  }

  try {
    avatarUrl = normalizeRoomAvatar(req.body.avatarUrl);
  } catch (error) {
    return res.status(400).json({ message: error.message || "Invalid room avatar" });
  }

  const normalizedInviteEmails = [...new Set(
    invitedEmails
      .map((email) => normalizeEmail(email))
      .filter((email) => email && email !== req.user.email)
  )].slice(0, 20);

  const invitedUsers = normalizedInviteEmails.length
    ? await User.find({ email: { $in: normalizedInviteEmails } }).select("name email").lean()
    : [];
  const invitedUserMap = new Map(invitedUsers.map((user) => [normalizeEmail(user.email), user]));

  const room = await ChatRoom.create({
    name,
    subject,
    avatarUrl,
    members: [
      {
        userId: req.user._id,
        name: req.user.name,
        email: req.user.email,
        status: "online",
        role: "owner"
      }
    ],
    invites: normalizedInviteEmails.map((email) => ({
      email,
      invitedName: invitedUserMap.get(email)?.name || "",
      invitedByUserId: req.user._id,
      invitedByName: req.user.name,
      status: "pending"
    }))
  });

  await ensureRoomSeedMessages(room);

  return res.status(201).json({
    message: "Study room created successfully",
    room: serializeRoom(room)
  });
});

router.get("/", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.json({ rooms: chatRooms });
  }

  await ensurePersonalRoom(req.user);
  const rooms = await ChatRoom.find({ "members.email": req.user.email }).sort({ createdAt: -1 });
  return res.json({ rooms: rooms.map(serializeRoom) });
});

router.get("/:roomId/messages", async (req, res) => {
  if (mongoose.connection.readyState === 1) {
    const room = await loadAuthorizedRoom(req.params.roomId, req.user);

    if (room === null) {
      return res.status(404).json({ message: "Study room not found" });
    }

    if (room === false) {
      return res.status(403).json({ message: "You do not have access to this study room" });
    }

    await ensureRoomSeedMessages(room);
    const roomMessages = await loadRoomMessages(room._id, req.user.email);
    return res.json({ room: serializeRoom(room), messages: roomMessages });
  }

  const roomMessages = messages.filter((message) => message.roomId === req.params.roomId);
  return res.json({ room: chatRooms.find((room) => room._id === req.params.roomId) || chatRooms[0], messages: roomMessages });
});

router.post("/:roomId/messages", async (req, res) => {
  const text = String(req.body.text || "").trim();
  const attachments = normalizeAttachments(req.body.attachments);
  const replyToMessageId = String(req.body.replyToMessageId || "").trim();

  if (!text && !attachments.length) {
    return res.status(400).json({ message: "Message text or attachment is required" });
  }

  if (mongoose.connection.readyState === 1) {
    const room = await loadAuthorizedRoom(req.params.roomId, req.user);

    if (room === null) {
      return res.status(404).json({ message: "Study room not found" });
    }

    if (room === false) {
      return res.status(403).json({ message: "You do not have access to this study room" });
    }

    await ensureRoomSeedMessages(room);
    let replyTo = null;

    if (replyToMessageId && mongoose.Types.ObjectId.isValid(replyToMessageId)) {
      const repliedMessage = await ChatMessage.findOne({ _id: replyToMessageId, roomId: room._id }).lean();

      if (repliedMessage) {
        replyTo = {
          messageId: repliedMessage._id,
          userName: repliedMessage.user?.name || "Student",
          text: repliedMessage.deletedForEveryone
            ? "This message was deleted."
            : repliedMessage.text || repliedMessage.attachments?.[0]?.name || repliedMessage.attachments?.[0]?.url || ""
        };
      }
    }

    await ChatMessage.create({
      roomId: room._id,
      user: {
        userId: req.user._id,
        name: req.user.name || "Student",
        email: req.user.email,
        role: room.members.find((member) => member.email === req.user.email)?.role || "member"
      },
      text,
      attachments,
      replyTo
    });

    await maybeCreateAiReply({
      room,
      author: { name: req.user.name || "Student", email: req.user.email },
      text,
      attachments
    });

    return res.status(201).json({ messages: await loadRoomMessages(room._id, req.user.email) });
  }

  const newMessage = {
    _id: `m-${Date.now()}`,
    roomId: req.params.roomId,
    user: { name: req.user.name || "Student", email: req.user.email },
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    text,
    attachments,
    replyTo: null
  };

  messages.push(newMessage);

  const mentionMatch = text.match(/@ai\b([\s\S]*)/i);
  const reactionText = buildFriendlyReaction({ authorName: req.user.name || "Student", text });
  if (mentionMatch || reactionText) {
    messages.push({
      _id: `m-${Date.now() + 1}`,
      roomId: req.params.roomId,
      user: { name: "Lakshya AI", role: "ai" },
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      text: mentionMatch
        ? buildFallbackAiAnswer({ authorName: req.user.name || "Student", prompt: mentionMatch[1].trim() || text })
        : reactionText,
      kind: mentionMatch ? "message" : "reaction"
    });
  }

  const roomMessages = messages.filter((message) => message.roomId === req.params.roomId);
  return res.status(201).json({ messages: roomMessages });
});

router.post("/:roomId/messages/:messageId/delete", async (req, res) => {
  const mode = String(req.body.mode || "").trim();

  if (!["me", "everyone"].includes(mode)) {
    return res.status(400).json({ message: 'Delete mode must be "me" or "everyone"' });
  }

  if (mongoose.connection.readyState === 1) {
    const room = await loadAuthorizedRoom(req.params.roomId, req.user);

    if (room === null) {
      return res.status(404).json({ message: "Study room not found" });
    }

    if (room === false) {
      return res.status(403).json({ message: "You do not have access to this study room" });
    }

    const message = await ChatMessage.findOne({ _id: req.params.messageId, roomId: room._id });

    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }

    if (mode === "everyone") {
      const canDeleteForEveryone =
        message.user?.email === req.user.email || room.members.find((member) => member.email === req.user.email)?.role === "owner";

      if (!canDeleteForEveryone) {
        return res.status(403).json({ message: "Only the sender can delete this message for everyone" });
      }

      message.text = "This message was deleted for everyone.";
      message.attachments = [];
      message.replyTo = null;
      message.deletedForEveryone = true;
      message.deletedAt = new Date();
    } else if (!message.deletedFor.includes(req.user.email)) {
      message.deletedFor.push(req.user.email);
    }

    await message.save();

    return res.json({ messages: await loadRoomMessages(room._id, req.user.email) });
  }

  const targetIndex = messages.findIndex((message) => message._id === req.params.messageId && message.roomId === req.params.roomId);
  if (targetIndex === -1) {
    return res.status(404).json({ message: "Message not found" });
  }

  if (mode === "everyone") {
    messages[targetIndex] = {
      ...messages[targetIndex],
      text: "This message was deleted for everyone.",
      attachments: [],
      replyTo: null,
      deletedForEveryone: true
    };
  } else {
    messages.splice(targetIndex, 1);
  }

  return res.json({ messages: messages.filter((message) => message.roomId === req.params.roomId) });
});

router.post("/:roomId/invitations", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ message: "Database unavailable. Start MongoDB and try again." });
  }

  const room = await loadAuthorizedRoom(req.params.roomId, req.user);

  if (room === null) {
    return res.status(404).json({ message: "Study room not found" });
  }

  if (room === false) {
    return res.status(403).json({ message: "You do not have access to this study room" });
  }

  const email = normalizeEmail(req.body.email);
  if (!email) {
    return res.status(400).json({ message: "Email is required" });
  }

  if (email === req.user.email) {
    return res.status(400).json({ message: "You are already in this study room" });
  }

  if (room.members.some((member) => member.email === email)) {
    return res.status(400).json({ message: "This email is already in the study room" });
  }

  if (room.invites.some((invite) => invite.email === email && invite.status === "pending")) {
    return res.status(400).json({ message: "An invitation has already been sent to this email" });
  }

  const invitedUser = await User.findOne({ email }).select("name email");
  room.invites.push({
    email,
    invitedName: invitedUser?.name || "",
    invitedByUserId: req.user._id,
    invitedByName: req.user.name,
    status: "pending"
  });
  await room.save();

  return res.status(201).json({
    room: serializeRoom(room),
    invitedUser: invitedUser ? { name: invitedUser.name, email: invitedUser.email } : null
  });
});

router.get("/invitations", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ message: "Database unavailable." });
  }

  const email = normalizeEmail(req.user.email);
  const rooms = await ChatRoom.find({
    invites: { $elemMatch: { email, status: "pending" } }
  });

  const invites = rooms.map((room) => {
    const invite = room.invites.find((i) => i.email === email && i.status === "pending");
    return {
      roomId: room._id,
      roomName: room.name,
      invitedBy: invite?.invitedByName,
      invitedAt: invite?.invitedAt,
      status: invite?.status
    };
  });

  return res.json({ invites });
});

async function handleInvitationResponse(req, res, responseStatus) {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ message: "Database unavailable. Start MongoDB and try again." });
  }

  if (!mongoose.Types.ObjectId.isValid(req.params.roomId)) {
    return res.status(404).json({ message: "Study room not found" });
  }

  const room = await ChatRoom.findById(req.params.roomId);
  if (!room) {
    return res.status(404).json({ message: "Study room not found" });
  }

  const email = normalizeEmail(req.user.email);
  const invite = room.invites.find((i) => i.email === email && i.status === "pending");
  if (!invite) {
    return res.status(403).json({ message: "No pending invitation found for this user" });
  }

  invite.status = responseStatus;
  invite.respondedAt = new Date();

  if (responseStatus === "accepted") {
    if (!room.members.some((member) => member.email === email)) {
      room.members.push({
        userId: req.user._id,
        name: req.user.name,
        email,
        status: "online",
        role: "member"
      });
    }
  }

  await room.save();

  return res.json({ room: serializeRoom(room) });
}

router.post("/:roomId/invitations/accept", async (req, res) => {
  return handleInvitationResponse(req, res, "accepted");
});

router.post("/:roomId/invitations/reject", async (req, res) => {
  return handleInvitationResponse(req, res, "rejected");
});

router.put("/:roomId/settings", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ message: "Database unavailable. Start MongoDB and try again." });
  }

  const room = await loadAuthorizedRoom(req.params.roomId, req.user);

  if (room === null) {
    return res.status(404).json({ message: "Study room not found" });
  }

  if (room === false) {
    return res.status(403).json({ message: "You do not have access to this study room" });
  }

  const currentMember = room.members.find((member) => member.email === req.user.email);
  if (currentMember?.role !== "owner") {
    return res.status(403).json({ message: "Only the room owner can update study room settings" });
  }

  const nextName = String(req.body.name || "").trim();
  let nextAvatarUrl = "";

  if (!nextName) {
    return res.status(400).json({ message: "Study room name is required" });
  }

  if (nextName.length > 60) {
    return res.status(400).json({ message: "Study room name must be 60 characters or fewer" });
  }

  try {
    nextAvatarUrl = normalizeRoomAvatar(req.body.avatarUrl);
  } catch (error) {
    return res.status(400).json({ message: error.message || "Invalid room avatar" });
  }

  room.name = nextName;
  room.avatarUrl = nextAvatarUrl;
  await room.save();

  return res.json({ message: "Study room updated successfully", room: serializeRoom(room) });
});

router.post("/:roomId/leave", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ message: "Database unavailable. Start MongoDB and try again." });
  }

  const room = await loadAuthorizedRoom(req.params.roomId, req.user);

  if (room === null) {
    return res.status(404).json({ message: "Study room not found" });
  }

  if (room === false) {
    return res.status(403).json({ message: "You are not a member of this study room" });
  }

  const currentMember = room.members.find((member) => member.email === req.user.email);
  if (!currentMember) {
    return res.status(403).json({ message: "You are not a member of this study room" });
  }

  const remainingMembers = room.members
    .filter((member) => member.email !== req.user.email)
    .map((member) => ({
      userId: member.userId,
      name: member.name,
      email: member.email,
      status: member.status,
      role: member.role
    }));

  if (!remainingMembers.length) {
    await ChatMessage.deleteMany({ roomId: room._id });
    await ChatRoom.deleteOne({ _id: room._id });

    return res.json({
      message: "You left the room. The room was deleted because no members were left.",
      roomDeleted: true,
      roomId: String(room._id)
    });
  }

  if (currentMember.role === "owner") {
    remainingMembers[0].role = "owner";
  }

  room.members = remainingMembers;
  await room.save();

  return res.json({
    message: "You left the room successfully.",
    roomDeleted: false,
    room: serializeRoom(room)
  });
});

router.delete("/:roomId", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ message: "Database unavailable. Start MongoDB and try again." });
  }

  const room = await loadAuthorizedRoom(req.params.roomId, req.user);

  if (room === null) {
    return res.status(404).json({ message: "Study room not found" });
  }

  if (room === false) {
    return res.status(403).json({ message: "You do not have access to this study room" });
  }

  const currentMember = room.members.find((member) => member.email === req.user.email);
  if (currentMember?.role !== "owner") {
    return res.status(403).json({ message: "Only the room owner can delete this study room" });
  }

  await ChatMessage.deleteMany({ roomId: room._id });
  await ChatRoom.deleteOne({ _id: room._id });

  return res.json({
    message: "Study room deleted successfully.",
    roomId: String(room._id)
  });
});

module.exports = router;
