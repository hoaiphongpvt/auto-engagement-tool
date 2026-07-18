module.exports = {
  apps: [
    {
      name: 'fb-bot',
      // Bot mở trình duyệt non-headless (auto-engage.js) — trên VPS không có màn hình
      // phải chạy qua xvfb: sudo apt install -y xvfb
      script: 'xvfb-run',
      args: '-a node src/auto-engage.js',
      interpreter: 'none',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 30000,
      time: true,
      out_file: 'logs/out.log',
      error_file: 'logs/error.log',
      merge_logs: true,
    },
  ],
};
