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
├── .github/
│   └── workflows/
│       └── deploy.yml   # GitHub Actions: tự động deploy lên VPS khi push main
├── src/
│   ├── auto-engage.js   # Logic chính điều khiển trình duyệt
│   ├── utils.js         # Các hàm tiện ích (log, delay, xử lý URL)
│   └── store.js         # Quản lý cơ sở dữ liệu bài viết đã tương tác
├── data/                # Nơi lưu trữ file JSON lịch sử
├── .browser-profile/    # Nơi lưu trữ cookie/session đăng nhập
├── config.json          # File cấu hình của người dùng
├── ecosystem.config.js  # Cấu hình PM2 chạy bot trên VPS (qua xvfb)
└── package.json         # Khai báo thư viện (Puppeteer)
```

## Deploy tự động lên VPS (GitHub Actions)

Mỗi lần push code lên nhánh `main`, workflow `.github/workflows/deploy.yml` sẽ:

1. Chạy `npm run check` để kiểm tra cú pháp.
2. SSH vào VPS, kéo code mới (`git reset --hard origin/main`), cài dependencies và restart bot bằng PM2.

`config.json` trên VPS được backup/restore tự động trong lúc deploy, nên cấu hình thật trên server **không bị ghi đè** bởi file mẫu trong repo.

Ngoài ra có thể deploy thủ công không cần push: tab **Actions** → **Deploy to VPS** → **Run workflow**.

### 1. Chuẩn bị VPS (làm 1 lần)

```bash
sudo apt update && sudo apt install -y xvfb
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs
sudo npm i -g pm2
git clone https://github.com/hoaiphongpvt/auto-engagement-tool.git fb-bot && cd fb-bot
npm ci
# Tạo config.json thật trên server (file trong repo chỉ là mẫu)
pm2 startup   # chạy lệnh nó in ra để bot tự khởi động lại khi VPS reboot
```

Nếu Puppeteer báo thiếu thư viện hệ thống (`libnss3`, `libatk`...), chạy:

```bash
npx puppeteer browsers install chrome --install-deps
```

**Đăng nhập Facebook:** bot mở trình duyệt non-headless nên trên VPS phải chạy qua `xvfb` (đã cấu hình sẵn trong `ecosystem.config.js`). Cách đơn giản nhất để có phiên đăng nhập: đăng nhập trên máy cá nhân trước, rồi nén thư mục `.browser-profile/` copy lên VPS.

### 2. Tạo SSH key cho deploy

Chạy trên máy cá nhân (ví dụ dưới dùng PowerShell trên Windows):

```powershell
ssh-keygen -t ed25519 -C "github-deploy-fb-bot" -f "$HOME\.ssh\fb_bot_deploy"
# Bỏ trống passphrase (Enter). Đưa public key lên VPS:
type "$HOME\.ssh\fb_bot_deploy.pub" | ssh <user>@<ip-vps> "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys"
# Kiểm tra: phải in ra OK mà không hỏi password
ssh -i "$HOME\.ssh\fb_bot_deploy" <user>@<ip-vps> "echo OK"
```

### 3. Khai báo secrets trên GitHub

Vào repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:

| Secret | Giá trị |
|---------|--------|
| `SSH_HOST` | IP hoặc domain của VPS |
| `SSH_USER` | User SSH (vd: `ubuntu`) |
| `SSH_KEY` | Toàn bộ nội dung file private key (`fb_bot_deploy`), gồm cả dòng `BEGIN`/`END` |
| `SSH_PORT` | (Tùy chọn) Cổng SSH, mặc định 22 |
| `DEPLOY_PATH` | Đường dẫn repo đã clone trên VPS, vd `/home/ubuntu/fb-bot` |

**Lưu ý:** thư mục `DEPLOY_PATH` phải tồn tại và là repo đã clone (bước 1), nếu không workflow sẽ báo lỗi `cd: No such file or directory`. Không bao giờ commit private key vào repo.

## Lưu ý an toàn

⚠️ Tool này sử dụng tự động hóa. Để tránh bị Facebook quét:
1. Không nên đặt `checkIntervalMinutes` quá ngắn (nên từ 5-15 phút trở lên).
2. Danh sách `comments` nên đa dạng nội dung.
3. Luôn sử dụng Browser Profile để tránh phải đăng nhập lại nhiều lần dẫn đến checkpoint.

