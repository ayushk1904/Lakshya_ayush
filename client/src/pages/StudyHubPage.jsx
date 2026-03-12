import { Bot, Mic, Send, Sparkles, Users, Video } from "lucide-react";
import { useEffect, useState } from "react";
import { chatApi } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { fallbackChat } from "../data/demoData";

function StudyHubPage() {
  const { user } = useAuth();
  const [room, setRoom] = useState(fallbackChat.rooms[0]);
  const [messages, setMessages] = useState(fallbackChat.messages);
  const [members, setMembers] = useState(fallbackChat.members);
  const [invites, setInvites] = useState(fallbackChat.invites);
  const [draft, setDraft] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");
  const [isInviting, setIsInviting] = useState(false);

  function syncRoomState(nextRoom) {
    setRoom(nextRoom);
    setMembers(nextRoom?.members || []);
    setInvites(nextRoom?.invites || []);
  }

  useEffect(() => {
    if (user) {
      setMembers([{ name: user.name, email: user.email, status: "online", role: "owner" }]);
    }

    chatApi
      .listRooms()
      .then((data) => {
        const firstRoom = data.rooms[0];
        if (firstRoom) {
          syncRoomState(firstRoom);
          return chatApi.roomMessages(firstRoom._id);
        }
        return null;
      })
      .then((messageData) => {
        if (messageData?.messages) {
          setMessages(messageData.messages);
        }

        if (messageData?.room) {
          syncRoomState(messageData.room);
        }
      })
      .catch(() => {});
  }, [user]);

  async function sendMessage() {
    if (!room?._id || !draft.trim()) {
      return;
    }

    const optimistic = {
      _id: `draft-${Date.now()}`,
      user: { name: "You" },
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      text: draft
    };

    setMessages((current) => [...current, optimistic]);
    setDraft("");

    try {
      const data = await chatApi.sendMessage(room._id, { text: optimistic.text });
      setMessages(data.messages);
    } catch {}
  }

  async function inviteMember() {
    if (!room?._id || !inviteEmail.trim()) {
      return;
    }

    setIsInviting(true);
    setInviteError("");
    setInviteSuccess("");

    try {
      const data = await chatApi.inviteByEmail(room._id, { email: inviteEmail });
      syncRoomState(data.room);
      setInviteSuccess(`Invitation sent to ${inviteEmail.trim()}`);
      setInviteEmail("");
    } catch (error) {
      setInviteError(error.message);
    } finally {
      setIsInviting(false);
    }
  }

  return (
    <div className="study-hub-layout">
      <section className="hub-chat-panel">
        <div className="hub-header">
          <div className="panel-title">
            <Users size={18} />
            <div>
              <h2>{room.name}</h2>
              <p>{room.onlineCount || 3} online</p>
            </div>
          </div>
          <div className="hub-actions">
            <button className="icon-action">
              <Mic size={16} />
            </button>
            <button className="icon-action">
              <Video size={16} />
            </button>
          </div>
        </div>

        <div className="message-list">
          {messages.map((message) => (
            <div className="message-row" key={message._id}>
              <div className={`avatar ${message.user?.role === "ai" || message.user?.name === "AI Assistant" ? "ai-avatar" : ""}`}>
                {message.user?.role === "ai" || message.user?.name === "AI Assistant" ? <Sparkles size={15} /> : message.user?.name?.charAt(0)}
              </div>
              <div className="message-content">
                <div className="message-meta">
                  <strong>{message.user?.name}</strong>
                  <span>{message.time}</span>
                </div>
                <p>{message.text}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="chat-input-row">
          <input value={draft} onChange={(e) => setDraft(e.target.value)} type="text" placeholder="Type a message..." />
          <button className="send-button" type="button" onClick={sendMessage}>
            <Send size={18} />
          </button>
        </div>
      </section>

      <aside className="hub-sidebar">
        <h3>Online Members</h3>
        <div className="invite-card">
          <h4>Invite by email</h4>
          <div className="invite-row">
            <input
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              type="email"
              placeholder="friend@example.com"
            />
            <button className="primary-button" type="button" onClick={inviteMember} disabled={isInviting}>
              {isInviting ? "Sending..." : "Invite"}
            </button>
          </div>
          {inviteError ? <div className="error-banner">{inviteError}</div> : null}
          {inviteSuccess ? <div className="success-banner">{inviteSuccess}</div> : null}
        </div>
        <div className="member-list">
          {members.map((member) => (
            <div className="member-row" key={member.email || member.name}>
              <div className="member-left">
                <div className="member-badge">{member.name.charAt(0)}</div>
                <div className="member-copy">
                  <span>{member.name}</span>
                  <small>{member.email}</small>
                </div>
              </div>
              <span className={`status-dot ${member.status}`} />
            </div>
          ))}
        </div>
        <div className="invite-list-panel">
          <h4>Pending Invites</h4>
          {invites.length ? (
            <div className="invite-list">
              {invites.map((invite) => (
                <div className="invite-pill" key={invite.email}>
                  <strong>{invite.invitedName || invite.email}</strong>
                  <span>{invite.email}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted-copy">No pending invites yet.</p>
          )}
        </div>
        <div className="assistant-tip">
          <div className="panel-title">
            <Bot size={18} />
            <h4>AI Assistant</h4>
          </div>
          <p>Ask questions with "?" to get AI help directly in the room.</p>
        </div>
      </aside>
    </div>
  );
}

export default StudyHubPage;
