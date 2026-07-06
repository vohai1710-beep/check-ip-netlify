import { getStore } from "@netlify/blobs";

const STORE_NAME = "check-ip-devices";
const DEVICE_PREFIX = "device/";
const DEFAULT_ADMIN_PASSWORD = "123456";
const ONLINE_WINDOW_MS = Number(process.env.ONLINE_WINDOW_MS || 6 * 60 * 1000);
const MAX_NAME_LENGTH = 40;

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS
  });
}

async function readBody(req) {
  if (req.method === "GET") {
    const url = new URL(req.url);
    return Object.fromEntries(url.searchParams.entries());
  }

  try {
    return await req.json();
  } catch {
    return {};
  }
}

function cleanName(name) {
  return String(name || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME_LENGTH);
}

function validDeviceId(id) {
  return typeof id === "string" && /^[a-zA-Z0-9_-]{8,100}$/.test(id);
}

function createDeviceId() {
  return crypto.randomUUID();
}

function deviceKey(id) {
  return `${DEVICE_PREFIX}${id}.json`;
}

function getClientIp(req, context) {
  const fromContext = context?.ip || "";
  const fromNetlify = req.headers.get("x-nf-client-connection-ip") || "";
  const fromForwarded = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  const fromClient = req.headers.get("client-ip") || "";

  return String(fromContext || fromNetlify || fromForwarded || fromClient || "unknown").trim();
}

async function getDevice(store, id) {
  if (!validDeviceId(id)) return null;

  const raw = await store.get(deviceKey(id), { consistency: "strong" });
  if (raw === null || raw === undefined) return null;

  try {
    const text = typeof raw === "string" ? raw : await raw.text();
    const device = JSON.parse(text);
    return device && device.id === id ? device : null;
  } catch {
    return null;
  }
}

async function saveDevice(store, device) {
  const cleanDevice = {
    id: device.id,
    name: cleanName(device.name),
    ip: String(device.ip || "unknown"),
    firstSeenMs: Number(device.firstSeenMs || Date.now()),
    lastSeenMs: Number(device.lastSeenMs || Date.now()),
    firstSeenAt: new Date(Number(device.firstSeenMs || Date.now())).toISOString(),
    lastSeenAt: new Date(Number(device.lastSeenMs || Date.now())).toISOString(),
    userAgent: String(device.userAgent || "").slice(0, 300)
  };

  await store.set(deviceKey(cleanDevice.id), JSON.stringify(cleanDevice), {
    metadata: {
      name: cleanDevice.name,
      ip: cleanDevice.ip.slice(0, 120),
      lastSeenMs: cleanDevice.lastSeenMs
    }
  });

  return cleanDevice;
}

async function listDevices(store) {
  const { blobs } = await store.list({ prefix: DEVICE_PREFIX });
  const devices = [];

  for (const blob of blobs || []) {
    const raw = await store.get(blob.key, { consistency: "strong" });
    if (raw === null || raw === undefined) continue;

    try {
      const text = typeof raw === "string" ? raw : await raw.text();
      const device = JSON.parse(text);
      if (device && validDeviceId(device.id)) devices.push(device);
    } catch {
      // Bỏ qua bản ghi lỗi để trang quản lý vẫn chạy.
    }
  }

  return devices;
}

function decorate(devices) {
  const now = Date.now();
  const normalized = devices.map((device) => ({
    id: device.id,
    name: cleanName(device.name),
    ip: String(device.ip || "unknown"),
    firstSeenMs: Number(device.firstSeenMs || 0),
    lastSeenMs: Number(device.lastSeenMs || 0),
    firstSeenAt: device.firstSeenAt || "",
    lastSeenAt: device.lastSeenAt || "",
    userAgent: String(device.userAgent || ""),
    online: now - Number(device.lastSeenMs || 0) <= ONLINE_WINDOW_MS,
    lastSeenAgoSec: Math.max(0, Math.round((now - Number(device.lastSeenMs || 0)) / 1000)),
    duplicate: false,
    duplicateWith: []
  }));

  const ipGroups = new Map();
  for (const device of normalized) {
    if (!device.online || !device.ip || device.ip === "unknown") continue;
    if (!ipGroups.has(device.ip)) ipGroups.set(device.ip, []);
    ipGroups.get(device.ip).push(device);
  }

  const duplicateGroups = [];
  for (const [ip, group] of ipGroups.entries()) {
    if (group.length <= 1) continue;

    duplicateGroups.push({
      ip,
      count: group.length,
      devices: group.map((device) => ({
        id: device.id,
        name: device.name || "Chưa đặt tên"
      }))
    });

    for (const device of group) {
      device.duplicate = true;
      device.duplicateWith = group
        .filter((item) => item.id !== device.id)
        .map((item) => item.name || "Chưa đặt tên");
    }
  }

  normalized.sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    const nameCompare = (a.name || "zz").localeCompare(b.name || "zz", "vi", { numeric: true });
    if (nameCompare !== 0) return nameCompare;
    return b.lastSeenMs - a.lastSeenMs;
  });

  return {
    devices: normalized,
    duplicateGroups,
    summary: {
      total: normalized.length,
      online: normalized.filter((device) => device.online).length,
      offline: normalized.filter((device) => !device.online).length,
      duplicateGroupCount: duplicateGroups.length,
      duplicateDeviceCount: normalized.filter((device) => device.duplicate).length,
      uniqueOnlineIpCount: new Set(
        normalized
          .filter((device) => device.online && device.ip && device.ip !== "unknown")
          .map((device) => device.ip)
      ).size,
      onlineWindowSec: Math.round(ONLINE_WINDOW_MS / 1000)
    }
  };
}

function isAdmin(body) {
  const expected = process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;
  return typeof body.adminPassword === "string" && body.adminPassword === expected;
}

function adminMeta() {
  return {
    usingDefaultPassword: !process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD === DEFAULT_ADMIN_PASSWORD,
    onlineWindowSec: Math.round(ONLINE_WINDOW_MS / 1000)
  };
}

function publicDevice(device) {
  return {
    id: device.id,
    name: device.name || "",
    ip: device.ip || "unknown",
    firstSeenAt: device.firstSeenAt || "",
    lastSeenAt: device.lastSeenAt || ""
  };
}

export default async function handler(req, context) {
  if (req.method === "OPTIONS") {
    return new Response("", { status: 204, headers: JSON_HEADERS });
  }

  const body = await readBody(req);
  const action = body.action || (req.method === "GET" ? "health" : "heartbeat");
  const store = getStore({ name: STORE_NAME, consistency: "strong" });
  const now = Date.now();

  try {
    if (action === "health") {
      return json({ ok: true, message: "API OK", meta: adminMeta() });
    }

    if (action === "heartbeat") {
      const existingId = validDeviceId(body.deviceId) ? body.deviceId : createDeviceId();
      const existing = await getDevice(store, existingId);
      const device = existing || {
        id: existingId,
        name: cleanName(body.name),
        firstSeenMs: now
      };

      device.ip = getClientIp(req, context);
      device.lastSeenMs = now;
      device.userAgent = req.headers.get("user-agent") || "";

      const saved = await saveDevice(store, device);

      return json({
        ok: true,
        deviceId: saved.id,
        device: publicDevice(saved),
        meta: adminMeta()
      });
    }

    if (action === "rename") {
      const id = validDeviceId(body.deviceId) ? body.deviceId : createDeviceId();
      const name = cleanName(body.name);
      if (!name) return json({ ok: false, message: "Bạn chưa nhập tên máy." }, 400);

      const existing = await getDevice(store, id);
      const device = existing || { id, firstSeenMs: now };
      device.name = name;
      device.ip = getClientIp(req, context);
      device.lastSeenMs = now;
      device.userAgent = req.headers.get("user-agent") || "";

      const saved = await saveDevice(store, device);

      return json({
        ok: true,
        deviceId: saved.id,
        device: publicDevice(saved),
        meta: adminMeta()
      });
    }

    if (action === "checkDuplicate") {
      if (!validDeviceId(body.deviceId)) return json({ ok: false, message: "Thiếu mã máy." }, 400);

      const devices = await listDevices(store);
      const decorated = decorate(devices);
      const current = decorated.devices.find((device) => device.id === body.deviceId);

      if (!current) return json({ ok: false, message: "Chưa thấy máy này trong hệ thống." }, 404);

      return json({
        ok: true,
        current,
        duplicate: current.duplicate,
        duplicateWith: current.duplicateWith,
        duplicateGroups: decorated.duplicateGroups,
        summary: decorated.summary
      });
    }

    if (action === "adminList") {
      if (!isAdmin(body)) return json({ ok: false, message: "Sai mật khẩu quản lý." }, 401);

      const devices = await listDevices(store);
      const decorated = decorate(devices);

      return json({
        ok: true,
        ...decorated,
        meta: adminMeta()
      });
    }

    if (action === "adminRename") {
      if (!isAdmin(body)) return json({ ok: false, message: "Sai mật khẩu quản lý." }, 401);
      if (!validDeviceId(body.deviceId)) return json({ ok: false, message: "Mã máy không hợp lệ." }, 400);

      const name = cleanName(body.name);
      if (!name) return json({ ok: false, message: "Tên máy không được để trống." }, 400);

      const existing = await getDevice(store, body.deviceId);
      if (!existing) return json({ ok: false, message: "Không tìm thấy máy." }, 404);

      existing.name = name;
      const saved = await saveDevice(store, existing);

      return json({ ok: true, device: publicDevice(saved) });
    }

    if (action === "adminDelete") {
      if (!isAdmin(body)) return json({ ok: false, message: "Sai mật khẩu quản lý." }, 401);
      if (!validDeviceId(body.deviceId)) return json({ ok: false, message: "Mã máy không hợp lệ." }, 400);

      await store.delete(deviceKey(body.deviceId));
      return json({ ok: true });
    }

    if (action === "adminResetAll") {
      if (!isAdmin(body)) return json({ ok: false, message: "Sai mật khẩu quản lý." }, 401);
      if (body.confirmText !== "XOA") return json({ ok: false, message: "Để xóa toàn bộ, nhập đúng chữ XOA." }, 400);

      const { blobs } = await store.list({ prefix: DEVICE_PREFIX });
      let deleted = 0;
      for (const blob of blobs || []) {
        await store.delete(blob.key);
        deleted += 1;
      }

      return json({ ok: true, deleted });
    }

    return json({ ok: false, message: "Action không hợp lệ." }, 400);
  } catch (error) {
    return json({
      ok: false,
      message: "Lỗi server. Kiểm tra Netlify Function logs.",
      detail: error instanceof Error ? error.message : String(error)
    }, 500);
  }
}

export const config = {
  path: "/api"
};
