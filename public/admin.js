const ADMIN_PASSWORD_KEY = "check_ip_admin_password_session_v1";
const ADMIN_REFRESH_SECONDS = 20;

const $ = (selector) => document.querySelector(selector);

let adminPassword = sessionStorage.getItem(ADMIN_PASSWORD_KEY) || "";
let latestData = null;

async function api(action, payload = {}) {
  const res = await fetch("/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, adminPassword, ...payload })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.message || "Không gọi được API.");
  }
  return data;
}

function showLoginMessage(text, type = "bad") {
  const box = $("#loginMessage");
  box.textContent = text;
  box.className = `message ${type}`;
}

function showAdmin() {
  $("#loginCard").classList.add("hidden");
  $("#adminPanel").classList.remove("hidden");
}

function showLogin() {
  $("#loginCard").classList.remove("hidden");
  $("#adminPanel").classList.add("hidden");
}

function formatAgo(sec) {
  if (sec < 60) return `${sec}s trước`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} phút trước`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} giờ trước`;
  return `${Math.floor(hour / 24)} ngày trước`;
}

function escapeHtml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function render(data) {
  latestData = data;
  const summary = data.summary || {};

  $("#totalCount").textContent = summary.total || 0;
  $("#onlineCount").textContent = summary.online || 0;
  $("#uniqueIpCount").textContent = summary.uniqueOnlineIpCount || 0;
  $("#dupCount").textContent = summary.duplicateDeviceCount || 0;
  $("#refreshInfo").textContent = `Cập nhật lúc ${new Date().toLocaleString("vi-VN")}. Máy offline sau khoảng ${summary.onlineWindowSec || "?"} giây không gửi tín hiệu.`;

  const warning = $("#adminWarning");
  if (data.meta?.usingDefaultPassword) {
    warning.className = "message warn";
    warning.innerHTML = "Bạn đang dùng mật khẩu mặc định <b>123456</b>. Nên vào Netlify đặt biến môi trường <b>ADMIN_PASSWORD</b> ngay.";
  } else {
    warning.className = "message warn hidden";
  }

  const dupGroups = $("#dupGroups");
  if (!data.duplicateGroups || data.duplicateGroups.length === 0) {
    dupGroups.innerHTML = `<div class="duplicate-box good">OK: Chưa thấy IP nào bị trùng giữa các máy online.</div>`;
  } else {
    dupGroups.innerHTML = data.duplicateGroups.map((group) => `
      <div class="duplicate-box bad">
        <b>TRÙNG IP ${escapeHtml(group.ip)}</b><br>
        ${group.devices.map((device) => escapeHtml(device.name || "Chưa đặt tên")).join(", ")}
      </div>
    `).join("");
  }

  const rows = $("#deviceRows");
  if (!data.devices || data.devices.length === 0) {
    rows.innerHTML = `<tr><td colspan="7" class="empty">Chưa có máy nào truy cập.</td></tr>`;
    return;
  }

  rows.innerHTML = data.devices.map((device) => `
    <tr class="${device.duplicate ? "row-bad" : ""} ${device.online ? "" : "row-offline"}">
      <td><b>${escapeHtml(device.name || "Chưa đặt tên")}</b></td>
      <td class="mono">${escapeHtml(device.ip)}</td>
      <td>${device.online ? '<span class="pill ok">Online</span>' : '<span class="pill off">Offline</span>'}</td>
      <td>${device.duplicate ? `<span class="pill bad">${escapeHtml(device.duplicateWith.join(", "))}</span>` : '<span class="muted">Không</span>'}</td>
      <td title="${escapeHtml(device.lastSeenAt)}">${formatAgo(device.lastSeenAgoSec)}</td>
      <td class="mono small">${escapeHtml(device.id)}</td>
      <td>
        <button class="mini" data-action="rename" data-id="${escapeHtml(device.id)}" data-name="${escapeHtml(device.name || "")}">Đổi tên</button>
        <button class="mini danger ghost" data-action="delete" data-id="${escapeHtml(device.id)}">Xóa</button>
      </td>
    </tr>
  `).join("");
}

async function loadData() {
  const data = await api("adminList");
  showAdmin();
  render(data);
}

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  adminPassword = $("#passwordInput").value;
  sessionStorage.setItem(ADMIN_PASSWORD_KEY, adminPassword);

  try {
    await loadData();
  } catch (error) {
    showLoginMessage(error.message, "bad");
  }
});

$("#refreshBtn").addEventListener("click", () => {
  loadData().catch((error) => alert(error.message));
});

$("#logoutBtn").addEventListener("click", () => {
  sessionStorage.removeItem(ADMIN_PASSWORD_KEY);
  adminPassword = "";
  showLogin();
});

$("#resetBtn").addEventListener("click", async () => {
  const text = prompt("Xóa toàn bộ danh sách máy? Nhập đúng chữ XOA để xác nhận:");
  if (text !== "XOA") return;

  try {
    const result = await api("adminResetAll", { confirmText: "XOA" });
    alert(`Đã xóa ${result.deleted} máy.`);
    await loadData();
  } catch (error) {
    alert(error.message);
  }
});

$("#exportBtn").addEventListener("click", () => {
  if (!latestData?.devices) return;
  const header = ["ten_may", "ip", "online", "trung_ip", "trung_voi", "last_seen", "device_id"];
  const lines = latestData.devices.map((device) => [
    device.name || "Chưa đặt tên",
    device.ip,
    device.online ? "online" : "offline",
    device.duplicate ? "co" : "khong",
    (device.duplicateWith || []).join(" | "),
    device.lastSeenAt,
    device.id
  ].map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(","));

  const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `check-ip-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

$("#deviceRows").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const id = button.dataset.id;
  const action = button.dataset.action;

  try {
    if (action === "rename") {
      const currentName = button.dataset.name || "";
      const name = prompt("Nhập tên mới:", currentName);
      if (!name) return;
      await api("adminRename", { deviceId: id, name });
      await loadData();
    }

    if (action === "delete") {
      if (!confirm("Xóa máy này khỏi danh sách quản lý?")) return;
      await api("adminDelete", { deviceId: id });
      await loadData();
    }
  } catch (error) {
    alert(error.message);
  }
});

if (adminPassword) {
  loadData().catch(() => {
    sessionStorage.removeItem(ADMIN_PASSWORD_KEY);
    showLogin();
  });
}

setInterval(() => {
  if (!adminPassword || document.hidden) return;
  loadData().catch(() => {});
}, ADMIN_REFRESH_SECONDS * 1000);
