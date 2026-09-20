const { EmbedBuilder } = require('discord.js');
const store = require('./store');

const pending = new Map();

function pendingKey(staffId, targetId) {
  return `${staffId}:${targetId}`;
}

function setPending(staffId, targetId, orderNumber) {
  pending.set(pendingKey(staffId, targetId), {
    orderNumber: String(orderNumber).trim(),
    expires: Date.now() + 10 * 60 * 1000,
  });
}

function takePending(staffId, targetId) {
  const key = pendingKey(staffId, targetId);
  const rec = pending.get(key);
  pending.delete(key);
  if (!rec || rec.expires < Date.now()) return null;
  return rec;
}

function isStaff(member) {
  if (!member) return false;
  if (member.permissions.has('ManageRoles')) return true;
  const adminRole = process.env.ADMIN_ROLE_ID;
  if (adminRole && member.roles.cache.has(adminRole)) return true;
  return false;
}

function roleProblem(guild, role, botMember) {
  if (!role) return 'That role does not exist.';
  if (role.id === guild.id) return 'You cannot assign @everyone.';
  if (role.managed) return 'That role is managed by an integration and cannot be assigned.';
  if (!role.editable) {
    return 'I cannot assign that role. Move my bot role above it in Server Settings → Roles.';
  }
  if (botMember && botMember.roles.highest.comparePositionTo(role) <= 0) {
    return 'I cannot assign that role. Move my bot role above it in Server Settings → Roles.';
  }
  return null;
}

function formatDuplicateWarning(duplicates) {
  if (!duplicates.length) return null;

  const lines = duplicates.slice(0, 5).map((r) => {
    const when = Math.floor(new Date(r.grantedAt).getTime() / 1000);
    const state = r.active ? 'active' : 'inactive';
    return `• <@${r.userId}> / <@&${r.roleId}> — <t:${when}:f> (${state})`;
  });

  const extra = duplicates.length > 5 ? `\n• …and ${duplicates.length - 5} more` : '';
  return `This order number was already logged ${duplicates.length} time${duplicates.length === 1 ? '' : 's'}:\n${lines.join('\n')}${extra}`;
}

async function logGrant(guild, { member, role, orderNumber, staff, record, duplicates }) {
  const chId = process.env.LOG_CHANNEL_ID;
  if (!chId) return null;

  const ch = await guild.channels.fetch(chId).catch(() => null);
  if (!ch || !ch.isTextBased()) return null;

  const exp = Math.floor(new Date(record.expiresAt).getTime() / 1000);
  const duplicateWarning = formatDuplicateWarning(duplicates || []);
  const embed = new EmbedBuilder()
    .setTitle(record.extended ? 'Purchase role extended' : 'Purchase role granted')
    .setColor(duplicateWarning ? 0xf59e0b : record.extended ? 0x38bdf8 : 0x22c55e)
    .addFields(
      { name: 'User', value: `${member} \`${member.user.tag}\` \`${member.id}\``, inline: false },
      { name: 'Order number', value: `\`${orderNumber}\``, inline: true },
      { name: 'Role', value: `${role} \`${role.name}\` \`${role.id}\``, inline: true },
      { name: 'Granted by', value: `${staff} \`${staff.user.tag}\``, inline: false },
      { name: 'Expires', value: `<t:${exp}:F> • <t:${exp}:R>`, inline: false },
    )
    .setTimestamp(new Date());

  if (duplicateWarning) {
    embed.addFields({
      name: 'Warning: duplicate order number',
      value: duplicateWarning.slice(0, 1024),
    });
  }

  const msg = await ch.send({ embeds: [embed] });
  return msg.id;
}

async function grantPurchase({ guild, staffMember, targetMember, role, orderNumber }) {
  if (!isStaff(staffMember)) {
    return { ok: false, error: 'You need Manage Roles (or the configured admin role) to do this.' };
  }

  const botMember = guild.members.me || (await guild.members.fetchMe());
  const problem = roleProblem(guild, role, botMember);
  if (problem) return { ok: false, error: problem };

  if (!botMember.permissions.has('ManageRoles')) {
    return { ok: false, error: 'I need the Manage Roles permission.' };
  }

  const trimmedOrder = String(orderNumber || '').trim();
  if (!trimmedOrder) {
    return { ok: false, error: 'Order number cannot be empty.' };
  }

  const previousUses = store.findByOrderNumber(guild.id, trimmedOrder);

  await targetMember.roles.add(role, `Purchase ${trimmedOrder}`);

  const record = store.upsertGrant({
    guildId: guild.id,
    userId: targetMember.id,
    username: targetMember.user.tag,
    roleId: role.id,
    roleName: role.name,
    orderNumber: trimmedOrder,
    grantedById: staffMember.id,
    grantedByTag: staffMember.user.tag,
  });

  try {
    const logMessageId = await logGrant(guild, {
      member: targetMember,
      role,
      orderNumber: trimmedOrder,
      staff: staffMember,
      record,
      duplicates: previousUses,
    });
    if (logMessageId) {
      record.logMessageId = logMessageId;
      store.persist();
    }
  } catch (err) {
    console.error('log grant failed', err);
  }

  const exp = Math.floor(new Date(record.expiresAt).getTime() / 1000);
  const warning = formatDuplicateWarning(previousUses);
  const base = record.extended
    ? `Extended ${role} on ${targetMember} for order \`${trimmedOrder}\`. Now expires <t:${exp}:R>.`
    : `Gave ${role} to ${targetMember} for order \`${trimmedOrder}\`. Expires <t:${exp}:R>.`;

  return {
    ok: true,
    record,
    warning,
    message: warning ? `${base}\n\nWarning: ${warning}` : base,
  };
}

async function revokePurchase({ guild, staffMember, targetMember, role }) {
  if (!isStaff(staffMember)) {
    return { ok: false, error: 'You need Manage Roles (or the configured admin role) to do this.' };
  }

  const rec = store.findActive(guild.id, targetMember.id, role.id);

  if (targetMember.roles.cache.has(role.id)) {
    await targetMember.roles.remove(role, `Purchase revoked by ${staffMember.user.tag}`);
  }

  if (rec) {
    store.deactivate(rec.id, {
      revokedById: staffMember.id,
      reason: 'manual',
    });
  }

  const chId = process.env.LOG_CHANNEL_ID;
  if (chId) {
    const ch = await guild.channels.fetch(chId).catch(() => null);
    if (ch && ch.isTextBased()) {
      await ch.send({
        embeds: [
          new EmbedBuilder()
            .setTitle('Purchase role revoked')
            .setColor(0xef4444)
            .addFields(
              { name: 'User', value: `${targetMember} \`${targetMember.user.tag}\` \`${targetMember.id}\`` },
              { name: 'Role', value: `${role} \`${role.name}\` \`${role.id}\`` },
              { name: 'Revoked by', value: `${staffMember}` },
              { name: 'Order', value: rec ? `\`${rec.orderNumber}\`` : 'n/a' },
            )
            .setTimestamp(new Date()),
        ],
      });
    }
  }

  return { ok: true, message: `Removed ${role} from ${targetMember}.` };
}

function formatStatus(records) {
  if (!records.length) return 'No active purchased roles.';
  return records
    .map((r) => {
      const exp = Math.floor(new Date(r.expiresAt).getTime() / 1000);
      return `• <@&${r.roleId}> — order \`${r.orderNumber}\` — expires <t:${exp}:R>`;
    })
    .join('\n');
}

module.exports = {
  pending,
  setPending,
  takePending,
  isStaff,
  roleProblem,
  grantPurchase,
  revokePurchase,
  formatStatus,
};
