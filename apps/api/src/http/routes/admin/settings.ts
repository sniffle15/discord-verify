import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { diagnoseGuild } from '../../../discord/guild.js';
import { getSettings, settingsUpdateSchema, toPublicSettings, updateSettings } from '../../../lib/settings.js';
import { adminActor, audit } from '../../../services/audit.js';

const testBody = z.object({ guildId: z.string().regex(/^\d{17,20}$/).optional() }).default({});

export async function settingsRoutes(app: FastifyInstance) {
  app.get('/', async () => toPublicSettings(await getSettings()));

  app.put('/', async (request) => {
    const patch = settingsUpdateSchema.parse(request.body);
    const admin = request.admin!;
    const changed = await updateSettings(patch, admin.discordId);
    if (changed.length > 0) {
      await audit({
        type: 'SETTINGS_UPDATED',
        actor: adminActor(admin.discordId),
        message: `${admin.username} updated settings: ${changed.join(', ')}`,
        metadata: { keys: changed },
      });
    }
    return toPublicSettings(await getSettings());
  });

  /** Checks token validity, guild membership, permissions and role hierarchy without changing anything. */
  app.post('/test', async (request, reply) => {
    const { guildId } = testBody.parse(request.body ?? {});
    const settings = await getSettings();
    const targetGuild = guildId ?? settings.targetGuildId;
    if (!settings.botToken || !targetGuild) {
      return reply.code(400).send({ error: 'not_configured', message: 'Configure a bot token and target guild first.' });
    }
    const roleIds = settings.verifiedRoleId && targetGuild === settings.targetGuildId ? [settings.verifiedRoleId] : [];
    return diagnoseGuild(settings.botToken, targetGuild, roleIds);
  });
}
