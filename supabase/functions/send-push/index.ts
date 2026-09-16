import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json"
};

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:forever@localhost";

const supabase = createClient(supabaseUrl || "", serviceRoleKey || "", {
  auth: { persistSession: false, autoRefreshToken: false }
});

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authorization = req.headers.get("authorization") || "";
  if (!serviceRoleKey || authorization !== `Bearer ${serviceRoleKey}`) {
    return json({ error: "Unauthorized" }, 401);
  }

  if (!vapidPublicKey || !vapidPrivateKey) {
    return json({ error: "VAPID keys are not configured" }, 500);
  }

  const payload = await req.json();
  const message = payload?.record;
  if (!message?.id || !message?.conversation_id || !message?.sender_id) {
    return json({ error: "Webhook payload is missing the message record" }, 400);
  }

  const { data: participants, error: participantError } = await supabase
    .from("conversation_participants")
    .select("user_id")
    .eq("conversation_id", message.conversation_id)
    .neq("user_id", message.sender_id);

  if (participantError) return json({ error: participantError.message }, 500);

  const recipientIds = (participants || []).map((row) => row.user_id).filter(Boolean);
  if (!recipientIds.length) return json({ sent: 0 });

  const { data: senderProfile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", message.sender_id)
    .maybeSingle();

  const senderName = senderProfile?.full_name || "New message";
  let body = "New message";
  if (message.image_url) {
    const path = String(message.image_url).toLowerCase();
    body = /\.(mp4|mov|m4v|webm|ogg|ogv)$/.test(path) ? "🎥 Video" : "📷 Photo";
    if (message.content) body += ` — ${String(message.content).slice(0, 100)}`;
  } else if (message.content) {
    body = String(message.content).slice(0, 140);
  }

  const { data: subscriptions, error: subscriptionError } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth, user_id")
    .in("user_id", recipientIds);

  if (subscriptionError) return json({ error: subscriptionError.message }, 500);

  const notificationPayload = JSON.stringify({
    title: senderName,
    body,
    conversationId: message.conversation_id,
    messageId: message.id,
    url: "./",
    tag: `forever-${message.conversation_id}`
  });

  let sent = 0;
  let removed = 0;

  for (const subscription of subscriptions || []) {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth }
      }, notificationPayload);
      sent += 1;
    } catch (error) {
      const statusCode = error?.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await supabase.from("push_subscriptions").delete().eq("id", subscription.id);
        removed += 1;
      } else {
        console.error("Push delivery failed", subscription.id, error);
      }
    }
  }

  return json({ sent, removed, recipients: recipientIds.length });
});
