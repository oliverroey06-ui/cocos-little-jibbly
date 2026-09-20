require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  RoleSelectMenuBuilder,
  MessageFlags,
} = require('discord.js');

const { loadConfig } = require('./src/config');
const { registerCommands } = require('./src/commands');
const store = require('./src/store');
const expiry = require('./src/expiry');
const purchase = require('./src/purchase');
const { startHealthServer } = require('./src/http');

let config;

try {
  config = loadConfig();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

if (!process.env.DATA_DIR) {
  console.warn(
    'DATA_DIR is not set. On Render, assignment records are wiped on every deploy unless you attach a disk at /data and set DATA_DIR=/data.',
  );
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.GuildMember],
});

startHealthServer(client, config.port);

function ephemeral(payload) {
  return { ...payload, flags: MessageFlags.Ephemeral };
}

async function fetchGuildMember(guild, userId) {
  return guild.members.fetch(userId);
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  store.load();
  console.log(`Loaded assignment store from ${store.FILE}`);

  try {
    await registerCommands({
      token: config.token,
      clientId: config.clientId,
      guildId: config.guildId,
    });
  } catch (err) {
    console.error('Failed to register commands', err);
  }

  expiry.start(readyClient);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      await handleSlash(interaction);
      return;
    }

    if (interaction.isUserContextMenuCommand()) {
      await handleContextMenu(interaction);
      return;
    }

    if (interaction.isModalSubmit()) {
      await handleModal(interaction);
      return;
    }

    if (interaction.isRoleSelectMenu()) {
      await handleRoleSelect(interaction);
    }
  } catch (err) {
    console.error('Interaction error', err);
    const message = {
      content: `Something went wrong: ${err.message || 'unknown error'}`,
    };
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(ephemeral(message));
      } else {
        await interaction.reply(ephemeral(message));
      }
    } catch (replyErr) {
      console.error('Failed to send error reply', replyErr);
    }
  }
});

async function handleSlash(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply(ephemeral({ content: 'This command only works in the server.' }));
    return;
  }

  const staffMember = await fetchGuildMember(interaction.guild, interaction.user.id);

  if (interaction.commandName === 'purchase') {
    const targetUser = interaction.options.getUser('user', true);
    const orderNumber = interaction.options.getString('order_number', true);
    const role = interaction.options.getRole('role', true);
    const targetMember = await fetchGuildMember(interaction.guild, targetUser.id);

    const result = await purchase.grantPurchase({
      guild: interaction.guild,
      staffMember,
      targetMember,
      role,
      orderNumber,
    });

    await interaction.reply(
      ephemeral({ content: result.ok ? result.message : result.error }),
    );
    return;
  }

  if (interaction.commandName === 'revoke-purchase') {
    const targetUser = interaction.options.getUser('user', true);
    const role = interaction.options.getRole('role', true);
    const targetMember = await fetchGuildMember(interaction.guild, targetUser.id);

    const result = await purchase.revokePurchase({
      guild: interaction.guild,
      staffMember,
      targetMember,
      role,
    });

    await interaction.reply(
      ephemeral({ content: result.ok ? result.message : result.error }),
    );
    return;
  }

  if (interaction.commandName === 'purchase-status') {
    if (!purchase.isStaff(staffMember)) {
      await interaction.reply(
        ephemeral({ content: 'You need Manage Roles (or the configured admin role) to do this.' }),
      );
      return;
    }

    const targetUser = interaction.options.getUser('user', true);
    const records = store.listActiveForUser(interaction.guild.id, targetUser.id);
    await interaction.reply(
      ephemeral({
        content: `Active purchases for ${targetUser}:\n${purchase.formatStatus(records)}`,
      }),
    );
  }
}

async function handleContextMenu(interaction) {
  if (interaction.commandName !== 'Grant Purchase Role') return;

  if (!interaction.inGuild()) {
    await interaction.reply(ephemeral({ content: 'This only works in the server.' }));
    return;
  }

  const staffMember = await fetchGuildMember(interaction.guild, interaction.user.id);
  if (!purchase.isStaff(staffMember)) {
    await interaction.reply(
      ephemeral({ content: 'You need Manage Roles (or the configured admin role) to do this.' }),
    );
    return;
  }

  const targetUser = interaction.targetUser;
  if (targetUser.bot) {
    await interaction.reply(ephemeral({ content: 'You cannot grant a purchase role to a bot.' }));
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`grant_purchase:${targetUser.id}`)
    .setTitle('Grant Purchase Role');

  const orderInput = new TextInputBuilder()
    .setCustomId('order_number')
    .setLabel('Order number')
    .setPlaceholder('Type the order number')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(64);

  modal.addComponents(new ActionRowBuilder().addComponents(orderInput));
  await interaction.showModal(modal);
}

async function handleModal(interaction) {
  if (!interaction.customId.startsWith('grant_purchase:')) return;

  const targetUserId = interaction.customId.split(':')[1];
  const orderNumber = interaction.fields.getTextInputValue('order_number').trim();

  if (!orderNumber) {
    await interaction.reply(ephemeral({ content: 'Order number cannot be empty.' }));
    return;
  }

  purchase.setPending(interaction.user.id, targetUserId, orderNumber);

  const select = new RoleSelectMenuBuilder()
    .setCustomId(`role_select:${targetUserId}`)
    .setPlaceholder('Select the role to grant for 6 months')
    .setMinValues(1)
    .setMaxValues(1);

  await interaction.reply(
    ephemeral({
      content: `Order \`${orderNumber}\` saved. Now pick the role to give <@${targetUserId}>.`,
      components: [new ActionRowBuilder().addComponents(select)],
    }),
  );
}

async function handleRoleSelect(interaction) {
  if (!interaction.customId.startsWith('role_select:')) return;

  const targetUserId = interaction.customId.split(':')[1];
  const pending = purchase.takePending(interaction.user.id, targetUserId);

  if (!pending) {
    await interaction.update({
      content: 'That grant form expired. Right-click the user and choose **Grant Purchase Role** again.',
      components: [],
    });
    return;
  }

  const role = interaction.roles.first();
  if (!role) {
    await interaction.update({
      content: 'No role was selected.',
      components: [],
    });
    return;
  }

  const staffMember = await fetchGuildMember(interaction.guild, interaction.user.id);
  const targetMember = await fetchGuildMember(interaction.guild, targetUserId);

  const result = await purchase.grantPurchase({
    guild: interaction.guild,
    staffMember,
    targetMember,
    role,
    orderNumber: pending.orderNumber,
  });

  await interaction.update({
    content: result.ok ? result.message : result.error,
    components: [],
  });
}

client.login(config.token);

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection', err);
});
