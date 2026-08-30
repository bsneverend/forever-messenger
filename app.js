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
const mediaPrevButton = $("media-prev-button");
const mediaNextButton = $("media-next-button");
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

function isHeicPath(path = "") {
  return /\.(heic|heif)$/i.test(String(path).split("?")[0]);
}

function isHeicFile(file) {
  if (!file) return false;
  return /^(image\/heic|image\/heif)$/i.test(String(file.type || "")) ||
    /\.(heic|heif)$/i.test(String(file.name || ""));
}

const heicPreviewUrlCache = new Map();
const previewSnapshotUrlCache = new Map();

async function convertHeicBlobToJpeg(blob, sourceName = "photo.heic") {
  if (typeof window.heic2any !== "function") {
    throw new Error("HEIC converter is not available yet.");
  }

  const converted = await window.heic2any({
    blob,
    toType: "image/jpeg",
    quality: 0.92
  });

  const jpegBlob = Array.isArray(converted) ? converted[0] : converted;
  const safeName = String(sourceName).replace(/\.(heic|heif)$/i, "") || "photo";
  return new File([jpegBlob], safeName + ".jpg", {
    type: "image/jpeg",
    lastModified: Date.now()
  });
}

async function getSignedMediaUrl(path) {
  const { data, error } = await db.storage
    .from("forever-media")
    .createSignedUrl(path, 60 * 60);

  if (error || !data?.signedUrl) {
    throw error || new Error("Media URL unavailable");
  }

  return data.signedUrl;
}

async function blobLooksLikeHeic(blob) {
  const type = String(blob?.type || "").toLowerCase();
  if (type.includes("heic") || type.includes("heif")) return true;

  // Some iPhone uploads arrive with an incorrect/empty MIME type or extension.
  // HEIC/HEIF files are ISO BMFF containers and usually identify themselves near byte 4.
  const bytes = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
  const ascii = String.fromCharCode(...bytes);
  return /ftyp(?:heic|heix|hevc|hevx|mif1|msf1)/i.test(ascii);
}

async function getRenderedPreviewUrl(path, sourceImage) {
  if (!sourceImage || !sourceImage.complete || !sourceImage.naturalWidth || !sourceImage.naturalHeight) {
    return "";
  }

  if (previewSnapshotUrlCache.has(path)) {
    return previewSnapshotUrlCache.get(path);
  }

  try {
    // The chat thumbnail is already decoded successfully. Rasterize those exact
    // pixels into a fresh browser-native PNG for the modal. This avoids a second
    // HEIC/HEIF decode or Chromium re-decode of the original resource.
    const canvas = document.createElement("canvas");
    canvas.width = sourceImage.naturalWidth;
    canvas.height = sourceImage.naturalHeight;

    const context = canvas.getContext("2d", { alpha: false });
    context.drawImage(sourceImage, 0, 0);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) return "";

    const url = URL.createObjectURL(blob);
    previewSnapshotUrlCache.set(path, url);
    return url;
  } catch (error) {
    // Some remote images may be canvas-tainted; normal source loading below
    // remains the fallback for those.
    console.warn("Forever could not snapshot rendered media for preview.", error);
    return "";
  }
}

async function getCompatibleHeicUrl(path, signedUrl) {
  if (heicPreviewUrlCache.has(path)) return heicPreviewUrlCache.get(path);

  const response = await fetch(signedUrl);
  if (!response.ok) throw new Error("Unable to download image.");

  const sourceBlob = await response.blob();
  if (!(await blobLooksLikeHeic(sourceBlob))) {
    throw new Error("The image is not HEIC/HEIF.");
  }

  const jpegFile = await convertHeicBlobToJpeg(
    sourceBlob,
    path.split("/").pop() || "photo.heic"
  );
  const objectUrl = URL.createObjectURL(jpegFile);
  heicPreviewUrlCache.set(path, objectUrl);
  return objectUrl;
}

async function resolveMediaUrl(path) {
  const signedUrl = await getSignedMediaUrl(path);

  // Known HEIC/HEIF paths are converted before assigning to <img>.
  if (isHeicPath(path)) {
    return getCompatibleHeicUrl(path, signedUrl);
  }

  return signedUrl;
}

async function resolveImageFallbackUrl(path) {
  const signedUrl = await getSignedMediaUrl(path);
  return getCompatibleHeicUrl(path, signedUrl);
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
    const mediaHtml = hasMedia ? (isVideoPath(message.image_url)
      ? `<div class="message-media-wrap"><video class="message-video" data-media-path="${escapeHtml(message.image_url)}" playsinline preload="metadata" controls></video></div>`
      : `<div class="message-media-wrap"><img class="message-image" data-media-path="${escapeHtml(message.image_url)}" alt="Shared image" loading="lazy" /></div>`) : "";
    row.innerHTML = `<div class="message-bubble ${hasMedia ? "has-image" : ""}">${mediaHtml}${textHtml}<div class="message-meta">${formatTime(message.created_at)}</div></div>`;
    messagesEl.appendChild(row);
  }
  const last = state.messages[state.messages.length - 1];
  const preview = last ? (last.image_url ? (last.content ? `${isVideoPath(last.image_url) ? "🎥" : "📷"} ${last.content}` : (isVideoPath(last.image_url) ? "🎥 Video" : "📷 Photo")) : last.content) : "No messages yet";
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

    try {
      const resolvedUrl = await resolveMediaUrl(path);

      // Attach the fallback before assigning src. This is important for images
      // that fail immediately from browser cache/unsupported codecs.
      if (el.tagName === "IMG") {
        el.addEventListener("error", async () => {
          if (el.dataset.heicFallback === "true") return;
          el.dataset.heicFallback = "true";

          try {
            el.src = await resolveImageFallbackUrl(path);
            el.dataset.resolved = "true";
          } catch (fallbackError) {
            console.warn("Unable to render shared image:", fallbackError);
            el.dataset.mediaError = "true";
          }
        }, { once: true });
      }

      el.src = resolvedUrl;
      el.dataset.resolved = "true";
    } catch (error) {
      console.warn("Unable to load shared media:", error);
      el.dataset.mediaError = "true";
    }
  }));
}
function getPreviewableMedia() {
  return state.messages.filter((message) => Boolean(message.image_url));
}

function updateMediaNavigation() {
  const items = getPreviewableMedia();
  const index = activePreviewMedia?.index ?? -1;
  const hasMultiple = items.length > 1;

  mediaPrevButton.classList.toggle("hidden", !hasMultiple);
  mediaNextButton.classList.toggle("hidden", !hasMultiple);
  mediaPrevButton.disabled = !hasMultiple || index <= 0;
  mediaNextButton.disabled = !hasMultiple || index < 0 || index >= items.length - 1;
}

function findLoadedMessageMedia(path) {
  return [...messagesEl.querySelectorAll("[data-media-path]")].find((el) => {
    return el.dataset.mediaPath === path && (el.currentSrc || el.src);
  }) || null;
}

let activePreviewSource = null;

function restoreActivePreviewSource() {
  if (!activePreviewSource) return;

  const { element, parent, nextSibling, className } = activePreviewSource;
  element.className = className;

  if (parent && parent.isConnected) {
    if (nextSibling && nextSibling.parentNode === parent) {
      parent.insertBefore(element, nextSibling);
    } else {
      parent.appendChild(element);
    }
  }

  activePreviewSource = null;
}

function mountAlreadyRenderedMedia(path, video) {
  const source = findLoadedMessageMedia(path);
  if (!source) return null;

  // For images, only move an element that has actually decoded. This is the key
  // fallback for Firefox/Chromium when an iPhone-originated image can render in
  // the chat bubble but becomes blank after creating a second <img>.
  if (!video && (!(source instanceof HTMLImageElement) || !source.naturalWidth || !source.naturalHeight)) {
    return null;
  }

  const parent = source.parentNode;
  const nextSibling = source.nextSibling;
  const className = source.className;

  activePreviewSource = { element: source, parent, nextSibling, className };
  source.className = video ? "media-preview-video" : "media-preview-image";
  mediaModalContent.replaceChildren(source);
  return source;
}

async function openMediaPreview(path) {
  const items = getPreviewableMedia();
  const index = items.findIndex((message) => message.image_url === path);
  if (index < 0) return;

  activePreviewMedia = { path, index, url: null, video: isVideoPath(path) };
  mediaModal.classList.remove("hidden");
  document.body.classList.add("media-modal-open");
  await renderActivePreview();
}

async function renderActivePreview() {
  if (!activePreviewMedia) return;

  const { path, video } = activePreviewMedia;
  const requestPath = path;

  // Put the previously previewed node back before navigating to another item.
  restoreActivePreviewSource();
  mediaModalContent.replaceChildren();
  updateMediaNavigation();

  // First choice: move the exact media element that is already rendered inside
  // the conversation into the modal. No second request, no second HEIC decode,
  // and no canvas re-rasterization. This is intentionally used before every
  // other preview strategy and fixes the Firefox blank-preview path.
  const existing = mountAlreadyRenderedMedia(requestPath, video);
  if (existing) {
    if (video) {
      existing.controls = true;
      existing.playsInline = true;
      existing.autoplay = true;
      existing.play?.().catch(() => {});
    }

    activePreviewMedia.url = existing.currentSrc || existing.src || null;
    return;
  }

  const media = document.createElement(video ? "video" : "img");
  media.className = video ? "media-preview-video" : "media-preview-image";

  if (video) {
    media.controls = true;
    media.autoplay = true;
    media.playsInline = true;
    media.preload = "metadata";
  } else {
    media.alt = "Media preview";
    media.decoding = "async";
  }

  mediaModalContent.appendChild(media);

  if (!video) {
    media.addEventListener("error", async () => {
      if (activePreviewMedia?.path !== requestPath) return;

      if (media.dataset.heicFallback !== "true") {
        media.dataset.heicFallback = "true";
        try {
          const fallbackUrl = await resolveImageFallbackUrl(requestPath);
          if (!activePreviewMedia || activePreviewMedia.path !== requestPath) return;
          activePreviewMedia.url = fallbackUrl;
          media.src = fallbackUrl;
          return;
        } catch (fallbackError) {
          console.warn("Forever HEIC fallback failed.", fallbackError);
        }
      }

      if (activePreviewMedia?.path !== requestPath) return;
      console.warn("Forever could not render this image preview.", requestPath);
      alert("Forever could not display this image preview in this browser.");
      closeMediaPreview();
    });
  }

  try {
    const signedOrCompatibleUrl = await resolveMediaUrl(path);
    if (!activePreviewMedia || activePreviewMedia.path !== requestPath) return;

    activePreviewMedia.url = signedOrCompatibleUrl;

    // Decode before showing the fallback-created node. This avoids a blank first
    // paint when a large phone image is decoded asynchronously.
    if (!video) {
      const preload = new Image();
      preload.decoding = "async";
      preload.src = signedOrCompatibleUrl;
      try {
        await preload.decode();
      } catch (_) {
        // The onerror handler on the visible image below will run the HEIC path.
      }

      if (!activePreviewMedia || activePreviewMedia.path !== requestPath) return;
    }

    media.src = signedOrCompatibleUrl;
  } catch (error) {
    console.warn("Forever could not open this media.", error);
    alert("Forever could not open this media in this browser.");
    closeMediaPreview();
  }
}

function navigateMedia(direction) {
  const items = getPreviewableMedia();
  if (!activePreviewMedia || items.length < 2) return;

  const nextIndex = activePreviewMedia.index + direction;
  if (nextIndex < 0 || nextIndex >= items.length) return;

  const next = items[nextIndex];
  activePreviewMedia = {
    path: next.image_url,
    index: nextIndex,
    url: null,
    video: isVideoPath(next.image_url)
  };

  renderActivePreview();
}

function closeMediaPreview() {
  restoreActivePreviewSource();
  mediaModal.classList.add("hidden");
  mediaModalContent.replaceChildren();
  activePreviewMedia = null;
  document.body.classList.remove("media-modal-open");
}

async function shareActiveMedia() {
  if (!activePreviewMedia) return;
  const { url, path, video } = activePreviewMedia;
  const name = path.split("/").pop() || (video ? "forever-video.mp4" : "forever-photo.jpg");

  try {
    const shareUrl = url || (await db.storage.from("forever-media").createSignedUrl(path, 60 * 60)).data?.signedUrl;
    if (!shareUrl) throw new Error("Media URL unavailable");

    const response = await fetch(shareUrl);
    const blob = await response.blob();
    const file = new File([blob], name, {
      type: blob.type || (video ? "video/mp4" : "image/jpeg")
    });

    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: "Forever" });
      return;
    }

    const link = document.createElement("a");
    link.href = shareUrl;
    link.download = name;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
  } catch {
    if (activePreviewMedia?.url) window.open(activePreviewMedia.url, "_blank", "noopener");
  }
}

messagesEl.addEventListener("click", (event) => {
  const media = event.target.closest("[data-media-path]");
  if (!media) return;
  event.preventDefault();
  openMediaPreview(media.dataset.mediaPath);
});

mediaCloseButton.addEventListener("click", closeMediaPreview);
mediaShareButton.addEventListener("click", shareActiveMedia);
mediaPrevButton.addEventListener("click", () => navigateMedia(-1));
mediaNextButton.addEventListener("click", () => navigateMedia(1));

mediaModal.addEventListener("click", (event) => {
  if (event.target.closest("[data-close-media-modal]")) closeMediaPreview();
});

document.addEventListener("keydown", (event) => {
  if (mediaModal.classList.contains("hidden")) return;
  if (event.key === "Escape") closeMediaPreview();
  if (event.key === "ArrowLeft") navigateMedia(-1);
  if (event.key === "ArrowRight") navigateMedia(1);
});

let previewSwipeStartX = 0;
let previewSwipeStartY = 0;
mediaModalContent.addEventListener("touchstart", (event) => {
  if (!activePreviewMedia || event.touches.length !== 1) return;
  previewSwipeStartX = event.touches[0].clientX;
  previewSwipeStartY = event.touches[0].clientY;
}, { passive: true });

mediaModalContent.addEventListener("touchend", (event) => {
  if (!activePreviewMedia || !previewSwipeStartX || event.changedTouches.length !== 1) return;

  const touch = event.changedTouches[0];
  const dx = touch.clientX - previewSwipeStartX;
  const dy = touch.clientY - previewSwipeStartY;

  previewSwipeStartX = 0;
  previewSwipeStartY = 0;

  if (Math.abs(dx) < 60 || Math.abs(dx) <= Math.abs(dy) * 1.2) return;
  navigateMedia(dx < 0 ? 1 : -1);
}, { passive: true });

async function loadProfileAndConversation() {
  const { data: profile, error: profileError } = await db
    .from("profiles")
    .select("id, full_name, avatar_url")
    .eq("id", state.user.id)
    .single();

  if (profileError) throw profileError;
  state.profile = profile;

  // V1 has one shared private conversation. First find the current user's membership.
  const { data: memberships, error: membershipError } = await db
    .from("conversation_participants")
    .select("conversation_id")
    .eq("user_id", state.user.id)
    .limit(1);

  if (membershipError) throw membershipError;
  if (!memberships?.length) {
    throw new Error("No private conversation is connected to this account.");
  }

  state.conversationId = memberships[0].conversation_id;

  // Profiles are readable by authenticated users. For this two-person V1,
  // the other profile is the user's single contact.
  const { data: profiles, error: profilesError } = await db
    .from("profiles")
    .select("id, full_name, avatar_url")
    .neq("id", state.user.id)
    .order("created_at", { ascending: true })
    .limit(1);

  if (profilesError) throw profilesError;
  if (!profiles?.length) {
    throw new Error("The second Forever account has not been created yet.");
  }

  state.contact = profiles[0];
  renderIdentity();
}

async function loadMessages() {
  const { data, error } = await db
    .from("messages")
    .select("id, conversation_id, sender_id, content, image_url, created_at")
    .eq("conversation_id", state.conversationId)
    .order("created_at", { ascending: true });

  if (error) throw error;

  state.messages = data || [];
  renderMessages();
}

function subscribeToMessages() {
  if (state.subscription) db.removeChannel(state.subscription);

  state.subscription = db
    .channel(`forever-conversation-${state.conversationId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `conversation_id=eq.${state.conversationId}`
      },
      (payload) => {
        if (state.messages.some((m) => m.id === payload.new.id)) return;
        state.messages.push(payload.new);
        renderMessages();
      }
    )
    .subscribe();
}

async function initializeMessenger() {
  await loadProfileAndConversation();
  await loadMessages();
  subscribeToMessages();
  showMessenger();
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = $("email").value.trim();
  const password = $("password").value;

  loginError.classList.add("hidden");
  loginButton.disabled = true;
  loginButton.querySelector(".button-loader").classList.remove("hidden");

  try {
    const { data, error } = await db.auth.signInWithPassword({ email, password });
    if (error) throw error;

    state.user = data.user;
    await initializeMessenger();
  } catch (error) {
    loginError.textContent = error.message || "Unable to log in. Please check your details.";
    loginError.classList.remove("hidden");
  } finally {
    loginButton.disabled = false;
    loginButton.querySelector(".button-loader").classList.add("hidden");
  }
});

$("logout-button").addEventListener("click", async () => {
  if (state.subscription) {
    await db.removeChannel(state.subscription);
    state.subscription = null;
  }
  await db.auth.signOut();
  state.user = null;
  state.profile = null;
  state.contact = null;
  state.conversationId = null;
  state.messages = [];
  clearPendingMedia();
  $("email").value = "";
  $("password").value = "";
  showLogin();
});

conversationItem.addEventListener("click", () => {
  messengerScreen.classList.add("mobile-chat-open");
});

$("mobile-back-button").addEventListener("click", () => {
  messengerScreen.classList.remove("mobile-chat-open");
});

function clearPendingMedia() {
  state.pendingMedia = null; imageInput.value = ""; imagePreviewWrap.classList.add("hidden");
  imagePreview.removeAttribute("src"); videoPreview.pause(); videoPreview.removeAttribute("src");
  videoPreview.classList.add("hidden"); imagePreview.classList.remove("hidden"); state.pendingMediaPreviewUrl = null;
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
async function handleSelectedMedia() {
  const selectedFile = imageInput.files && imageInput.files[0]; if (!selectedFile) return;
  if (!isLikelyMediaFile(selectedFile)) { alert("Please choose a photo or video file."); clearPendingMedia(); return; }
  if (selectedFile.size > 100 * 1024 * 1024) { alert("Please choose a photo or video smaller than 100 MB."); clearPendingMedia(); return; }

  let file = selectedFile;
  try {
    // Convert HEIC/HEIF before upload so every future device receives JPEG.
    if (isHeicFile(selectedFile)) {
      file = await convertHeicBlobToJpeg(selectedFile, selectedFile.name || "photo.heic");
    }
  } catch (error) {
    console.warn("Unable to convert HEIC/HEIF:", error);
    alert("Forever could not convert this HEIC/HEIF photo. Please try again.");
    clearPendingMedia();
    return;
  }

  state.pendingMedia = file;
  const reader = new FileReader();
  reader.onerror = () => { alert("Forever could not read this media. Please try another file."); clearPendingMedia(); };
  reader.onload = () => {
    if (state.pendingMedia !== file) return;
    state.pendingMediaPreviewUrl = String(reader.result || "");
    if (isVideoFile(file)) { videoPreview.src = state.pendingMediaPreviewUrl; videoPreview.classList.remove("hidden"); imagePreview.classList.add("hidden"); }
    else { imagePreview.src = state.pendingMediaPreviewUrl; imagePreview.classList.remove("hidden"); videoPreview.classList.add("hidden"); }
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
  const { error } = await db.storage.from("forever-media").upload(path, file, { contentType: file.type || (isVideoFile(file) ? "video/mp4" : "image/jpeg"), upsert: false });
  if (error) throw error;
  return path;
}

function autoResize() {
  messageInput.style.height = "auto";
  messageInput.style.height = Math.min(messageInput.scrollHeight, 140) + "px";
}
messageInput.addEventListener("input", autoResize);

composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  const content = messageInput.value.trim();
  if ((!content && !state.pendingMedia) || !state.user || !state.conversationId) return;

  sendButton.disabled = true;
  addImageButton.classList.add("is-disabled");

  try {
    const imageUrl = await uploadPendingMedia();
    const { data, error } = await db
      .from("messages")
      .insert({
        conversation_id: state.conversationId,
        sender_id: state.user.id,
        content,
        image_url: imageUrl
      })
      .select("id, conversation_id, sender_id, content, image_url, created_at")
      .single();

    if (error) throw error;

    if (!state.messages.some((m) => m.id === data.id)) {
      state.messages.push(data);
      renderMessages();
    }

    messageInput.value = "";
    clearPendingMedia();
    autoResize();
  } catch (error) {
    alert(error.message || "Message could not be sent.");
  } finally {
    sendButton.disabled = false;
    addImageButton.classList.remove("is-disabled");
    messageInput.focus();
  }
});

// Swipe right from the left edge to return from the mobile conversation to the message list.
let swipeStartX = 0, swipeStartY = 0, swipeTracking = false;
const chatPanel = $("chat-panel");
chatPanel.addEventListener("touchstart", (event) => {
  if (window.innerWidth > 760 || !messengerScreen.classList.contains("mobile-chat-open") || event.touches.length !== 1) return;
  if (event.target.closest("input, textarea, button, video")) return;
  swipeStartX = event.touches[0].clientX; swipeStartY = event.touches[0].clientY; swipeTracking = swipeStartX <= 72;
}, { passive: true });
chatPanel.addEventListener("touchend", (event) => {
  if (!swipeTracking || window.innerWidth > 760) return;
  const touch = event.changedTouches[0], dx = touch.clientX - swipeStartX, dy = touch.clientY - swipeStartY;
  swipeTracking = false;
  if (dx > 78 && Math.abs(dy) < 70) messengerScreen.classList.remove("mobile-chat-open");
}, { passive: true });

(async function bootstrap() {
  try {
    const { data: { session } } = await db.auth.getSession();
    if (session?.user) {
      state.user = session.user;
      await initializeMessenger();
    } else {
      showLogin();
    }
  } catch (error) {
    showLogin(error.message || "Unable to connect to Forever.");
  }
})();
