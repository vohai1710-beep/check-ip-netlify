const DEVICE_ID_KEY = "check_ip_device_id_v1";
const DEVICE_PING_SECONDS = 180; // Miễn phí: 180 giây/lần. Muốn nhanh hơn có thể đổi thành 60.

const $ = (selector) => document.querySelector(selector);

const state = {
  deviceId: localStorage.getItem(DEVICE_ID_KEY) || "",
  device: null
};

function showMessage(text, type = "ok") {
  const box = $("#message");
  box.textContent = text;
  box.className = `message ${type}`;
}

function hideMessage() {
  $("#message").className = "message hidden";
}

async function api(action, payload = {}) {
  const res = await fetch("/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.message || "Không gọi được API.");
  }
  return data;
}

function render() {
  const device = state.device || {};
  const hasName = Boolean(device.name);

  $("#deviceName").textContent = hasName ? device.name : "Chưa đặt tên";
  $("#deviceName").classList.toggle("unnamed", !hasName);
  $("#deviceIp").textContent = device.ip || "Đang tải...";
  $("#deviceId").textContent = state.deviceId ? `Mã máy: ${state.deviceId}` : "";
  $("#lastSeen").textContent = device.lastSeenAt ? `Cập nhật: ${new Date(device.lastSeenAt).toLocaleString("vi-VN")}` : "";
  $("#nameInput").value = device.name || "";
}

async function heartbeat(showOk = false) {
  hideMessage();
  const data = await api("heartbeat", { deviceId: state.deviceId });
  state.deviceId = data.deviceId;
  state.device = data.device;
  localStorage.setItem(DEVICE_ID_KEY, state.deviceId);
  render();

  if (showOk) showMessage(`Đã cập nhật IP: ${data.device.ip}`, "ok");
}

async function rename(name) {
  const data = await api("rename", { deviceId: state.deviceId, name });
  state.deviceId = data.deviceId;
  state.device = data.device;
  localStorage.setItem(DEVICE_ID_KEY, state.deviceId);
  render();
  showMessage(`Đã lưu tên: ${data.device.name}`, "ok");
}

async function checkDuplicate() {
  const box = $("#duplicateBox");
  box.className = "duplicate-box muted";
  box.textContent = "Đang kiểm tra...";

  await heartbeat(false);
  const data = await api("checkDuplicate", { deviceId: state.deviceId });

  if (data.duplicate) {
    box.className = "duplicate-box bad";
    box.innerHTML = `TRÙNG IP <b>${data.current.ip}</b> với: <b>${data.duplicateWith.join(", ")}</b>`;
  } else {
    box.className = "duplicate-box good";
    box.innerHTML = `OK: IP <b>${data.current.ip}</b> chưa trùng với máy online khác.`;
  }
}

$("#renameForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = $("#nameInput").value.trim();
  try {
    await rename(name);
  } catch (error) {
    showMessage(error.message, "bad");
  }
});

$("#refreshBtn").addEventListener("click", async () => {
  try {
    await heartbeat(true);
  } catch (error) {
    showMessage(error.message, "bad");
  }
});

$("#checkDupBtn").addEventListener("click", async () => {
  try {
    await checkDuplicate();
  } catch (error) {
    $("#duplicateBox").className = "duplicate-box bad";
    $("#duplicateBox").textContent = error.message;
  }
});

$("#forgetBtn").addEventListener("click", () => {
  const ok = confirm("Quên máy này trên trình duyệt hiện tại? Lần sau mở web sẽ tạo mã máy mới.");
  if (!ok) return;
  localStorage.removeItem(DEVICE_ID_KEY);
  location.reload();
});

heartbeat(false).catch((error) => showMessage(error.message, "bad"));

setInterval(() => {
  if (document.hidden) return;
  heartbeat(false).catch(() => {});
}, DEVICE_PING_SECONDS * 1000);
