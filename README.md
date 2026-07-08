# 🤖 Auto Engagement Bot - Facebook

Tự động theo dõi Facebook Page, thả cảm xúc và bình luận khi có bài viết mới từ tài khoản cá nhân.

## Tính năng

- ✅ Theo dõi **nhiều** Facebook Page cùng lúc.
- ✅ Tự động thả cảm xúc (Like, Love, Haha, Wow, Sad, Angry).
- ✅ Tự động bình luận với nội dung tùy chỉnh ngẫu nhiên.
- ✅ Lưu lại lịch sử bài đã xử lý vào file JSON để tránh tương tác trùng.
- ✅ Cơ chế cuộn trang và lọc bài viết thông minh (tránh tương tác nhầm vào bình luận hoặc bài share).
- ✅ Delay ngẫu nhiên giữa các thao tác để giả lập người dùng thật.
- ✅ Sử dụng Browser Profile để giữ phiên đăng nhập lâu dài.

## Cài đặt và Chạy

1. **Cài đặt thư viện:**
```bash
npm install
```

2. **Cấu hình:**
Chỉnh sửa các thông số trong file `config.json` (xem chi tiết ở phần dưới).

3. **Khởi chạy:**
```bash
npm start
```

**Lưu ý:** Lần đầu chạy, trình duyệt sẽ mở ra. Nếu chưa đăng nhập, bạn hãy tự tay đăng nhập vào Facebook, sau đó quay lại terminal nhấn **Enter**. Các lần sau bot sẽ tự động sử dụng phiên đăng nhập cũ.

## Cấu hình (config.json)

```json
{
  "pageUrls": [
    "https://www.facebook.com/profile.php?id=xx",
    "https://www.facebook.com/profile.php?id=xxx"
  ],
  "checkIntervalMinutes": 5,
  "maxPostsPerCycle": 5,
  "reaction": "love",
  "comments": [
    "Tuyệt vời 🥰",
    "Bài viết hay quá!"
  ],
  "delayBetweenActions": {
    "minSeconds": 5,
    "maxSeconds": 10
  }
}
```

| Tham số | Mô tả |
|---------|--------|
| `pageUrls` | Danh sách URL các Fanpage/Profile cần theo dõi |
| `checkIntervalMinutes` | Thời gian nghỉ giữa các chu kỳ kiểm tra (phút) |
| `maxPostsPerCycle` | Số bài viết mới tối đa được tương tác trong 1 chu kỳ (mặc định 5). Bài còn dư sẽ được xử lý ở chu kỳ sau |
| `reaction` | Loại cảm xúc: `like`, `love`, `haha`, `wow`, `sad`, `angry` |
| `comments` | Danh sách các câu bình luận (Bot sẽ chọn ngẫu nhiên) |
| `delayBetweenActions` | Khoảng thời gian chờ ngẫu nhiên giữa các bước (giây) |

## Cấu trúc thư mục

```
fb-automation/
├── src/
│   ├── auto-engage.js   # Logic chính điều khiển trình duyệt
│   ├── utils.js         # Các hàm tiện ích (log, delay, xử lý URL)
│   └── store.js         # Quản lý cơ sở dữ liệu bài viết đã tương tác
├── data/                # Nơi lưu trữ file JSON lịch sử
├── .browser-profile/    # Nơi lưu trữ cookie/session đăng nhập
├── config.json          # File cấu hình của người dùng
└── package.json         # Khai báo thư viện (Puppeteer)
```

## Lưu ý an toàn

⚠️ Tool này sử dụng tự động hóa. Để tránh bị Facebook quét:
1. Không nên đặt `checkIntervalMinutes` quá ngắn (nên từ 5-15 phút trở lên).
2. Danh sách `comments` nên đa dạng nội dung.
3. Luôn sử dụng Browser Profile để tránh phải đăng nhập lại nhiều lần dẫn đến checkpoint.

## Giấy phép
MIT
