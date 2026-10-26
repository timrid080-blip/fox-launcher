/**
 * Fox Launcher sound CDN worker.
 * Bind an R2 bucket as SOUND_BUCKET and configure secrets in Cloudflare.
 * Never put service-role keys or upload credentials in the Electron client.
 */
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const ALLOWED_EXT = new Set([".mp3", ".wav", ".ogg", ".m4a"]);
const MIME = { ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".m4a": "audio/mp4" };
const SOUND_PREFIX = "sounds/";

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), { status, headers: {
    "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
    "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type", ...extraHeaders,
  }});
}
function safeFilename(value) {
  const name = String(value || "").normalize("NFC").replace(/[\/\\]/g, "_").replace(/[^\p{L}\p{N}._() -]/gu, "_").trim();
  if (!name || name === "." || name === ".." || name.length > 150 || name.startsWith(".")) return null;
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  return ALLOWED_EXT.has(ext) ? { name, ext } : null;
}
async function requireOwner(request, env) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return null;
  const token = authorization.slice(7);
  const base = env.SUPABASE_URL.replace(/\/$/, "");
  const userResponse = await fetch(base + "/auth/v1/user", { headers: {
    apikey: env.SUPABASE_ANON_KEY, authorization: "Bearer " + token,
  }});
  if (!userResponse.ok) return null;
  const user = await userResponse.json();
  if (!user?.id) return null;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const adminResponse = await fetch(base + "/rest/v1/fox_admins?id=eq." + encodeURIComponent(user.id) + "&select=id&limit=1", {
    headers: { apikey: serviceKey, authorization: "Bearer " + serviceKey },
  });
  if (!adminResponse.ok) throw new Error("Не удалось проверить права владельца");
  const admins = await adminResponse.json();
  return Array.isArray(admins) && admins.length > 0 ? user : null;
}
async function listManifest(env) {
  const items = [];
  let cursor;
  do {
    const page = await env.SOUND_BUCKET.list({ prefix: SOUND_PREFIX, cursor, limit: 1000 });
    for (const object of page.objects) {
      const name = object.key.slice(SOUND_PREFIX.length);
      const valid = safeFilename(name);
      if (!valid) continue;
      items.push({
        name, url: env.SOUND_CDN_BASE_URL.replace(/\/$/, "") + "/sounds/" + name.split("/").map(encodeURIComponent).join("/"),
        size: object.size, etag: object.etag, updatedAt: object.uploaded?.toISOString?.() || null,
      });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  items.sort((a, b) => a.name.localeCompare(b.name));
  return { version: items.map(x => x.etag).join(".").slice(0, 160), updatedAt: new Date().toISOString(), sounds: items };
}
export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: {
      "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "authorization, content-type", "access-control-max-age": "86400",
    }});
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") return json({ ok: true, service: "fox-sound-cdn" });
    if (url.pathname === "/manifest.json" && request.method === "GET") {
      try { return json(await listManifest(env), 200, { "cache-control": "public, max-age=15, s-maxage=15" }); }
      catch { return json({ error: "Не удалось получить список звуков" }, 503); }
    }
    if (url.pathname === "/upload" && request.method === "POST") {
      let owner;
      try { owner = await requireOwner(request, env); }
      catch { return json({ error: "Не удалось проверить права владельца" }, 503); }
      if (!owner) return json({ error: "Загрузка доступна только владельцу Fox Launcher" }, 403);
      let form;
      try { form = await request.formData(); } catch { return json({ error: "Ожидалась multipart-загрузка файла" }, 400); }
      const file = form.get("file");
      if (!(file instanceof File)) return json({ error: "Файл не передан" }, 400);
      const safe = safeFilename(file.name);
      if (!safe) return json({ error: "Разрешены только MP3, WAV, OGG и M4A с безопасным именем" }, 400);
      if (file.size < 1 || file.size > MAX_FILE_BYTES) return json({ error: "Размер файла должен быть до 15 МБ" }, 413);
      await env.SOUND_BUCKET.put(SOUND_PREFIX + safe.name, file.stream(), {
        httpMetadata: { contentType: MIME[safe.ext], cacheControl: "public, max-age=31536000, immutable" },
        customMetadata: { uploadedBy: owner.id, originalName: safe.name },
      });
      return json({ ok: true, name: safe.name, size: file.size, message: "Звук загружен. Manifest обновится в течение 30 секунд." }, 201);
    }
    return json({ error: "Маршрут не найден" }, 404);
  },
};
