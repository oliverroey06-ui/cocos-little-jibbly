const path = require('path');

function required(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return String(value).trim();
}

function optional(name, fallback = '') {
  const value = process.env[name];
  return value && String(value).trim() ? String(value).trim() : fallback;
}

function loadConfig() {
  const dataDir = optional('DATA_DIR', path.join(__dirname, '..', 'data'));
  const durationMonths = Number(optional('ROLE_DURATION_MONTHS', '6'));

  return {
    token: required('DISCORD_TOKEN'),
    clientId: required('CLIENT_ID'),
    guildId: required('GUILD_ID'),
    logChannelId: required('LOG_CHANNEL_ID'),
    adminRoleId: optional('ADMIN_ROLE_ID'),
    dataDir,
    durationMonths: Number.isFinite(durationMonths) && durationMonths > 0 ? durationMonths : 6,
    port: Number(process.env.PORT || 10000),
  };
}

module.exports = { loadConfig };
