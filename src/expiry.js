const { EmbedBuilder } = require('discord.js');
const store = require('./store');

const INTERVAL_MS = 15 * 60 * 1000;

async function sweep(client) {
  const expired = store.getExpired();
  if (!expired.length) return;

  console.log(`Expiry sweep: ${expired.length} record(s)`);

  for (const rec of expired) {
    try {
      const guild = await client.guilds.fetch(rec.guildId).catch(() => null);
      if (guild) {
        const member = await guild.members.fetch(rec.userId).catch(() => null);
        const role = await guild.roles.fetch(rec.roleId).catch(() => null);

        if (member && role && member.roles.cache.has(role.id)) {
          await member.roles.remove(role, `Purchase expired (${rec.orderNumber})`);
        }

        const logId = process.env.LOG_CHANNEL_ID;
        if (logId) {
          const ch = await guild.channels.fetch(logId).catch(() => null);
          if (ch && ch.isTextBased()) {
            const granted = Math.floor(new Date(rec.grantedAt).getTime() / 1000);
            const expiredAt = Math.floor(new Date(rec.expiresAt).getTime() / 1000);
            await ch.send({
              embeds: [
                new EmbedBuilder()
                  .setTitle('Purchase role expired')
                  .setColor(0xf59e0b)
                  .addFields(
                    {
                      name: 'User',
                      value: `<@${rec.userId}> (${rec.username || rec.userId})`,
                      inline: true,
                    },
                    { name: 'Role', value: `<@&${rec.roleId}>`, inline: true },
                    { name: 'Order', value: `\`${rec.orderNumber}\``, inline: true },
                    { name: 'Granted', value: `<t:${granted}:f>`, inline: true },
                    { name: 'Expired', value: `<t:${expiredAt}:f>`, inline: true },
                  )
                  .setTimestamp(new Date()),
              ],
            });
          }
        }
      }
    } catch (err) {
      console.error(`Expiry failed for ${rec.id}`, err);
    } finally {
      store.deactivate(rec.id, { reason: 'expired' });
    }
  }
}

function start(client) {
  setTimeout(() => {
    sweep(client).catch((err) => console.error('Initial expiry sweep failed', err));
  }, 10_000);

  setInterval(() => {
    sweep(client).catch((err) => console.error('Expiry sweep failed', err));
  }, INTERVAL_MS);
}

module.exports = { start, sweep };
