import {
  ActionRowBuilder,
  ActivityType,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type GuildMember,
  type PartialGuildMember,
} from 'discord.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { getSettings } from '../lib/settings.js';
import { audit } from '../services/audit.js';

const verifyPanelCommand = new SlashCommandBuilder()
  .setName('verify-panel')
  .setDescription('Post the verification panel in this channel')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false);

async function onMemberAdd(member: GuildMember): Promise<void> {
  const settings = await getSettings();
  if (member.guild.id !== settings.targetGuildId || !settings.verifiedRoleId) return;

  const record = await prisma.member.findUnique({ where: { discordId: member.id } });
  if (!record) return;
  await prisma.member.update({ where: { id: record.id }, data: { inTargetGuild: true } });
  if (record.status !== 'ACTIVE') return;

  try {
    await member.roles.add(settings.verifiedRoleId, 'Previously verified member rejoined');
    await prisma.member.update({ where: { id: record.id }, data: { roleAssigned: true } });
    await audit({
      type: 'ROLE_ASSIGNED',
      memberId: record.id,
      targetDiscordId: record.discordId,
      guildId: member.guild.id,
      message: `Re-assigned verified role to ${record.username} after rejoining`,
    });
  } catch (err) {
    await audit({
      type: 'ROLE_ASSIGN_FAILED',
      memberId: record.id,
      targetDiscordId: record.discordId,
      guildId: member.guild.id,
      message: `Could not re-assign verified role to ${record.username}: ${(err as Error).message}`,
    });
  }
}

async function onMemberRemove(member: GuildMember | PartialGuildMember): Promise<void> {
  const settings = await getSettings();
  if (member.guild.id !== settings.targetGuildId) return;
  await prisma.member.updateMany({ where: { discordId: member.id }, data: { inTargetGuild: false, roleAssigned: false } });
}

/** Logs in and wires gateway events. Resolves with a stop function once the client is ready. */
export async function startBot(token: string): Promise<() => Promise<void>> {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  });

  client.once(Events.ClientReady, async (ready) => {
    logger.info({ user: ready.user.tag }, 'Bot connected to gateway');
    ready.user.setPresence({ activities: [{ name: 'verifications', type: ActivityType.Watching }], status: 'online' });

    const { targetGuildId } = await getSettings();
    const guild = targetGuildId ? ready.guilds.cache.get(targetGuildId) : undefined;
    if (!guild) {
      logger.warn({ targetGuildId }, 'Bot is not in the configured target guild');
      return;
    }
    await guild.commands.set([verifyPanelCommand.toJSON()]).catch((err) => logger.warn({ err }, 'Failed to register slash commands'));
  });

  client.on(Events.GuildMemberAdd, (member) => void onMemberAdd(member).catch((err) => logger.error({ err }, 'guildMemberAdd handler failed')));
  client.on(Events.GuildMemberRemove, (member) => void onMemberRemove(member).catch((err) => logger.error({ err }, 'guildMemberRemove handler failed')));
  client.on(Events.Error, (err) => logger.error({ err }, 'Discord client error'));

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'verify-panel') return;
    if (!interaction.inCachedGuild() || !interaction.channel) return;
    try {
      const embed = new EmbedBuilder()
        .setTitle('Verification required')
        .setDescription(
          'Click the button below and sign in with Discord to get access to this server.\n\n' +
            'Only your public profile is read. You can revoke access at any time under **Settings > Authorized Apps**.',
        )
        .setColor(0x5865f2);
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Verify').setURL(`${env.PUBLIC_URL}/verify`),
      );
      await interaction.channel.send({ embeds: [embed], components: [row] });
      await interaction.reply({ content: 'Verification panel posted.', flags: MessageFlags.Ephemeral });
    } catch (err) {
      logger.warn({ err }, 'Failed to post verification panel');
      if (!interaction.replied) {
        await interaction
          .reply({ content: 'I could not post in this channel. Check my permissions.', flags: MessageFlags.Ephemeral })
          .catch(() => undefined);
      }
    }
  });

  await client.login(token);
  return async () => {
    await client.destroy();
  };
}
