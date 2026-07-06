# Web check IP + đăng ký tên máy một lần trên Netlify

Bản này dùng:

- `public/` để chứa giao diện web.
- `netlify/functions/api.mjs` để check IP, lưu tên máy, quản lý trùng IP.
- Netlify Blobs để lưu dữ liệu từng máy.

## Link sử dụng sau khi deploy

- Trang cho từng máy: `https://ten-site-cua-ban.netlify.app/`
- Trang quản lý: `https://ten-site-cua-ban.netlify.app/admin.html`

## Mật khẩu quản lý

Mặc định tạm thời là:

```text
123456
```

Nên đổi ngay bằng cách vào Netlify:

```text
Project configuration → Environment variables → Add variable
Key: ADMIN_PASSWORD
Value: mật khẩu bạn muốn đặt
```

Sau đó vào:

```text
Deploys → Trigger deploy → Deploy site
```

## Cách máy được nhận diện

Máy được nhận diện bằng `localStorage` trong trình duyệt.

- Lần đầu máy vào web → web tạo mã máy.
- Bạn nhập tên, ví dụ `Máy 1`.
- Các lần sau máy đó mở đúng trình duyệt cũ → vẫn hiện `Máy 1`.

Nếu xóa dữ liệu trình duyệt, dùng tab ẩn danh hoặc trình duyệt khác thì web có thể coi đó là máy mới.

## Tần suất cập nhật để tiết kiệm miễn phí

Mặc định máy tự gửi tín hiệu mỗi 180 giây. Muốn đổi thì mở file:

```text
public/app.js
```

Tìm dòng:

```js
const DEVICE_PING_SECONDS = 180;
```

Ví dụ muốn 60 giây thì đổi thành:

```js
const DEVICE_PING_SECONDS = 60;
```

Không nên để 64 máy tự cập nhật quá nhanh 24/24 nếu muốn giữ gói Netlify miễn phí.
