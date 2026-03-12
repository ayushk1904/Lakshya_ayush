import { Bot, Mic, Send, Sparkles, Users, Video } from "lucide-react";
import { useEffect, useState } from "react";
import { chatApi } from "../api/client";
import { fallbackChat } from "../data/demoData";

function StudyHubPage() {
  const [room, setRoom] = useState(fallbackChat.rooms[0]);
  const [messages, setMessages] = useState(fallbackChat.messages);
  const [members] = useState(fallbackChat.members);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    chatApi
      .listRooms()
      .then((data) => {
        const firstRoom = data.rooms[0];
        if (firstRoom) {
          setRoom(firstRoom);
          return chatApi.roomMessages(firstRoom._id);
        }
        return null;
      })
      .then((messageData) => {
        if (messageData?.messages) {
          setMessages(messageData.messages);
        }
      })
      .catch(() => {});
  }, []);

  async function sendMessage() {
    if (!draft.trim()) {
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
        <div className="member-list">
          {members.map((member) => (
            <div className="member-row" key={member.name}>
              <div className="member-left">
                <div className="member-badge">{member.name.charAt(0)}</div>
                <span>{member.name}</span>
              </div>
              <span className={`status-dot ${member.status}`} />
            </div>
          ))}
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
