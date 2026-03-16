module.exports = {
  apps: [{
    name: 'flight-monitor',
    script: 'node_modules/.bin/tsx',
    args: 'src/index.ts',
    cwd: '/Users/samuelkemper/Desktop/flight-monitor',
    watch: false,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 30000,
    env: {
      NODE_ENV: 'production',
    },
    // Log files
    error_file: '/Users/samuelkemper/Desktop/flight-monitor/logs/error.log',
    out_file: '/Users/samuelkemper/Desktop/flight-monitor/logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs: true,
  }],
};
