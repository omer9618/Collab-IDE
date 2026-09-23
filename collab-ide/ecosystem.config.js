// ==============================================================================
// CollabIDE - PM2 Production Ecosystem Configuration (NFR-32 & NFR-38)
// ==============================================================================

module.exports = {
  apps: [
    {
      name: 'collabide-backend',
      script: './server.js',
      
      // Cluster mode: spawn one worker process per available CPU core (NFR-32)
      instances: 'max',
      exec_mode: 'cluster',
      
      // Graceful shutdown & lifecycle timing (NFR-38)
      // kill_timeout (12s) provides a 2.0s safety buffer over the application's internal 10.0s watchdog,
      // guaranteeing internal diagnostics and document persistence finish before SIGKILL
      kill_timeout: 12000,
      
      // Zero-downtime rolling reload support
      wait_ready: true,
      listen_timeout: 8000,
      
      // Automatic memory threshold restart (NFR-32)
      max_memory_restart: '512M',
      
      // Automatic crash recovery
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      
      // Log formatting and rotation (NFR-32)
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      
      env: {
        NODE_ENV: 'development',
        PORT: 3000
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000
      }
    }
  ]
};
