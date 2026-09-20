const {
  REST,
  Routes,
  SlashCommandBuilder,
  ContextMenuCommandBuilder,
  ApplicationCommandType,
  PermissionFlagsBits,
} = require('discord.js');

function buildCommands() {
  const purchase = new SlashCommandBuilder()
    .setName('purchase')
    .setDescription('Grant a purchased role to a user for 6 months and log the order.')
    .addUserOption((option) =>
      option.setName('user').setDescription('Customer to give the role to').setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('order_number')
        .setDescription('Order number from the purchase')
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(64),
    )
    .addRoleOption((option) =>
      option.setName('role').setDescription('Role to grant for 6 months').setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false);

  const revoke = new SlashCommandBuilder()
    .setName('revoke-purchase')
    .setDescription('Remove a purchased role from a user immediately and log it.')
    .addUserOption((option) =>
      option.setName('user').setDescription('Customer to remove the role from').setRequired(true),
    )
    .addRoleOption((option) =>
      option.setName('role').setDescription('Purchased role to remove').setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false);

  const status = new SlashCommandBuilder()
    .setName('purchase-status')
    .setDescription('Show active purchased roles for a user.')
    .addUserOption((option) =>
      option.setName('user').setDescription('Customer to look up').setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false);

  const grantMenu = new ContextMenuCommandBuilder()
    .setName('Grant Purchase Role')
    .setType(ApplicationCommandType.User)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false);

  return [purchase, revoke, status, grantMenu];
}

async function registerCommands({ token, clientId, guildId }) {
  const rest = new REST({ version: '10' }).setToken(token);
  const body = buildCommands().map((command) => command.toJSON());

  const data = await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
  console.log(`Registered ${data.length} guild command(s) on ${guildId}`);
  return data;
}

module.exports = { buildCommands, registerCommands };
