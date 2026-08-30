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
  messages: []
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

function renderMessages() {
  messagesEl.innerHTML = "";

  emptyState.classList.toggle("hidden", state.messages.length !== 0);

  for (const message of state.messages) {
    const mine = message.sender_id === state.user.id;
    const row = document.createElement("div");
    row.className = `message-row ${mine ? "mine" : ""}`;
    row.dataset.messageId = message.id;
    row.innerHTML = `
      <div class="message-bubble">
        <div class="message-text">${escapeHtml(message.content)}</div>
        <div class="message-meta">${formatTime(message.created_at)}</div>
      </div>
    `;
    messagesEl.appendChild(row);
  }

  const last = state.messages[state.messages.length - 1];
  $("last-message-preview").textContent = last
    ? (last.sender_id === state.user.id ? `You: ${last.content}` : last.content)
    : "No messages yet";
  $("last-message-time").textContent = last ? formatConversationTime(last.created_at) : "";

  requestAnimationFrame(() => {
    messageScroll.scrollTop = messageScroll.scrollHeight;
  });
}

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
    .select("id, conversation_id, sender_id, content, created_at")
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

function autoResize() {
  messageInput.style.height = "auto";
  messageInput.style.height = Math.min(messageInput.scrollHeight, 140) + "px";
}
messageInput.addEventListener("input", autoResize);

composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  const content = messageInput.value.trim();
  if (!content || !state.user || !state.conversationId) return;

  sendButton.disabled = true;

  try {
    const { data, error } = await db
      .from("messages")
      .insert({
        conversation_id: state.conversationId,
        sender_id: state.user.id,
        content
      })
      .select("id, conversation_id, sender_id, content, created_at")
      .single();

    if (error) throw error;

    // Add immediately for a responsive sender experience.
    if (!state.messages.some((m) => m.id === data.id)) {
      state.messages.push(data);
      renderMessages();
    }

    messageInput.value = "";
    autoResize();
  } catch (error) {
    alert(error.message || "Message could not be sent.");
  } finally {
    sendButton.disabled = false;
    messageInput.focus();
  }
});

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
