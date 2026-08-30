const SUPABASE_URL = "https://smtvfsycnczqpuiwesez.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_SPf2yD3YRnwSTAAx0PCRDg_vu-D9iZb";

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const state = {
  user: null,
  profile: null,
  contact: null,
  conversationId: null,
  subscription: null,
  messages: [],
  pendingMedia: null,
  pendingMediaPreviewUrl: null
};

const $ = (id) => document.getElementById(id);

const loadingScreen = $("loading-screen");
const loginScreen = $("login-screen");
const messengerScreen = $("messenger-screen");
const loginForm = $("login-form");
const loginError = $("login-error");
const loginButton = $("login-button");
const conversationItem = $("conversation-item");
const messagesEl = $("messages");
const messageScroll = $("message-scroll");
const emptyState = $("empty-state");
const messageInput = $("message-input");
const composer = $("composer");
const sendButton = $("send-button");
const imageInput = $("image-input");
const addImageButton = $("add-image-button");
const imagePreviewWrap = $("image-preview-wrap");
const imagePreview = $("image-preview");
const removeImageButton = $("remove-image-button");
const videoPreview = $("video-preview");
const mediaModal = $("media-modal");
const mediaModalContent = $("media-modal-content");
const mediaCloseButton = $("media-close-button");
const mediaShareButton = $("media-share-button");
let activePreviewMedia = null;

function initials(name) {
  return (name || "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "?";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatConversationTime(value) {
  if (!value) return "";
  const date = new Date(value);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? formatTime(value)
    : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function showLogin(errorMessage = "") {
  messengerScreen.classList.add("hidden");
  loginScreen.classList.remove("hidden");
  loginError.textContent = errorMessage;
  loginError.classList.toggle("hidden", !errorMessage);
  loadingScreen.classList.add("hidden");
}

function showMessenger() {
  loginScreen.classList.add("hidden");
  messengerScreen.classList.remove("hidden");
  loadingScreen.classList.add("hidden");
}

function setAvatar(elementId, name) {
  $(elementId).textContent = initials(name);
}

function renderIdentity() {
  const me = state.profile?.full_name || "Forever User";
  const contact = state.contact?.full_name || "Forever";

  $("my-name").textContent = me;
  $("contact-name").textContent = contact;
  $("chat-contact-name").textContent = contact;

  setAvatar("my-avatar", me);
  setAvatar("contact-avatar", contact);
  setAvatar("chat-contact-avatar", contact);
}

function isVideoPath(path = "") {
  return /\.(mp4|mov|m4v|webm|ogg|ogv)$/i.test(String(path).split("?")[0]);
}

function renderMessages() {
  messagesEl.innerHTML = "";
  emptyState.classList.toggle("hidden", state.messages.length !== 0);

  for (const message of state.messages) {
    const mine = message.sender_id === state.user.id;
    const row = document.createElement("div");
    row.className = `message-row ${mine ? "mine" : ""}`;
    row.dataset.messageId = message.id;
    const textHtml = message.content ? `<div class="message-text">${escapeHtml(message.content)}</div>` : "";
    const hasMedia = Boolean(message.image_url);
    const mediaHtml = hasMedia
      ? (isVideoPath(message.image_url)
          ? `<div class="message-media-wrap"><video class="message-video" data-media-path="${escapeHtml(message.image_url)}" playsinline preload="metadata" controls></video></div>`
          : `<div class="message-media-wrap"><img class="message-image" data-media-path="${escapeHtml(message.image_url)}" alt="Shared image" loading="lazy" /></div>`)
      : "";
    row.innerHTML = `<div class="message-bubble ${hasMedia ? "has-image" : ""}">${mediaHtml}${textHtml}<div class="message-meta">${formatTime(message.created_at)}</div></div>`;
    messagesEl.appendChild(row);
  }

  const last = state.messages[state.messages.length - 1];
  const preview = last
    ? (last.image_url
        ? (last.content ? `${isVideoPath(last.image_url) ? "🎥" : "📷"} ${last.content}` : (isVideoPath(last.image_url) ? "🎥 Video" : "📷 Photo"))
        : last.content)
    : "No messages yet";
  $("last-message-preview").textContent = last ? (last.sender_id === state.user.id ? `You: ${preview}` : preview) : preview;
  $("last-message-time").textContent = last ? formatConversationTime(last.created_at) : "";
  hydrateMessageMedia();
  requestAnimationFrame(() => { messageScroll.scrollTop = messageScroll.scrollHeight; });
}

async function hydrateMessageMedia() {
  const media = [...messagesEl.querySelectorAll("[data-media-path]")];
  await Promise.all(media.map(async (el) => {
    const path = el.dataset.mediaPath;
    if (!path || el.dataset.resolved === "true") return;
    const { data, error } = await db.storage.from("forever-media").createSignedUrl(path, 60 * 60);
    if (error) { console.warn("Unable to load shared media:", error); return; }
    el.src = data.signedUrl;
    el.dataset.resolved = "true";
  }));
}

async function openMediaPreview(path) {
  if (!path) return;
  const { data, error } = await db.storage.from("forever-media").createSignedUrl(path, 60 * 60);
  if (error) {
    alert("Forever could not open this media.");
    return;
  }
  const video = isVideoPath(path);
  activePreviewMedia = { path, url: data.signedUrl, video };
  mediaModalContent.innerHTML = video
    ? `<video src="${data.signedUrl}" controls autoplay playsinline></video>`
    : `<img src="${data.signedUrl}" alt="Media preview" />`;
  mediaModal.classList.remove("hidden");
  document.body.classList.add("media-modal-open");
}

function closeMediaPreview() {
  mediaModal.classList.add("hidden");
  mediaModalContent.innerHTML = "";
  activePreviewMedia = null;
  document.body.classList.remove("media-modal-open");
}

async function shareActiveMedia() {
  if (!activePreviewMedia) return;
  const { url, path, video } = activePreviewMedia;
  const fallbackName = path.split("/").pop() || (video ? "forever-video.mp4" : "forever-photo.jpg");
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const file = new File([blob], fallbackName, { type: blob.type || (video ? "video/mp4" : "image/jpeg") });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
      await navigator.share({ files: [file], title: "Forever" });
      return;
    }
    const link = document.createElement("a");
    link.href = url;
    link.download = fallbackName;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
  } catch (error) {
    window.open(url, "_blank", "noopener");
  }
}

messagesEl.addEventListener("click", (event) => {
  const media = event.target.closest("[data-media-path]");
  if (!media) return;
  if (media.tagName === "VIDEO" && event.target.closest("video")) {
    if (event.target.closest("video").controls) {
      const rect = media.getBoundingClientRect();
      const nearControls = event.clientY > rect.bottom - 54;
      if (nearControls) return;
    }
  }
  event.preventDefault();
  openMediaPreview(media.dataset.mediaPath);
});

mediaCloseButton.addEventListener("click", closeMediaPreview);
mediaShareButton.addEventListener("click", shareActiveMedia);
mediaModal.addEventListener("click", (event) => {
  if (event.target.closest("[data-close-media-modal]")) closeMediaPreview();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !mediaModal.classList.contains("hidden")) closeMediaPreview();
});
function clearPendingMedia() {
  state.pendingMedia = null;
  imageInput.value = "";
  imagePreviewWrap.classList.add("hidden");
  imagePreview.removeAttribute("src");
  videoPreview.removeAttribute("src");
  videoPreview.pause();
  videoPreview.classList.add("hidden");
  imagePreview.classList.remove("hidden");
  state.pendingMediaPreviewUrl = null;
}

removeImageButton.addEventListener("click", clearPendingMedia);

function isLikelyMediaFile(file) {
  if (!file) return false;
  if (file.type && (file.type.startsWith("image/") || file.type.startsWith("video/"))) return true;
  return /\.(jpe?g|png|gif|webp|heic|heif|mp4|mov|m4v|webm|ogg|ogv)$/i.test(file.name || "");
}

function isVideoFile(file) {
  return Boolean(file && ((file.type && file.type.startsWith("video/")) || /\.(mp4|mov|m4v|webm|ogg|ogv)$/i.test(file.name || "")));
}

function handleSelectedMedia() {
  const file = imageInput.files && imageInput.files[0];
  if (!file) return;

  if (!isLikelyMediaFile(file)) {
    alert("Please choose a photo or video file.");
    clearPendingMedia();
    return;
  }

  if (file.size > 100 * 1024 * 1024) {
    alert("Please choose a photo or video smaller than 100 MB.");
    clearPendingMedia();
    return;
  }

  state.pendingMedia = file;
  const reader = new FileReader();
  reader.onerror = () => {
    alert("Forever could not read this media. Please try another file.");
    clearPendingMedia();
  };
  reader.onload = () => {
    if (state.pendingMedia !== file) return;
    state.pendingMediaPreviewUrl = String(reader.result || "");
    if (isVideoFile(file)) {
      videoPreview.src = state.pendingMediaPreviewUrl;
      videoPreview.classList.remove("hidden");
      imagePreview.classList.add("hidden");
    } else {
      imagePreview.src = state.pendingMediaPreviewUrl;
      imagePreview.classList.remove("hidden");
      videoPreview.classList.add("hidden");
    }
    imagePreviewWrap.classList.remove("hidden");
  };
  reader.readAsDataURL(file);
}

imageInput.addEventListener("change", handleSelectedMedia);
imageInput.addEventListener("input", handleSelectedMedia);

async function uploadPendingMedia() {
  if (!state.pendingMedia) return null;
  const file = state.pendingMedia;
  const extension = (file.name.split(".").pop() || (isVideoFile(file) ? "mp4" : "jpg")).replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || (isVideoFile(file) ? "mp4" : "jpg");
  const path = `${state.user.id}/${state.conversationId}/${crypto.randomUUID()}.${extension}`;
  const { error } = await db.storage.from("forever-media").upload(path, file, {
    contentType: file.type || (isVideoFile(file) ? "video/mp4" : "image/jpeg"),
    upsert: false
  });
  if (error) throw error;
  return path;
}
sycnczqpuiwesez.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_SPf2yD3YRnwSTAAx0PCRDg_vu-D9iZb";

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const state = {
  user: null,
  profile: null,
  contact: null,
  conversationId: null,
  subscription: null,
  messages: [],
  pendingMedia: null,
  pendingMediaPreviewUrl: null
};

const $ = (id) => document.getElementById(id);

const loadingScreen = $("loading-screen");
const loginScreen = $("login-screen");
const messengerScreen = $("messenger-screen");
const loginForm = $("login-form");
const loginError = $("login-error");
const loginButton = $("login-button");
const conversationItem = $("conversation-item");
const messagesEl = $("messages");
const messageScroll = $("message-scroll");
const emptyState = $("empty-state");
const messageInput = $("message-input");
const composer = $("composer");
const sendButton = $("send-button");
const imageInput = $("image-input");
const addImageButton = $("add-image-button");
const imagePreviewWrap = $("image-preview-wrap");
const imagePreview = $("image-preview");
const removeImageButton = $("remove-image-button");
const videoPreview = $("video-preview");
const mediaModal = $("media-modal");
const mediaModalContent = $("media-modal-content");
const mediaCloseButton = $("media-close-button");
const mediaShareButton = $("media-share-button");
let activePreviewMedia = null;

function initials(name) {
  return (name || "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "?";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatConversationTime(value) {
  if (!value) return "";
  const date = new Date(value);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? formatTime(value)
    : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function showLogin(errorMessage = "") {
  messengerScreen.classList.add("hidden");
  loginScreen.classList.remove("hidden");
  loginError.textContent = errorMessage;
  loginError.classList.toggle("hidden", !errorMessage);
  loadingScreen.classList.add("hidden");
}

function showMessenger() {
  loginScreen.classList.add("hidden");
  messengerScreen.classList.remove("hidden");
  loadingScreen.classList.add("hidden");
}

function setAvatar(elementId, name) {
  $(elementId).textContent = initials(name);
}

function renderIdentity() {
  const me = state.profile?.full_name || "Forever User";
  const contact = state.contact?.full_name || "Forever";

  $("my-name").textContent = me;
  $("contact-name").textContent = contact;
  $("chat-contact-name").textContent = contact;

  setAvatar("my-avatar", me);
  setAvatar("contact-avatar", contact);
  setAvatar("chat-contact-avatar", contact);
}

function isVideoPath(path = "") {
  return /\.(mp4|mov|m4v|webm|ogg|ogv)$/i.test(String(path).split("?")[0]);
}

function renderMessages() {
  messagesEl.innerHTML = "";
  emptyState.classList.toggle("hidden", state.messages.length !== 0);

  for (const message of state.messages) {
    const mine = message.sender_id === state.user.id;
    const row = document.createElement("div");
    row.className = `message-row ${mine ? "mine" : ""}`;
    row.dataset.messageId = message.id;
    const textHtml = message.content ? `<div class="message-text">${escapeHtml(message.content)}</div>` : "";
    const hasMedia = Boolean(message.image_url);
    const mediaHtml = hasMedia
      ? (isVideoPath(message.image_url)
          ? `<div class="message-media-wrap"><video class="message-video" data-media-path="${escapeHtml(message.image_url)}" playsinline preload="metadata" controls></video></div>`
          : `<div class="message-media-wrap"><img class="message-image" data-media-path="${escapeHtml(message.image_url)}" alt="Shared image" loading="lazy" /></div>`)
      : "";
    row.innerHTML = `<div class="message-bubble ${hasMedia ? "has-image" : ""}">${mediaHtml}${textHtml}<div class="message-meta">${formatTime(message.created_at)}</div></div>`;
    messagesEl.appendChild(row);
  }

  const last = state.messages[state.messages.length - 1];
  const preview = last
    ? (last.image_url
        ? (last.content ? `${isVideoPath(last.image_url) ? "🎥" : "📷"} ${last.content}` : (isVideoPath(last.image_url) ? "🎥 Video" : "📷 Photo"))
        : last.content)
    : "No messages yet";
  $("last-message-preview").textContent = last ? (last.sender_id === state.user.id ? `You: ${preview}` : preview) : preview;
  $("last-message-time").textContent = last ? formatConversationTime(last.created_at) : "";
  hydrateMessageMedia();
  requestAnimationFrame(() => { messageScroll.scrollTop = messageScroll.scrollHeight; });
}

async function hydrateMessageMedia() {
  const media = [...messagesEl.querySelectorAll("[data-media-path]")];
  await Promise.all(media.map(async (el) => {
    const path = el.dataset.mediaPath;
    if (!path || el.dataset.resolved === "true") return;
    const { data, error } = await db.storage.from("forever-media").createSignedUrl(path, 60 * 60);
    if (error) { console.warn("Unable to load shared media:", error); return; }
    el.src = data.signedUrl;
    el.dataset.resolved = "true";
  }));
}

async function openMediaPreview(path) {
  if (!path) return;
  const { data, error } = await db.storage.from("forever-media").createSignedUrl(path, 60 * 60);
  if (error) {
    alert("Forever could not open this media.");
    return;
  }
  const video = isVideoPath(path);
  activePreviewMedia = { path, url: data.signedUrl, video };
  mediaModalContent.innerHTML = video
    ? `<video src="${data.signedUrl}" controls autoplay playsinline></video>`
    : `<img src="${data.signedUrl}" alt="Media preview" />`;
  mediaModal.classList.remove("hidden");
  document.body.classList.add("media-modal-open");
}

function closeMediaPreview() {
  mediaModal.classList.add("hidden");
  mediaModalContent.innerHTML = "";
  activePreviewMedia = null;
  document.body.classList.remove("media-modal-open");
}

async function shareActiveMedia() {
  if (!activePreviewMedia) return;
  const { url, path, video } = activePreviewMedia;
  const fallbackName = path.split("/").pop() || (video ? "forever-video.mp4" : "forever-photo.jpg");
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const file = new File([blob], fallbackName, { type: blob.type || (video ? "video/mp4" : "image/jpeg") });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
      await navigator.share({ files: [file], title: "Forever" });
      return;
    }
    const link = document.createElement("a");
    link.href = url;
    link.download = fallbackName;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
  } catch (error) {
    window.open(url, "_blank", "noopener");
  }
}

messagesEl.addEventListener("click", (event) => {
  const media = event.target.closest("[data-media-path]");
  if (!media) return;
  if (media.tagName === "VIDEO" && event.target.closest("video")) {
    if (event.target.closest("video").controls) {
      const rect = media.getBoundingClientRect();
      const nearControls = event.clientY > rect.bottom - 54;
      if (nearControls) return;
    }
  }
  event.preventDefault();
  openMediaPreview(media.dataset.mediaPath);
});

mediaCloseButton.addEventListener("click", closeMediaPreview);
mediaShareButton.addEventListener("click", shareActiveMedia);
mediaModal.addEventListener("click", (event) => {
  if (event.target.closest("[data-close-media-modal]")) closeMediaPreview();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !mediaModal.classList.contains("hidden")) closeMediaPreview();
});

