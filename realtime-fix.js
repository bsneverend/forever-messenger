const FOREVER_REALTIME_URL = "https://smtvfsycnczqpuiwesez.supabase.co";
const FOREVER_REALTIME_KEY = "sb_publishable_SPf2yD3YRnwSTAAx0PCRDg_vu-D9iZb";

let realtimeFixClient = null;
let realtimeFixChannel = null;
let realtimeFixUser = null;
let realtimeFixConversationId = null;
let realtimeFixRetryTimer = null;
let realtimeFixRetryAttempt = 0;
let realtimeFixBusy = false;
let realtimeFixLastRefresh = 0;

function realtimeFixGetClient() {
  if (!realtimeFixClient) {
    realtimeFixClient = supabase.createClient(FOREVER_REALTIME_URL, FOREVER_REALTIME_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
  }
  return realtimeFixClient;
}

function realtimeFixEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function realtimeFixIsVideo(path = "") {
  return /\.(mp4|mov|m4v|webm|ogg|ogv)$/i.test(String(path).split("?")[0]);
}

function realtimeFixFormatTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function realtimeFixFormatConversationTime(value) {
  if (!value) return "";
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return realtimeFixFormatTime(value);
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

async function realtimeFixSignedUrl(path) {
  const { data, error } = await realtimeFixGetClient()
    .storage.from("forever-media").createSignedUrl(path, 60 * 60);
  if (error || !data?.signedUrl) throw error || new Error("Media URL unavailable");
  return data.signedUrl;
}

async function realtimeFixLoadMessages() {
  if (!realtimeFixConversationId) return;

  const client = realtimeFixGetClient();
  const { data, error } = await client
    .from("messages")
    .select("id, conversation_id, sender_id, content, image_url, created_at")
    .eq("conversation_id", realtimeFixConversationId)
    .order("created_at", { ascending: true });

  if (error) throw error;

  const messagesEl = document.getElementById("messages");
  const messageScroll = document.getElementById("message-scroll");
  const emptyState = document.getElementById("empty-state");
  if (!messagesEl || !messageScroll || !emptyState || !realtimeFixUser) return;

  const messages = data || [];
  messagesEl.innerHTML = "";
  emptyState.classList.toggle("hidden", messages.length !== 0);

  for (const message of messages) {
    const mine = message.sender_id === realtimeFixUser.id;
    const hasMedia = Boolean(message.image_url);
    const video = hasMedia && realtimeFixIsVideo(message.image_url);
    const mediaHtml = hasMedia
      ? (video
        ? `<div class="message-media-wrap"><video class="message-video" data-media-path="${realtimeFixEscape(message.image_url)}" playsinline preload="metadata" controls></video></div>`
        : `<div class="message-media-wrap"><img class="message-image" data-media-path="${realtimeFixEscape(message.image_url)}" alt="Shared image" loading="lazy" /></div>`)
      : "";
    const textHtml = message.content
      ? `<div class="message-text">${realtimeFixEscape(message.content)}</div>`
      : "";

    const row = document.createElement("div");
    row.className = `message-row ${mine ? "mine" : ""}`;
    row.dataset.messageId = message.id;
    row.innerHTML = `<div class="message-bubble ${hasMedia ? "has-image" : ""}">${mediaHtml}${textHtml}<div class="message-meta">${realtimeFixFormatTime(message.created_at)}</div></div>`;
    messagesEl.appendChild(row);
  }

  const last = messages[messages.length - 1];
  const preview = last
    ? (last.image_url
      ? (last.content
        ? `${realtimeFixIsVideo(last.image_url) ? "🎥" : "📷"} ${last.content}`
        : (realtimeFixIsVideo(last.image_url) ? "🎥 Video" : "📷 Photo"))
      : last.content)
    : "No messages yet";
  const lastPreview = document.getElementById("last-message-preview");
  const lastTime = document.getElementById("last-message-time");
  if (lastPreview) lastPreview.textContent = last ? (last.sender_id === realtimeFixUser.id ? `You: ${preview}` : preview) : preview;
  if (lastTime) lastTime.textContent = last ? realtimeFixFormatConversationTime(last.created_at) : "";

  const media = [...messagesEl.querySelectorAll("[data-media-path]")];
  await Promise.all(media.map(async (element) => {
    try {
      element.src = await realtimeFixSignedUrl(element.dataset.mediaPath);
      element.dataset.resolved = "true";
    } catch (error) {
      console.warn("Forever realtime media hydration failed:", error);
    }
  }));

  requestAnimationFrame(() => {
    messageScroll.scrollTop = messageScroll.scrollHeight;
  });
}

function realtimeFixClearRetry() {
  if (realtimeFixRetryTimer) {
    clearTimeout(realtimeFixRetryTimer);
    realtimeFixRetryTimer = null;
  }
}

function realtimeFixScheduleRetry() {
  if (realtimeFixRetryTimer || !realtimeFixConversationId) return;
  const delay = Math.min(30000, 1000 * (2 ** realtimeFixRetryAttempt));
  realtimeFixRetryAttempt = Math.min(realtimeFixRetryAttempt + 1, 5);
  realtimeFixRetryTimer = setTimeout(() => {
    realtimeFixRetryTimer = null;
    realtimeFixRecover();
  }, delay);
}

async function realtimeFixRecover(force = false) {
  if (!realtimeFixUser || !realtimeFixConversationId || realtimeFixBusy) return;
  const now = Date.now();
  if (!force && now - realtimeFixLastRefresh < 2500) return;

  realtimeFixBusy = true;
  realtimeFixLastRefresh = now;
  try {
    await realtimeFixLoadMessages();
    realtimeFixSubscribe();
    realtimeFixRetryAttempt = 0;
    realtimeFixClearRetry();
  } catch (error) {
    console.warn("Forever realtime recovery failed:", error);
    realtimeFixScheduleRetry();
  } finally {
    realtimeFixBusy = false;
  }
}

function realtimeFixSubscribe() {
  if (!realtimeFixConversationId) return;
  const client = realtimeFixGetClient();

  if (realtimeFixChannel) {
    client.removeChannel(realtimeFixChannel);
    realtimeFixChannel = null;
  }

  const channelName = `forever-live-${realtimeFixConversationId}-${Date.now()}`;
  realtimeFixChannel = client
    .channel(channelName)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `conversation_id=eq.${realtimeFixConversationId}`
      },
      async (payload) => {
        if (!payload?.new?.id) return;
        try {
          await realtimeFixLoadMessages();
        } catch (error) {
          console.warn("Forever could not refresh after new message:", error);
          realtimeFixScheduleRetry();
        }
      }
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        realtimeFixRetryAttempt = 0;
        realtimeFixClearRetry();
        console.log("Forever realtime connected.");
      } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
        console.warn("Forever realtime disconnected:", status);
        realtimeFixScheduleRetry();
      }
    });
}

async function realtimeFixInitialize() {
  const client = realtimeFixGetClient();
  const { data: { session } } = await client.auth.getSession();
  await realtimeFixHandleSession(session);

  client.auth.onAuthStateChange((_event, sessionData) => {
    realtimeFixHandleSession(sessionData).catch((error) => {
      console.warn("Forever realtime auth sync failed:", error);
    });
  });
}

async function realtimeFixHandleSession(session) {
  realtimeFixUser = session?.user || null;

  if (realtimeFixChannel) {
    realtimeFixGetClient().removeChannel(realtimeFixChannel);
    realtimeFixChannel = null;
  }
  realtimeFixConversationId = null;
  realtimeFixClearRetry();

  if (!realtimeFixUser) return;

  const { data: memberships, error } = await realtimeFixGetClient()
    .from("conversation_participants")
    .select("conversation_id")
    .eq("user_id", realtimeFixUser.id)
    .limit(1);

  if (error) {
    console.warn("Forever realtime conversation lookup failed:", error);
    return;
  }

  realtimeFixConversationId = memberships?.[0]?.conversation_id || null;
  if (!realtimeFixConversationId) return;

  await realtimeFixRecover(true);
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") realtimeFixRecover(true);
});

window.addEventListener("online", () => realtimeFixRecover(true));
window.addEventListener("focus", () => realtimeFixRecover(false));

window.addEventListener("load", () => {
  realtimeFixInitialize().catch((error) => {
    console.warn("Forever realtime fix initialization failed:", error);
  });
});
