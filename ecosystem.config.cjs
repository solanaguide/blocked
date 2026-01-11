// PM2 Ecosystem Configuration
// Run: pm2 start ecosystem.config.cjs

module.exports = {
  apps: [
    {
      name: 'solana-viz',
      script: 'server/index.ts',
      interpreter: 'node',
      interpreter_args: '--import tsx',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        REDIS_HOST: '192.168.100.2',
        REDIS_PORT: '6379',
        WS_PORT: '3847',
        BATCH_INTERVAL: '50',
        CORS_ORIGINS: '*',
      },
      // Restart settings
      max_restarts: 10,
      min_uptime: '10s',
      max_memory_restart: '500M',
      // Logging
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
