const MAX_RESPONSE_BYTES = 128_000;
async function resultJson(response) {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_RESPONSE_BYTES) throw new Error("TELEGRAM_RESPONSE_INVALID");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("TELEGRAM_RESPONSE_INVALID");
  const chunks = [];
  let length = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("TELEGRAM_RESPONSE_INVALID");
    }
    chunks.push(value);
  }
  const data = Buffer.concat(chunks, length);
  let parsed;
  try { parsed = JSON.parse(data.toString("utf8")); }
  catch { throw new Error("TELEGRAM_RESPONSE_INVALID"); }
  if (!response.ok || parsed?.ok !== true) {
    if (response.status === 409) throw new Error("TELEGRAM_WEBHOOK_CONFLICT");
    if (response.status === 401 || response.status === 403)
      throw new Error("TELEGRAM_AUTH_UNAVAILABLE");
    throw new Error("TELEGRAM_UNAVAILABLE");
  }
  return parsed.result;
}

export function createTelegramClient({ token, fetchImpl = fetch } = {}) {
  if (typeof token !== "string" || !/^\d{5,15}:[A-Za-z0-9_-]{20,}$/.test(token))
    throw new Error("TELEGRAM_TOKEN_UNAVAILABLE");
  async function call(method, body, timeoutMs, signal) {
    let response;
    try {
      response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST", redirect: "error", cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
          : AbortSignal.timeout(timeoutMs),
      });
    } catch { throw new Error("TELEGRAM_NETWORK_UNAVAILABLE"); }
    return resultJson(response);
  }
  return Object.freeze({
    async getMe() {
      const me = await call("getMe", {}, 10_000);
      if (!me || me.is_bot !== true ||
          !Number.isSafeInteger(me.id) ||
          !/^[A-Za-z0-9_]{5,32}$/.test(me.username ?? ""))
        throw new Error("TELEGRAM_IDENTITY_INVALID");
      return { id: me.id, username: me.username };
    },
    async getUpdates(offset, signal) {
      if (!Number.isSafeInteger(offset) || offset < 0)
        throw new Error("TELEGRAM_OFFSET_INVALID");
      const updates = await call("getUpdates", { offset, limit: 10,
        timeout: 20, allowed_updates: ["message", "callback_query"] }, 26_000, signal);
      if (!Array.isArray(updates) || updates.length > 10 ||
          updates.some((item) => !Number.isSafeInteger(item.update_id)))
        throw new Error("TELEGRAM_RESPONSE_INVALID");
      return updates;
    },
    async sendOwnerMessage(chatId, text) {
      if (!Number.isSafeInteger(chatId) || chatId <= 0 ||
          typeof text !== "string" || !text || text.length > 1200)
        throw new Error("TELEGRAM_SEND_DENIED");
      return call("sendMessage", { chat_id: chatId, text,
        disable_notification: true, protect_content: true }, 12_000);
    },
    async sendOwnerApproval(chatId, text, replyMarkup) {
      if (!Number.isSafeInteger(chatId) || chatId <= 0 ||
          typeof text !== "string" || !text || text.length > 1200 ||
          !Array.isArray(replyMarkup?.inline_keyboard) ||
          replyMarkup.inline_keyboard.length !== 1 ||
          replyMarkup.inline_keyboard[0].length !== 3 ||
          replyMarkup.inline_keyboard[0].some((b) =>
            !["Aprovar", "Rejeitar", "Ver detalhes"].includes(b.text) ||
            !/^t:[0-9a-f-]{36}:[ARD]$/.test(b.callback_data ?? "")))
        throw new Error("TELEGRAM_SEND_DENIED");
      return call("sendMessage", { chat_id: chatId, text,
        reply_markup: replyMarkup, disable_notification: true,
        protect_content: true }, 12_000);
    },
    async sendOwnerDetails(chatId, text, replyMarkup) {
      const buttons = replyMarkup?.inline_keyboard;
      if (!Number.isSafeInteger(chatId) || chatId <= 0 ||
          typeof text !== "string" || !text || text.length > 1200 ||
          !Array.isArray(buttons) || buttons.length !== 1 ||
          buttons[0]?.length !== 1 ||
          buttons[0][0]?.text !== "Ver detalhes" ||
          !/^v:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(
            buttons[0][0]?.callback_data ?? ""))
        throw new Error("TELEGRAM_SEND_DENIED");
      return call("sendMessage", { chat_id: chatId, text,
        reply_markup: replyMarkup, disable_notification: true,
        protect_content: true }, 12_000);
    },
    async answerCallbackQuery(id, text) {
      if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id) ||
          typeof text !== "string" || text.length > 200)
        throw new Error("TELEGRAM_CALLBACK_DENIED");
      return call("answerCallbackQuery", { callback_query_id: id,
        text, show_alert: false }, 10_000);
    },
  });
}
