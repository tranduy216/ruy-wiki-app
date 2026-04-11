# Ruy Wiki — Cộng đồng đầu tư chứng khoán

Web tĩnh chia sẻ kiến thức đầu tư chứng khoán, chạy trực tiếp trên **GitHub Pages**.  
Bài viết được lưu dưới dạng **GitHub Issues** → mọi người đều thấy bài mới ngay lập tức!

## Tính năng

| | |
|---|---|
| 📈 **Cơ hội** | Phân tích cổ phiếu với template sẵn có |
| 💬 **Chia sẻ** | Đăng bài tự do về kiến thức, kinh nghiệm |
| 🔐 **Bảo mật** | Mật khẩu bảo vệ tính năng viết bài |
| ✍️ **Markdown** | Soạn thảo Markdown, hiển thị HTML đẹp |
| 🌐 **Chia sẻ thật** | Bài viết = GitHub Issue, ai cũng thấy ngay |
| 📱 **Responsive** | Tối ưu trên cả mobile lẫn desktop |

## Cách bật GitHub Pages

1. Vào tab **Settings** của repository
2. Chọn **Pages** ở thanh bên trái
3. **Source** → `Deploy from a branch`
4. **Branch**: `main` · **Folder**: `/ (root)` → nhấn **Save**
5. Sau 1–2 phút truy cập: `https://tranduy216.github.io/ruy-wiki-app/`

## Cách viết bài

### Bước 1 — Tạo GitHub PAT (làm 1 lần duy nhất)

1. Truy cập [github.com/settings/tokens/new](https://github.com/settings/tokens/new?scopes=public_repo&description=Ruy+Wiki)
2. Điền **Note** bất kỳ (ví dụ: `Ruy Wiki`)
3. Tích quyền **`public_repo`**
4. Nhấn **Generate token** → copy token

### Bước 2 — Kết nối trên web

1. Vào web, nhấn **⚙️ Kết nối** trên navbar
2. Dán token vào ô → nhấn **Lưu**
3. Dấu chấm xanh 🟢 = đã kết nối thành công

### Bước 3 — Viết bài

1. Nhấn **✏️ Viết bài** → nhập mật khẩu `duy@123456`
2. Điền tiêu đề và nội dung Markdown
3. Nhấn **🚀 Đăng bài lên GitHub** → bài xuất hiện ngay!

> **Lưu ý:** Token chỉ lưu trong trình duyệt của bạn.  
> Người đọc không cần token — bài viết luôn hiển thị công khai.

## Kiến trúc

```
index.html  ←  toàn bộ ứng dụng (HTML + CSS + JS)
    │
    ├── Đọc bài:  GET /repos/.../issues?labels=co-hoi   (public, không cần token)
    ├── Viết bài: POST /repos/.../issues                (cần GitHub PAT)
    └── Xóa bài:  PATCH /repos/.../issues/:number       (cần GitHub PAT)
```

## Công nghệ

- **HTML5 + CSS3 + Vanilla JavaScript** — không cần build step
- **[marked.js](https://marked.js.org/) v18 (bundled inline)** — render Markdown → HTML, không phụ thuộc CDN
- **GitHub Issues API** — backend miễn phí, dữ liệu lưu trực tiếp trên GitHub
