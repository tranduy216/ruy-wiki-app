# Ruy Wiki — Cộng đồng đầu tư chứng khoán

Web tĩnh chia sẻ kiến thức đầu tư chứng khoán, chạy trực tiếp trên **GitHub Pages**.

## Tính năng

- 📈 **Cơ hội** — Phân tích và chia sẻ cơ hội đầu tư với template sẵn có
- 💬 **Chia sẻ** — Đăng bài chia sẻ kiến thức, kinh nghiệm tự do
- 🔐 Bảo vệ bằng mật khẩu khi viết bài
- ✍️ Soạn thảo Markdown, hiển thị ra HTML đẹp
- 💾 Lưu trữ dữ liệu ngay trên trình duyệt (localStorage)
- 📱 Responsive, hoạt động tốt trên mobile

## Cách bật GitHub Pages

1. Vào **Settings** của repository
2. Tìm mục **Pages** (trong thanh bên trái)
3. Mục **Source** → chọn **Deploy from a branch**
4. Branch: `main` (hoặc `master`), Folder: `/ (root)`
5. Nhấn **Save**
6. Sau khoảng 1–2 phút, truy cập `https://<username>.github.io/<repo-name>/`

## Sử dụng

| Thao tác | Hướng dẫn |
|---|---|
| Xem bài viết | Click vào tiêu đề bài |
| Viết bài | Nhấn nút **✏️ Viết bài**, nhập mật khẩu `duy@123456` |
| Xóa bài | Hover vào card → nút 🗑 Xóa, hoặc nút trong trang chi tiết |

## Công nghệ

- HTML5 + CSS3 + Vanilla JavaScript
- [marked.js](https://marked.js.org/) — render Markdown → HTML (CDN)
- localStorage — lưu trữ dữ liệu phía client

> **Lưu ý:** Dữ liệu bài viết được lưu trong **localStorage** của trình duyệt,
> chỉ tồn tại trên máy tính đó. Xóa cache trình duyệt sẽ mất dữ liệu.
