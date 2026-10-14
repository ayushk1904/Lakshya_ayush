import { Camera, Check, Copy, CornerUpLeft, FileText, Image as ImageIcon, Link2, Maximize2, MessageSquare, Mic, MicOff, Minimize2, MonitorUp, MoreHorizontal, Paperclip, PencilLine, PhoneOff, Plus, Send, Settings, UserPlus, Users, Video, VideoOff, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { chatApi, examApi } from "../api/client";
import lakshyaAiLogo from "../assets/lakshya-ai-logo.png";
import lakshyaAiLogoDark from "../assets/lakshya-ai-logo-dark.png";
import lakshyaAiLogoMidnight from "../assets/lakshya-ai-logo-midnight.png";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { fallbackChat } from "../data/demoData";
import "./StudyHubPage.css";

// Invite links must open the public site even when the app is running locally.
const PUBLIC_APP_URL = (import.meta.env.VITE_PUBLIC_APP_URL?.trim() || "https://lakshya-ayush.vercel.app").replace(/\/$/, "");

function StudyHubPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, avatarUrl } = useAuth();
  const { theme } = useTheme();
  const [rooms, setRooms] = useState([fallbackChat.rooms[0]]);
  const [room, setRoom] = useState(fallbackChat.rooms[0]);
  const [messages, setMessages] = useState(fallbackChat.messages);
  const [members, setMembers] = useState(fallbackChat.members);
  const [invites, setInvites] = useState(fallbackChat.invites);
  const [incomingInvites, setIncomingInvites] = useState([]);
  const [draft, setDraft] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");
  const [isInviting, setIsInviting] = useState(false);
  const [micEnabled, setMicEnabled] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [permissionError, setPermissionError] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [activeCall, setActiveCall] = useState(null);
  const [isChatExpanded, setIsChatExpanded] = useState(false);
  const [isRoomSettingsOpen, setIsRoomSettingsOpen] = useState(false);
  const [isExpandedRoomSettingsOpen, setIsExpandedRoomSettingsOpen] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [replyTarget, setReplyTarget] = useState(null);
  const [activeMessageMenu, setActiveMessageMenu] = useState(null);
  const [roomSettings, setRoomSettings] = useState({
    name: fallbackChat.rooms[0].name,
    avatarUrl: fallbackChat.rooms[0].avatarUrl || ""
  });
  const [createRoomForm, setCreateRoomForm] = useState({
    name: "",
    inviteEmails: ""
  });
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [isEditingRoomSettings, setIsEditingRoomSettings] = useState(false);
  const [isSavingRoomSettings, setIsSavingRoomSettings] = useState(false);
  const [pendingRoomAction, setPendingRoomAction] = useState("");
  const [isLeavingRoom, setIsLeavingRoom] = useState(false);
  const [isDeletingRoom, setIsDeletingRoom] = useState(false);
  const [processingInviteRoomId, setProcessingInviteRoomId] = useState("");
  const [joiningPracticeInviteId, setJoiningPracticeInviteId] = useState("");
  const [linkInvite, setLinkInvite] = useState(null);
  const [isJoiningByLink, setIsJoiningByLink] = useState(false);
  const [inviteLinkCopied, setInviteLinkCopied] = useState(false);
  const micStreamRef = useRef(null);
  const cameraStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const localVideoRef = useRef(null);
  const attachmentInputRef = useRef(null);
  const roomAvatarInputRef = useRef(null);
  const isEditingRoomSettingsRef = useRef(false);
  const messageListRef = useRef(null);

  function isMongoRoomId(value) {
    return /^[a-f\d]{24}$/i.test(String(value || "").trim());
  }

  function getRoomInitials(name) {
    return String(name || "Study Room")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || "")
      .join("") || "SR";
  }

  async function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsDataURL(file);
    });
  }

  function syncRoomState(nextRoom, options = {}) {
    const shouldPreserveDraft = Boolean(options.preserveDraft && isEditingRoomSettingsRef.current);
    setRoom(nextRoom);
    setMembers(nextRoom?.members || []);
    setInvites(nextRoom?.invites || []);

    if (!shouldPreserveDraft) {
      setRoomSettings({
        name: nextRoom?.name || "",
        avatarUrl: nextRoom?.avatarUrl || ""
      });
      setIsEditingRoomSettings(false);
    }
  }

  useEffect(() => {
    isEditingRoomSettingsRef.current = isEditingRoomSettings;
  }, [isEditingRoomSettings]);

  useEffect(() => {
    setPendingRoomAction("");
  }, [room?._id]);

  const currentUserEmail = String(user?.email || "")
    .trim()
    .toLowerCase();
  const isRoomOwner = members.some((member) => String(member.email || "").trim().toLowerCase() === currentUserEmail && member.role === "owner");

  async function refreshIncomingInvites() {
    if (!user) {
      return;
    }

    try {
      const invitesData = await chatApi.listInvitations();
      setIncomingInvites(invitesData.invites || []);
    } catch {
      // Ignore transient polling failures.
    }
  }

  async function loadRoomsAndInvites(selectedRoomId) {
    if (!user) return;

    try {
      const [roomsData, invitesData] = await Promise.all([chatApi.listRooms(), chatApi.listInvitations()]);
      const fetchedRooms = roomsData.rooms || [];
      setRooms(fetchedRooms);
      setIncomingInvites(invitesData.invites || []);

      const selectedRoom = fetchedRooms.find((r) => r._id === selectedRoomId) || fetchedRooms[0];
      if (!selectedRoom) {
        return;
      }

      syncRoomState(selectedRoom);
      const messageData = await chatApi.roomMessages(selectedRoom._id);
      if (messageData?.messages) {
        setMessages(messageData.messages);
      }
      if (messageData?.room) {
        syncRoomState(messageData.room);
      }
    } catch (error) {
      // ignore for now
    }
  }

  useEffect(() => {
    if (user) {
      setMembers([{ name: user.name, email: user.email, status: "online", role: "owner" }]);
    }
    loadRoomsAndInvites(searchParams.get("room") || undefined);
  }, [user]);

  // Someone opened a shared invite link (/app/hub?join=<code>): show who invited them and let them join.
  useEffect(() => {
    const code = searchParams.get("join");
    if (!user || !code) {
      return;
    }

    setLinkInvite({ code, room: null, alreadyMember: false, error: "" });
    chatApi
      .previewJoin(code)
      .then((data) => setLinkInvite({ code, room: data.room, alreadyMember: data.alreadyMember, error: "" }))
      .catch((error) => setLinkInvite({ code, room: null, alreadyMember: false, error: error.message }));
  }, [user, searchParams]);

  function dismissLinkInvite() {
    setLinkInvite(null);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("join");
      return next;
    }, { replace: true });
  }

  async function joinRoomFromLink() {
    if (!linkInvite?.code || isJoiningByLink) {
      return;
    }

    setIsJoiningByLink(true);

    try {
      const data = await chatApi.joinByCode(linkInvite.code);
      dismissLinkInvite();
      await loadRoomsAndInvites(data.room?._id);
      setInviteSuccess(data.alreadyMember ? "You're already in this room." : `You joined ${data.room?.name || "the study room"}.`);
    } catch (error) {
      setLinkInvite((current) => (current ? { ...current, error: error.message } : current));
    } finally {
      setIsJoiningByLink(false);
    }
  }

  useEffect(() => {
    if (!user) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      refreshIncomingInvites();
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, [user]);

  useEffect(() => {
    if (!user || !room?._id || !isMongoRoomId(room._id)) {
      return undefined;
    }

    const intervalId = window.setInterval(async () => {
      try {
        const messageData = await chatApi.roomMessages(room._id);
        if (messageData?.messages) {
          setMessages(messageData.messages);
        }
        if (messageData?.room) {
          syncRoomState(messageData.room, { preserveDraft: true });
        }
      } catch {
        // Ignore transient polling failures.
      }
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, [user, room?._id]);

  useEffect(() => {
    if (!localVideoRef.current) {
      return;
    }

    localVideoRef.current.srcObject = screenStreamRef.current || cameraStreamRef.current || null;
  }, [cameraEnabled, screenSharing, activeCall]);

  useEffect(() => {
    return () => {
      micStreamRef.current?.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (!isChatExpanded) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isChatExpanded]);

  useEffect(() => {
    if (!messageListRef.current) {
      return;
    }

    messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
  }, [messages, isChatExpanded, room?._id]);

  async function sendMessage() {
    if (!room?._id || (!draft.trim() && !attachments.length) || isSending) {
      return;
    }

    const messageText = draft.trim();
    const optimistic = {
      _id: `draft-${Date.now()}`,
      user: { name: user?.name || "You", email: user?.email || "", avatarUrl: avatarUrl || "", isCurrentUser: true },
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      text: messageText,
      kind: "message",
      attachments,
      replyTo: replyTarget
        ? {
            messageId: replyTarget._id,
            userName: replyTarget.user?.name || "Student",
            text: replyTarget.text || replyTarget.attachments?.[0]?.name || replyTarget.attachments?.[0]?.url || ""
          }
        : null
    };

    setMessages((current) => [...current, optimistic]);
    setDraft("");
    setAttachments([]);
    setReplyTarget(null);
    setIsSending(true);

    try {
      const data = await chatApi.sendMessage(room._id, {
        text: optimistic.text,
        attachments: optimistic.attachments,
        replyToMessageId: replyTarget?._id || ""
      });
      setMessages(data.messages);
    } catch (error) {
      setMessages((current) => current.filter((message) => message._id !== optimistic._id));
      setInviteError(error.message);
    } finally {
      setIsSending(false);
    }
  }

  async function handleDeleteMessage(messageId, mode) {
    if (!room?._id || !messageId) {
      return;
    }

    try {
      const data = await chatApi.deleteMessage(room._id, messageId, { mode });
      setMessages(data.messages || []);
      setActiveMessageMenu(null);
      if (replyTarget?._id === messageId) {
        setReplyTarget(null);
      }
    } catch (error) {
      setInviteError(error.message);
    }
  }

  async function handleAttachmentSelection(event) {
    const selectedFiles = Array.from(event.target.files || []);
    if (!selectedFiles.length) {
      return;
    }

    const nextAttachments = await Promise.all(
      selectedFiles.slice(0, 6).map(
        (file) =>
          new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const mimeType = file.type || "";
              const type = mimeType.startsWith("image/")
                ? "image"
                : /(pdf|word|text|sheet|officedocument|presentation)/i.test(mimeType) || /\.(pdf|doc|docx|txt|ppt|pptx|xls|xlsx)$/i.test(file.name)
                  ? "document"
                  : "file";

              resolve({
                type,
                name: file.name,
                url: String(reader.result || ""),
                mimeType,
                size: file.size
              });
            };
            reader.onerror = () => reject(new Error("Failed to read file"));
            reader.readAsDataURL(file);
          })
      )
    ).catch(() => []);

    setAttachments((current) => [...current, ...nextAttachments].slice(0, 6));
    event.target.value = "";
  }

  function addLinkAttachment() {
    const url = window.prompt("Paste the link you want to send");
    if (!url) {
      return;
    }

    try {
      const parsed = new URL(url);
      setAttachments((current) => [
        ...current,
        {
          type: "link",
          name: parsed.hostname,
          url: parsed.toString(),
          mimeType: "text/uri-list",
          size: 0
        }
      ].slice(0, 6));
    } catch {
      setInviteError("Please enter a valid link.");
    }
  }

  function removeAttachment(indexToRemove) {
    setAttachments((current) => current.filter((_, index) => index !== indexToRemove));
  }

  async function handleRoomAvatarSelection(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      setRoomSettings((current) => ({ ...current, avatarUrl: dataUrl }));
      setIsEditingRoomSettings(true);
      setInviteError("");
    } catch (error) {
      setInviteError(error.message || "Unable to load room avatar.");
    } finally {
      event.target.value = "";
    }
  }

  function triggerRoomAvatarPicker() {
    roomAvatarInputRef.current?.click();
  }

  async function saveRoomSettings() {
    if (!room?._id || !roomSettings.name.trim() || isSavingRoomSettings) {
      return;
    }

    setIsSavingRoomSettings(true);
    setInviteError("");
    setInviteSuccess("");

    try {
      const data = await chatApi.updateRoomSettings(room._id, {
        name: roomSettings.name.trim(),
        avatarUrl: roomSettings.avatarUrl
      });

      const updatedRoom = data.room;
      setRooms((current) => current.map((item) => (item._id === updatedRoom._id ? updatedRoom : item)));
      syncRoomState(updatedRoom);
      setIsEditingRoomSettings(false);
      setInviteSuccess(data.message || "Study room updated successfully.");
    } catch (error) {
      setInviteError(error.message);
    } finally {
      setIsSavingRoomSettings(false);
    }
  }

  async function createStudyRoom() {
    if (!createRoomForm.name.trim() || isCreatingRoom) {
      return;
    }

    setIsCreatingRoom(true);
    setInviteError("");
    setInviteSuccess("");

    try {
      const invitedEmails = createRoomForm.inviteEmails
        .split(/[,\n]/)
        .map((email) => email.trim())
        .filter(Boolean);

      const data = await chatApi.createRoom({
        name: createRoomForm.name.trim(),
        invitedEmails
      });

      const createdRoom = data.room;
      setCreateRoomForm({ name: "", inviteEmails: "" });
      setRooms((current) => [createdRoom, ...current.filter((item) => item._id !== createdRoom._id)]);
      syncRoomState(createdRoom);

      const messageData = await chatApi.roomMessages(createdRoom._id);
      if (messageData?.messages) {
        setMessages(messageData.messages);
      }
      if (messageData?.room) {
        syncRoomState(messageData.room);
      }

      setInviteSuccess(data.message || "Study room created successfully.");
    } catch (error) {
      setInviteError(error.message);
    } finally {
      setIsCreatingRoom(false);
    }
  }

  async function openRoom(roomId) {
    if (!roomId || roomId === room?._id) {
      return;
    }

    setInviteError("");
    setInviteSuccess("");
    await loadRoomsAndInvites(roomId);
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
      await loadRoomsAndInvites(room._id);
    } catch (error) {
      setInviteError(error.message);
    } finally {
      setIsInviting(false);
    }
  }

  async function acceptInvitation(roomId) {
    setProcessingInviteRoomId(roomId);
    setInviteError("");
    setInviteSuccess("");

    try {
      await chatApi.acceptInvitation(roomId);
      await loadRoomsAndInvites(roomId);
      setInviteSuccess("Invitation accepted. You can now chat in the room.");
    } catch (error) {
      setInviteError(error.message);
    } finally {
      setProcessingInviteRoomId("");
    }
  }

  async function rejectInvitation(roomId) {
    setProcessingInviteRoomId(roomId);
    setInviteError("");
    setInviteSuccess("");

    try {
      await chatApi.rejectInvitation(roomId);
      await loadRoomsAndInvites();
      setInviteSuccess("Invitation rejected.");
    } catch (error) {
      setInviteError(error.message);
    } finally {
      setProcessingInviteRoomId("");
    }
  }

  async function openCallScreen() {
    try {
      if (!micEnabled) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micStreamRef.current = stream;
      }
      setMicEnabled(true);
      setActiveCall("room");
      setPermissionError("");
    } catch (error) {
      setPermissionError("Please allow microphone permission to use this feature.");
      setMicEnabled(false);
    }
  }

  async function leaveRoom() {
    if (!room?._id || isLeavingRoom) {
      return;
    }

    setIsLeavingRoom(true);
    setInviteError("");
    setInviteSuccess("");

    try {
      const data = await chatApi.leaveRoom(room._id);
      setPendingRoomAction("");
      setInviteEmail("");
      await loadRoomsAndInvites();
      setInviteSuccess(data.message || "You left the room successfully.");
    } catch (error) {
      setInviteError(error.message);
    } finally {
      setIsLeavingRoom(false);
    }
  }

  async function deleteRoom() {
    if (!room?._id || isDeletingRoom) {
      return;
    }

    setIsDeletingRoom(true);
    setInviteError("");
    setInviteSuccess("");

    try {
      const data = await chatApi.deleteRoom(room._id);
      setPendingRoomAction("");
      setInviteEmail("");
      await loadRoomsAndInvites();
      setInviteSuccess(data.message || "Study room deleted successfully.");
    } catch (error) {
      setInviteError(error.message);
    } finally {
      setIsDeletingRoom(false);
    }
  }

  async function handleMicClick() {
    try {
      if (micEnabled) {
        micStreamRef.current?.getTracks().forEach((track) => track.stop());
        micStreamRef.current = null;
        setMicEnabled(false);
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      setMicEnabled(true);
      setPermissionError("");
    } catch (error) {
      setPermissionError("Please allow microphone permission to use this feature.");
      setMicEnabled(false);
    }
  }

  async function handleCameraClick() {
    try {
      if (cameraEnabled) {
        cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
        cameraStreamRef.current = null;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = screenStreamRef.current || null;
        }
        setCameraEnabled(false);
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });

      cameraStreamRef.current = stream;
      if (localVideoRef.current && !screenStreamRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      setCameraEnabled(true);
      setPermissionError("");
    } catch (error) {
      setPermissionError("Please allow camera permission to use this feature.");
      setCameraEnabled(false);
    }
  }

  async function handleScreenShareClick() {
    try {
      if (screenSharing) {
        screenStreamRef.current?.getTracks().forEach((track) => track.stop());
        screenStreamRef.current = null;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = cameraStreamRef.current || null;
        }
        setScreenSharing(false);
        return;
      }

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false
      });

      const [screenTrack] = stream.getVideoTracks();
      if (screenTrack) {
        screenTrack.onended = () => {
          screenStreamRef.current = null;
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = cameraStreamRef.current || null;
          }
          setScreenSharing(false);
        };
      }

      screenStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      setScreenSharing(true);
      setPermissionError("");
    } catch (error) {
      setPermissionError("Please allow screen sharing to present your Windows screen.");
      setScreenSharing(false);
    }
  }

  function closeCallScreen() {
    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;
    cameraStreamRef.current = null;
    screenStreamRef.current = null;
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    setMicEnabled(false);
    setCameraEnabled(false);
    setScreenSharing(false);
    setActiveCall(null);
  }

  function generateInviteLink() {
    if (!room?.inviteCode) {
      setInviteError("Invite link isn't ready yet. Please wait a moment and try again.");
      return "";
    }

    return `${PUBLIC_APP_URL}/app/hub?join=${room.inviteCode}`;
  }

  function inviteViaWhatsApp() {
    const inviteLink = generateInviteLink();
    if (!inviteLink) {
      return;
    }

    const message = `Join my Lakshya Study Room "${room.name}": ${inviteLink}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank", "noopener");
  }

  async function copyInviteLink() {
    const inviteLink = generateInviteLink();
    if (!inviteLink) {
      return;
    }

    try {
      await navigator.clipboard.writeText(inviteLink);
      setInviteLinkCopied(true);
      window.setTimeout(() => setInviteLinkCopied(false), 2500);
    } catch {
      setInviteError(`Couldn't copy automatically. Share this link: ${inviteLink}`);
    }
  }

  const placeholder = draft.startsWith("@ai")
    ? "Ask AI anything about this question..."
    : 'Type a message or use "@ai explain this question..."';
  const aiAvatarLogo = theme === "dark" ? lakshyaAiLogoDark : theme === "midnight" ? lakshyaAiLogoMidnight : lakshyaAiLogo;

  function getMessageAvatar(message) {
    const isAiMessage =
      message.user?.role === "ai" || message.user?.name === "Lakshya AI" || message.user?.name === "AI Assistant";

    if (isAiMessage) {
      return { kind: "ai", src: aiAvatarLogo };
    }

    const isCurrentUserMessage =
      String(message.user?.email || "")
        .trim()
        .toLowerCase() === currentUserEmail || Boolean(message.user?.isCurrentUser);

    if (isCurrentUserMessage && avatarUrl) {
      return { kind: "image", src: avatarUrl };
    }

    if (message.user?.avatarUrl) {
      return { kind: "image", src: message.user.avatarUrl };
    }

    return { kind: "initial", text: message.user?.name?.charAt(0) || "S" };
  }

  function hasJoinedPracticeInvite(message) {
    return message.practiceInvite?.joiners?.some(
      (joiner) => String(joiner.email || "").trim().toLowerCase() === String(user?.email || "").trim().toLowerCase()
    );
  }

  function formatPracticeInviteTime(value) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "Starts soon";
    }

    return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(date);
  }

  function isOwnPracticeInvite(message) {
    return String(message.practiceInvite?.invitedByEmail || "").trim().toLowerCase() === String(user?.email || "").trim().toLowerCase();
  }

  function renderMessages(listClassName = "message-list") {
    return (
      <div ref={messageListRef} className={listClassName}>
        {messages.map((message) => (
          <div className={`message-row ${message.kind === "reaction" ? "message-row-reaction" : ""}`} key={message._id}>
            <div className={`avatar ${getMessageAvatar(message).kind === "ai" ? "ai-avatar" : ""}`}>
              {getMessageAvatar(message).kind === "ai" ? (
                <img className="ai-avatar-logo" src={getMessageAvatar(message).src} alt="Lakshya AI" />
              ) : getMessageAvatar(message).kind === "image" ? (
                <img className="message-avatar-image" src={getMessageAvatar(message).src} alt={message.user?.name || "Student"} />
              ) : (
                getMessageAvatar(message).text
              )}
            </div>
            <div className="message-content">
              <div className="message-meta">
                <strong>{message.user?.role === "ai" || message.user?.name === "AI Assistant" ? "Lakshya AI" : message.user?.name}</strong>
                <span>{message.time}</span>
                {message.kind === "reaction" ? <em className="message-kind-pill">Reacted</em> : null}
                <div className="message-actions">
                  <button className="message-action-button" type="button" onClick={() => setReplyTarget(message)}>
                    <CornerUpLeft size={14} />
                    Reply
                  </button>
                  {message.user?.email === user?.email ? (
                    <div className="message-menu-shell">
                      <button
                        className="message-action-button"
                        type="button"
                        onClick={() => setActiveMessageMenu((current) => (current === message._id ? null : message._id))}
                      >
                        <MoreHorizontal size={14} />
                        Delete
                      </button>
                      {activeMessageMenu === message._id ? (
                        <div className="message-menu">
                          <button type="button" onClick={() => handleDeleteMessage(message._id, "everyone")}>
                            Delete for everyone
                          </button>
                          <button type="button" onClick={() => handleDeleteMessage(message._id, "me")}>
                            Delete for me
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
              {message.replyTo ? (
                <div className="reply-pill">
                  <strong>Replying to {message.replyTo.userName}</strong>
                  <span>{message.replyTo.text}</span>
                </div>
              ) : null}
              {message.text ? <p>{message.text}</p> : null}
              {message.practiceInvite ? (
                <div className="practice-invite-card">
                  <div className="practice-invite-copy">
                    <span className="message-kind-pill">Practice Test Invite</span>
                    <strong>{message.practiceInvite.title || "Shared Practice Test"}</strong>
                    <span>{formatPracticeInviteTime(message.practiceInvite.startAt)}</span>
                    <span>{`${message.practiceInvite.marks || 80} marks - ${message.practiceInvite.durationMinutes || 60} min`}</span>
                    {message.practiceInvite.joiners?.length ? (
                      <small>
                        Joined:{" "}
                        {message.practiceInvite.joiners
                          .map((joiner) => joiner.name || joiner.email || "Student")
                          .filter(Boolean)
                          .join(", ")}
                      </small>
                    ) : (
                      <small>Click join and this test will appear in your Practice Tests page.</small>
                    )}
                  </div>
                  <div className="practice-invite-actions">
                    <button
                      className="primary-button compact"
                      type="button"
                      onClick={async () => {
                        if (!message.practiceInvite?.inviteId || joiningPracticeInviteId) {
                          return;
                        }

                        setJoiningPracticeInviteId(message.practiceInvite.inviteId);
                        setInviteError("");
                        setInviteSuccess("");

                        try {
                          const data = await examApi.joinSharedInvite(message.practiceInvite.inviteId);
                          setMessages((current) =>
                            current.map((entry) =>
                              entry._id === message._id
                                ? {
                                    ...entry,
                                    practiceInvite: {
                                      ...entry.practiceInvite,
                                      joiners: data.alreadyJoined
                                        ? entry.practiceInvite?.joiners || []
                                        : [
                                            ...(entry.practiceInvite?.joiners || []),
                                            {
                                              email: user?.email || "",
                                              name: user?.name || "You",
                                              sessionId: data.session?._id || "",
                                              joinedAt: new Date().toISOString()
                                            }
                                          ]
                                    }
                                  }
                                : entry
                            )
                          );
                          setInviteSuccess(
                            data.alreadyJoined
                              ? "You already joined this shared practice test. Opening Practice Tests."
                              : "You joined the shared practice test. Opening Practice Tests."
                          );
                          navigate("/app/tests");
                        } catch (error) {
                          setInviteError(error.message);
                        } finally {
                          setJoiningPracticeInviteId("");
                        }
                      }}
                      disabled={
                        joiningPracticeInviteId === message.practiceInvite.inviteId ||
                        hasJoinedPracticeInvite(message) ||
                        isOwnPracticeInvite(message)
                      }
                    >
                      {isOwnPracticeInvite(message)
                        ? "Shared by You"
                        : hasJoinedPracticeInvite(message)
                        ? "Joined"
                        : joiningPracticeInviteId === message.practiceInvite.inviteId
                          ? "Joining..."
                          : "Join Test"}
                    </button>
                  </div>
                </div>
              ) : null}
              {message.attachments?.length ? (
                <div className="attachment-list">
                  {message.attachments.map((attachment, index) => (
                    <a
                      className={`attachment-card attachment-${attachment.type}`}
                      key={`${message._id}-${index}-${attachment.url}`}
                      href={attachment.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {attachment.type === "image" ? <ImageIcon size={16} /> : attachment.type === "link" ? <Link2 size={16} /> : <FileText size={16} />}
                      <span>{attachment.name || attachment.url}</span>
                    </a>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    );
  }

  function renderRoomSettingsContent(options = {}) {
    const closeSettings = options.onClose || (() => setIsRoomSettingsOpen(false));
    const drawerClassName = options.className ? `room-settings-drawer ${options.className}` : "room-settings-drawer";

    return (
      <aside className={drawerClassName}>
        <div className="room-settings-drawer-header">
          <button className="icon-action" type="button" onClick={closeSettings}>
            <X size={18} />
          </button>
          <strong>Room Settings</strong>
        </div>

        <div className="room-settings-drawer-scroll">
          <section className="room-settings-drawer-hero">
            <button
              className="hub-room-avatar hub-room-avatar-large hub-room-avatar-button"
              type="button"
              onClick={triggerRoomAvatarPicker}
              aria-label="Upload room avatar"
              title="Upload room avatar"
            >
              {roomSettings.avatarUrl ? <img src={roomSettings.avatarUrl} alt="" /> : <span>{getRoomInitials(roomSettings.name)}</span>}
              <span className="hub-room-avatar-badge">
                <Camera size={14} />
              </span>
            </button>
            <h3>{roomSettings.name || "Study Room"}</h3>
            <p>{members.length} active in this room</p>
          </section>

          <section className="room-settings-drawer-card">
            <div className="room-settings-drawer-card-head">
              <span className="room-settings-page-eyebrow">Notifications</span>
              <h4>Room Requests</h4>
            </div>
            {incomingInvites.length ? (
              <div className="invite-list room-settings-notification-list">
                {incomingInvites.map((invite) => {
                  const isProcessingInvite = processingInviteRoomId === invite.roomId;

                  return (
                    <div className="invite-pill room-settings-notification-card" key={invite.roomId}>
                      <div className="room-settings-notification-copy">
                        <strong>{invite.roomName}</strong>
                        <span>{invite.invitedBy ? `${invite.invitedBy} invited you to join this study room.` : "You have a new study room request."}</span>
                      </div>
                      <div className="room-settings-notification-actions">
                        <button className="primary-button compact" type="button" onClick={() => acceptInvitation(invite.roomId)} disabled={isProcessingInvite}>
                          {isProcessingInvite ? "Updating..." : "Accept"}
                        </button>
                        <button className="secondary-button compact" type="button" onClick={() => rejectInvitation(invite.roomId)} disabled={isProcessingInvite}>
                          Decline
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="room-settings-muted-note">No pending room invitations right now.</p>
            )}
          </section>

          <section className="room-settings-drawer-card">
            <div className="room-settings-drawer-card-head">
              <span className="room-settings-page-eyebrow">Invite</span>
              <h4>Invite Members</h4>
            </div>
            <div className="invite-row">
              <label className="planner-field room-settings-field room-settings-inline-field">
                <span>Friend Email</span>
                <div className="account-input-shell">
                  <MessageSquare size={16} />
                  <input
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        inviteMember();
                      }
                    }}
                    type="email"
                    placeholder="friend@example.com"
                  />
                </div>
              </label>
              <button className="primary-button" type="button" onClick={inviteMember} disabled={isInviting}>
                {isInviting ? "Sending..." : "Invite"}
              </button>
            </div>

            <div className="invite-share-row">
              <button className="secondary-button" type="button" onClick={inviteViaWhatsApp}>
                <MessageSquare size={16} />
                Invite via WhatsApp
              </button>
              <button className="secondary-button" type="button" onClick={copyInviteLink}>
                {inviteLinkCopied ? <Check size={16} /> : <Copy size={16} />}
                {inviteLinkCopied ? "Link copied" : "Copy invite link"}
              </button>
            </div>
            <p className="room-settings-muted-note">Anyone with the link can join this room after logging in.</p>

            {inviteError ? <div className="error-banner">{inviteError}</div> : null}
            {inviteSuccess ? <div className="success-banner">{inviteSuccess}</div> : null}
          </section>

          {invites.length ? (
            <section className="room-settings-drawer-card">
              <div className="room-settings-drawer-card-head">
                <span className="room-settings-page-eyebrow">Pending</span>
                <h4>Pending Invites</h4>
              </div>
              <div className="invite-list">
                {invites.map((invite) => (
                  <div className="invite-pill" key={invite.email}>
                    <strong>{invite.invitedName || invite.email}</strong>
                    <span>{invite.email}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="room-settings-drawer-card">
            <div className="room-settings-drawer-card-head">
              <span className="room-settings-page-eyebrow">Manage</span>
              <h4>Room identity</h4>
            </div>
            <div className="room-settings-page-avatar-actions room-settings-drawer-actions">
              <button className="secondary-button compact" type="button" onClick={triggerRoomAvatarPicker}>
                <Camera size={16} />
                Change Avatar
              </button>
              {roomSettings.avatarUrl ? (
                <button
                  className="secondary-button compact room-settings-remove"
                  type="button"
                  onClick={() => {
                    setRoomSettings((current) => ({ ...current, avatarUrl: "" }));
                    setIsEditingRoomSettings(true);
                  }}
                >
                  Remove Avatar
                </button>
              ) : null}
            </div>

            <label className="planner-field room-settings-field">
              <span>Study Room Name</span>
              <div className="account-input-shell">
                <PencilLine size={16} />
                <input
                  type="text"
                  value={roomSettings.name}
                  onChange={(event) => {
                    setRoomSettings((current) => ({ ...current, name: event.target.value }));
                    setIsEditingRoomSettings(true);
                  }}
                  placeholder="Enter room name"
                />
              </div>
            </label>

            <button
              className="primary-button compact room-settings-save"
              type="button"
              onClick={saveRoomSettings}
              disabled={isSavingRoomSettings || !roomSettings.name.trim()}
            >
              {isSavingRoomSettings ? "Saving..." : "Save Room"}
            </button>
          </section>

          <section className="room-settings-drawer-card">
            <div className="room-settings-drawer-card-head">
              <span className="room-settings-page-eyebrow">Rooms</span>
              <h4>Your Study Rooms</h4>
            </div>
            <div className="room-settings-room-list">
              {rooms.map((item) => (
                <button
                  key={item._id}
                  className={`room-settings-room-item ${item._id === room?._id ? "active" : ""}`}
                  type="button"
                  onClick={() => openRoom(item._id)}
                >
                  <span className="room-settings-room-avatar">
                    {item.avatarUrl ? <img src={item.avatarUrl} alt="" /> : <span>{getRoomInitials(item.name)}</span>}
                  </span>
                  <span className="room-settings-room-copy">
                    <strong>{item.name}</strong>
                    <small>{item.onlineCount || 0} online</small>
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="room-settings-drawer-card">
            <div className="room-settings-drawer-card-head">
              <span className="room-settings-page-eyebrow">Create</span>
              <h4>Create Study Room</h4>
            </div>
            <div className="room-settings-create-grid room-settings-drawer-grid">
              <label className="planner-field room-settings-field room-settings-create-field">
                <span>Room Name</span>
                <div className="account-input-shell">
                  <Plus size={16} />
                  <input
                    type="text"
                    value={createRoomForm.name}
                    onChange={(event) => setCreateRoomForm((current) => ({ ...current, name: event.target.value }))}
                    placeholder="Enter a new room name"
                  />
                </div>
              </label>

              <label className="planner-field room-settings-field room-settings-create-field">
                <span>Invite Friends</span>
                <div className="account-input-shell">
                  <MessageSquare size={16} />
                  <input
                    type="text"
                    value={createRoomForm.inviteEmails}
                    onChange={(event) => setCreateRoomForm((current) => ({ ...current, inviteEmails: event.target.value }))}
                    placeholder="Add emails separated by commas"
                  />
                </div>
              </label>
            </div>
            <button className="primary-button compact room-settings-create-trigger" type="button" onClick={createStudyRoom} disabled={isCreatingRoom || !createRoomForm.name.trim()}>
              <Plus size={16} />
              {isCreatingRoom ? "Creating..." : "Create Study Room"}
            </button>
          </section>

          <section className="room-settings-drawer-card">
            <div className="room-settings-drawer-card-head">
              <span className="room-settings-page-eyebrow">Actions</span>
              <h4>Room actions</h4>
            </div>

            <div className="room-settings-danger-stack">
              <div className="room-settings-danger-block">
                <button
                  className="secondary-button room-settings-danger-button"
                  type="button"
                  onClick={() => setPendingRoomAction((current) => (current === "leave" ? "" : "leave"))}
                  disabled={isLeavingRoom}
                >
                  {isLeavingRoom ? "Leaving..." : "Leave Room"}
                </button>
                {pendingRoomAction === "leave" ? (
                  <div className="room-settings-confirmation">
                    <p>Are you sure you want to leave room?</p>
                    <div className="room-settings-confirmation-actions">
                      <button className="primary-button compact" type="button" onClick={leaveRoom} disabled={isLeavingRoom}>
                        Yes
                      </button>
                      <button className="secondary-button compact" type="button" onClick={() => setPendingRoomAction("")} disabled={isLeavingRoom}>
                        No
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              {isRoomOwner ? (
                <div className="room-settings-danger-block">
                  <button
                    className="secondary-button room-settings-danger-button room-settings-delete-button"
                    type="button"
                    onClick={() => setPendingRoomAction((current) => (current === "delete" ? "" : "delete"))}
                    disabled={isDeletingRoom}
                  >
                    {isDeletingRoom ? "Deleting..." : "Delete Room"}
                  </button>
                  {pendingRoomAction === "delete" ? (
                    <div className="room-settings-confirmation">
                      <p>Are you sure you want to delete room?</p>
                      <div className="room-settings-confirmation-actions">
                        <button className="primary-button compact room-settings-delete-confirm" type="button" onClick={deleteRoom} disabled={isDeletingRoom}>
                          Yes
                        </button>
                        <button className="secondary-button compact" type="button" onClick={() => setPendingRoomAction("")} disabled={isDeletingRoom}>
                          No
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </aside>
    );
  }

  return (
    <div className="screen study-hub-screen">
      <input
        ref={roomAvatarInputRef}
        type="file"
        className="hidden-file-input"
        accept="image/*"
        onChange={handleRoomAvatarSelection}
      />

      <div className={`study-hub-layout ${isRoomSettingsOpen ? "study-hub-layout-split" : ""}`}>
        <section className="hub-chat-panel">
          <div className="hub-header">
            <div className="hub-room-identity">
              <button
                className="hub-room-avatar hub-room-avatar-button"
                type="button"
                onClick={() => setIsRoomSettingsOpen(true)}
                aria-label="Open room settings"
                title="Open room settings"
              >
                {room.avatarUrl ? <img src={room.avatarUrl} alt="" /> : <span>{getRoomInitials(room.name)}</span>}
                <span className="hub-room-avatar-badge">
                  <Camera size={12} />
                </span>
              </button>
              <div className="hub-room-text">
                <span className="hub-kicker">
                  <Users size={13} />
                  {room.subject || "Group study"}
                </span>
                <h2 title={room.name}>{room.name}</h2>
                <p>
                  <span className="hub-online-dot" aria-hidden="true" />
                  {room.onlineCount || 3} online &middot; {members.length} member{members.length === 1 ? "" : "s"}
                </p>
              </div>
            </div>
            <div className="hub-header-actions">
              <button className={`hub-action ${isRoomSettingsOpen ? "hub-action-active" : ""}`} type="button" onClick={() => setIsRoomSettingsOpen((current) => !current)} aria-pressed={isRoomSettingsOpen}>
                <Settings size={16} />
                <span>Room Settings</span>
              </button>
              <button className="hub-action" type="button" onClick={() => setIsChatExpanded(true)}>
                <Maximize2 size={16} />
                <span>Full Chat</span>
              </button>
              <button className={`hub-action hub-action-call ${activeCall ? "hub-action-live" : ""}`} type="button" onClick={openCallScreen}>
                {activeCall ? <Mic size={16} /> : <Video size={16} />}
                <span>{activeCall ? "In Call" : "Join Call"}</span>
              </button>
            </div>
          </div>

          {permissionError && <div className="error-banner">{permissionError}</div>}

          {renderMessages()}

          {replyTarget ? (
            <div className="reply-composer">
              <div>
                <strong>Replying to {replyTarget.user?.name}</strong>
                <span>{replyTarget.text || replyTarget.attachments?.[0]?.name || replyTarget.attachments?.[0]?.url}</span>
              </div>
              <button className="icon-action" type="button" onClick={() => setReplyTarget(null)}>
                <X size={16} />
              </button>
            </div>
          ) : null}

          {attachments.length ? (
            <div className="composer-attachments">
              {attachments.map((attachment, index) => (
                <div className="composer-attachment-pill" key={`${attachment.url}-${index}`}>
                  {attachment.type === "image" ? <ImageIcon size={14} /> : attachment.type === "link" ? <Link2 size={14} /> : <FileText size={14} />}
                  <span>{attachment.name || attachment.url}</span>
                  <button type="button" onClick={() => removeAttachment(index)}>
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <div className="chat-input-row">
            <input
              ref={attachmentInputRef}
              type="file"
              multiple
              className="hidden-file-input"
              onChange={handleAttachmentSelection}
              accept="image/*,.pdf,.doc,.docx,.txt,.ppt,.pptx,.xls,.xlsx,.zip"
            />
            <button className="message-action-button composer-action" type="button" onClick={() => attachmentInputRef.current?.click()}>
              <Paperclip size={16} />
              Attach
            </button>
            <button className="message-action-button composer-action" type="button" onClick={addLinkAttachment}>
              <Link2 size={16} />
              Link
            </button>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  sendMessage();
                }
              }}
              type="text"
              placeholder={placeholder}
            />
            <button className="send-button" type="button" onClick={sendMessage} disabled={isSending}>
              <Send size={18} />
            </button>
          </div>
        </section>

        {isRoomSettingsOpen ? renderRoomSettingsContent() : null}
      </div>

      {isChatExpanded ? (
        <div className="chatbox-page-overlay">
          <section className={`chatbox-page-panel ${isExpandedRoomSettingsOpen ? "chatbox-page-panel-split" : ""}`}>
            <div className="chatbox-page-main">
              <div className="hub-header chatbox-page-header">
                <div className="hub-room-identity">
                  <button
                    className="hub-room-avatar hub-room-avatar-button"
                    type="button"
                    onClick={() => setIsExpandedRoomSettingsOpen(true)}
                    aria-label="Open room settings"
                    title="Open room settings"
                  >
                    {room.avatarUrl ? <img src={room.avatarUrl} alt="" /> : <span>{getRoomInitials(room.name)}</span>}
                  </button>
                  <div className="hub-room-text">
                    <span className="hub-kicker">
                      <Users size={13} />
                      {room.subject || "Group study"}
                    </span>
                    <h2 title={room.name}>{room.name}</h2>
                    <p>
                      <span className="hub-online-dot" aria-hidden="true" />
                      {room.onlineCount || 3} online &middot; {members.length} member{members.length === 1 ? "" : "s"}
                    </p>
                  </div>
                </div>
                <div className="hub-header-actions">
                  <button className={`hub-action ${isExpandedRoomSettingsOpen ? "hub-action-active" : ""}`} type="button" onClick={() => setIsExpandedRoomSettingsOpen((current) => !current)} aria-pressed={isExpandedRoomSettingsOpen}>
                    <Settings size={16} />
                    <span>Room Settings</span>
                  </button>
                  <button className="hub-action" type="button" onClick={() => setIsChatExpanded(false)}>
                    <Minimize2 size={16} />
                    <span>Exit Full Chat</span>
                  </button>
                  <button className={`hub-action hub-action-call ${activeCall ? "hub-action-live" : ""}`} type="button" onClick={openCallScreen}>
                    {activeCall ? <Mic size={16} /> : <Video size={16} />}
                    <span>{activeCall ? "In Call" : "Join Call"}</span>
                  </button>
                  <button
                    className="icon-action"
                    type="button"
                    aria-label="Close full chat"
                    onClick={() => {
                      setIsExpandedRoomSettingsOpen(false);
                      setIsChatExpanded(false);
                    }}
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>
              {permissionError && <div className="error-banner">{permissionError}</div>}

              {renderMessages("message-list chatbox-page-messages")}

              {replyTarget ? (
                <div className="reply-composer">
                  <div>
                    <strong>Replying to {replyTarget.user?.name}</strong>
                    <span>{replyTarget.text || replyTarget.attachments?.[0]?.name || replyTarget.attachments?.[0]?.url}</span>
                  </div>
                  <button className="icon-action" type="button" onClick={() => setReplyTarget(null)}>
                    <X size={16} />
                  </button>
                </div>
              ) : null}

              {attachments.length ? (
                <div className="composer-attachments">
                  {attachments.map((attachment, index) => (
                    <div className="composer-attachment-pill" key={`${attachment.url}-expanded-${index}`}>
                      {attachment.type === "image" ? <ImageIcon size={14} /> : attachment.type === "link" ? <Link2 size={14} /> : <FileText size={14} />}
                      <span>{attachment.name || attachment.url}</span>
                      <button type="button" onClick={() => removeAttachment(index)}>
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="chat-input-row chatbox-page-input">
                <input
                  ref={attachmentInputRef}
                  type="file"
                  multiple
                  className="hidden-file-input"
                  onChange={handleAttachmentSelection}
                  accept="image/*,.pdf,.doc,.docx,.txt,.ppt,.pptx,.xls,.xlsx,.zip"
                />
                <button className="message-action-button composer-action" type="button" onClick={() => attachmentInputRef.current?.click()}>
                  <Paperclip size={16} />
                  Attach
                </button>
                <button className="message-action-button composer-action" type="button" onClick={addLinkAttachment}>
                  <Link2 size={16} />
                  Link
                </button>
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      sendMessage();
                    }
                  }}
                  type="text"
                  placeholder={placeholder}
                />
                <button className="send-button" type="button" onClick={sendMessage} disabled={isSending}>
                  <Send size={18} />
                </button>
              </div>
            </div>
            {isExpandedRoomSettingsOpen ? renderRoomSettingsContent({ onClose: () => setIsExpandedRoomSettingsOpen(false), className: "chatbox-room-settings-drawer" }) : null}
          </section>
        </div>
      ) : null}

      {linkInvite ? (
        <div className="hub-join-overlay" role="dialog" aria-modal="true" aria-labelledby="hub-join-title">
          <div className="hub-join-card">
            {linkInvite.error ? (
              <>
                <h3 id="hub-join-title">Invite link problem</h3>
                <p>{linkInvite.error}</p>
                <div className="hub-join-actions">
                  <button className="primary-button" type="button" onClick={dismissLinkInvite}>
                    Go to Study Hub
                  </button>
                </div>
              </>
            ) : !linkInvite.room ? (
              <>
                <h3 id="hub-join-title">Opening invite...</h3>
                <p>Checking the study room you were invited to.</p>
              </>
            ) : (
              <>
                <span className="hub-room-avatar hub-room-avatar-large">
                  {linkInvite.room.avatarUrl ? <img src={linkInvite.room.avatarUrl} alt="" /> : <span>{getRoomInitials(linkInvite.room.name)}</span>}
                </span>
                <span className="hub-kicker">
                  <UserPlus size={13} />
                  {linkInvite.alreadyMember ? "You're already a member" : "You're invited"}
                </span>
                <h3 id="hub-join-title">{linkInvite.room.name}</h3>
                <p>
                  {linkInvite.room.ownerName ? `Created by ${linkInvite.room.ownerName} · ` : ""}
                  {linkInvite.room.memberCount} member{linkInvite.room.memberCount === 1 ? "" : "s"}
                </p>
                <div className="hub-join-actions">
                  <button className="primary-button" type="button" onClick={joinRoomFromLink} disabled={isJoiningByLink}>
                    {isJoiningByLink ? "Joining..." : linkInvite.alreadyMember ? "Open Room" : "Join Room"}
                  </button>
                  <button className="secondary-button" type="button" onClick={dismissLinkInvite} disabled={isJoiningByLink}>
                    Not now
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      {activeCall ? (
        <div className="call-screen-overlay">
          <div className={`call-screen ${cameraEnabled || screenSharing ? "video-call-screen" : "voice-call-screen"}`}>
            <div className="call-screen-topbar">
              <div>
                <span className="call-screen-label">
                  {screenSharing ? "Screen sharing" : cameraEnabled ? "Video call" : "Voice call"}
                </span>
                <h3>{room.name}</h3>
                <p>{room.onlineCount || 3} members online</p>
              </div>
              <button className="icon-action" type="button" onClick={closeCallScreen}>
                <X size={18} />
              </button>
            </div>

            <div className="call-screen-stage">
              <div className="call-screen-main">
                {cameraEnabled || screenSharing ? (
                  <div className="call-screen-video-frame">
                    <video ref={localVideoRef} autoPlay muted playsInline className="call-screen-video" />
                    <div className="call-screen-floating-card">
                      <span className="hub-preview-dot" />
                      {screenSharing ? "Screen is live" : "Camera is live"}
                    </div>
                  </div>
                ) : (
                  <div className="call-screen-voice-panel">
                    <div className="audio-wave">
                      <span />
                      <span />
                      <span />
                      <span />
                    </div>
                    <strong>Voice discussion active</strong>
                    <p>Talk through the question naturally while keeping the Study Hub chat free for text messages.</p>
                  </div>
                )}
              </div>

              <aside className="call-screen-sidebar">
                <div className="call-mini-stat">
                  <span>Room</span>
                  <strong>{room.name}</strong>
                </div>
                <div className="call-mini-stat">
                  <span>Mode</span>
                  <strong>{screenSharing ? "Screen share + mic" : cameraEnabled ? "Video + mic" : "Voice only"}</strong>
                </div>
                <div className="call-mini-stat">
                  <span>Status</span>
                  <strong>Connected</strong>
                </div>
                <div className="call-member-stack">
                  {members.slice(0, 4).map((member) => (
                    <div className="call-member-row" key={member.email || member.name}>
                      <div className="member-badge">{member.name.charAt(0)}</div>
                      <div className="member-copy">
                        <span>{member.name}</span>
                        <small>{member.status || "online"}</small>
                      </div>
                    </div>
                  ))}
                </div>
              </aside>
            </div>

            <div className="call-screen-controls">
              <button className={`call-control ${micEnabled ? "active" : ""}`} type="button" onClick={handleMicClick}>
                {micEnabled ? <Mic size={18} /> : <MicOff size={18} />}
                <span>{micEnabled ? "Mute" : "Unmute"}</span>
              </button>
              <button className={`call-control ${cameraEnabled ? "active" : ""}`} type="button" onClick={handleCameraClick}>
                {cameraEnabled ? <Video size={18} /> : <VideoOff size={18} />}
                <span>{cameraEnabled ? "Stop video" : "Start video"}</span>
              </button>
              <button className={`call-control ${screenSharing ? "active" : ""}`} type="button" onClick={handleScreenShareClick}>
                <MonitorUp size={18} />
                <span>{screenSharing ? "Stop sharing" : "Share screen"}</span>
              </button>
              <button className="call-control end-call" type="button" onClick={closeCallScreen}>
                <PhoneOff size={18} />
                <span>Leave call</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default StudyHubPage;
