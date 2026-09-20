const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'assignments.json');

let cache = [];
let writing = Promise.resolve();

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load() {
  ensureDir();
  if (!fs.existsSync(FILE)) {
    cache = [];
    fs.writeFileSync(FILE, '[]', 'utf8');
    return cache;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    cache = Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Failed to parse assignments.json, starting empty.', err);
    cache = [];
  }
  return cache;
}

function persist() {
  writing = writing
    .then(() => {
      ensureDir();
      const tmp = `${FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf8');
      fs.renameSync(tmp, FILE);
    })
    .catch((err) => {
      console.error('store persist failed', err);
    });
  return writing;
}

function monthsFromNow(from = new Date()) {
  const months = Number(process.env.ROLE_DURATION_MONTHS || 6);
  const d = new Date(from);
  const originalDay = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() !== originalDay) {
    d.setDate(0);
  }
  return d.toISOString();
}

function findActive(guildId, userId, roleId) {
  return cache.find(
    (r) => r.active && r.guildId === guildId && r.userId === userId && r.roleId === roleId,
  );
}

function upsertGrant({
  guildId,
  userId,
  username,
  roleId,
  roleName,
  orderNumber,
  grantedById,
  grantedByTag,
  logMessageId,
}) {
  const now = new Date();
  const existing = findActive(guildId, userId, roleId);

  if (existing) {
    existing.orderNumber = orderNumber;
    existing.username = username;
    existing.roleName = roleName;
    existing.grantedById = grantedById;
    existing.grantedByTag = grantedByTag;
    existing.grantedAt = now.toISOString();
    existing.expiresAt = monthsFromNow(now);
    existing.logMessageId = logMessageId || existing.logMessageId;
    existing.extended = true;
    persist();
    return existing;
  }

  const record = {
    id: crypto.randomUUID(),
    guildId,
    userId,
    username,
    roleId,
    roleName,
    orderNumber,
    grantedById,
    grantedByTag,
    grantedAt: now.toISOString(),
    expiresAt: monthsFromNow(now),
    active: true,
    logMessageId: logMessageId || null,
    extended: false,
  };

  cache.push(record);
  persist();
  return record;
}

function deactivate(id, extra = {}) {
  const rec = cache.find((r) => r.id === id);
  if (rec) {
    rec.active = false;
    rec.revokedAt = extra.revokedAt || new Date().toISOString();
    rec.revokedById = extra.revokedById || null;
    rec.revokeReason = extra.reason || null;
    persist();
  }
  return rec;
}

function getExpired(now = new Date()) {
  const ts = now.toISOString();
  return cache.filter((r) => r.active && r.expiresAt <= ts);
}

function listActiveForUser(guildId, userId) {
  return cache.filter((r) => r.active && r.guildId === guildId && r.userId === userId);
}

function listAllActive(guildId) {
  return cache.filter((r) => r.active && r.guildId === guildId);
}

function normalizeOrderNumber(orderNumber) {
  return String(orderNumber || '').trim().toLowerCase();
}

function findByOrderNumber(guildId, orderNumber) {
  const needle = normalizeOrderNumber(orderNumber);
  if (!needle) return [];
  return cache.filter(
    (r) => r.guildId === guildId && normalizeOrderNumber(r.orderNumber) === needle,
  );
}

module.exports = {
  load,
  persist,
  monthsFromNow,
  findActive,
  findByOrderNumber,
  upsertGrant,
  deactivate,
  getExpired,
  listActiveForUser,
  listAllActive,
  DATA_DIR,
  FILE,
};
