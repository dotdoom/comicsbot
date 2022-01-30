import { exec } from 'child_process';
import * as discord from 'discord.js';
import { Comicslate } from './comicslate';
import { Renderer } from './render';

enum Emoji {
  OK = '\u{1f44c}',
  ThumbsUp = '\u{1f44d}',
  ThumbsDown = '\u{1f44e}',
  Cat = '\u{1f431}',
  Disappointed = '\u{1f61e}',
  Star = '\u{2b50}',
  GlowingStar = '\u{1f31f}',
}

export class Bot {
  private readonly client: discord.Client;
  private readonly renderer: Renderer;
  private readonly comicslate: Comicslate;

  constructor(renderer: Renderer, comicslate: Comicslate) {
    this.renderer = renderer;
    this.comicslate = comicslate;

    this.client = new discord.Client({
      presence: {
        activities: [
          {
            name: 'Comics Translations',
            url: 'https://comicslate.org/',
            type: 'WATCHING',
          },
        ],
      },
      intents: [
        discord.Intents.FLAGS.GUILDS,
        discord.Intents.FLAGS.GUILD_MESSAGES,
        discord.Intents.FLAGS.DIRECT_MESSAGES,
      ],
  })
      .on('error', this.logGenericEvent('error'))
      .on('debug', this.logGenericEvent('debug'))
      .on('warn', this.logGenericEvent('warn'))
      .on('disconnect', this.logGenericEvent('disconnect'))
      .on('rateLimit', this.logGenericEvent('rateLimit'))
      .on('webhookUpdate', this.logGenericEvent('webhookUpdate'))
      .on('message', this.message)
      .on('ready', () => {
        this.client.guilds.cache.forEach(async guild => {
          console.log(
            `Joined Discord server: ${guild.name} ` +
              `[${guild.preferredLocale}] (owned by ${(await guild!.fetchOwner()).user.tag})`
          );
          guild.channels.cache.forEach(channel => {
            const permissions = channel.permissionsFor(guild.me!);
            let stringPermissions = 'N/A';
            if (permissions !== null) {
              // Remove boring permissions and print what's left.
              stringPermissions = permissions
                .remove([
                  discord.Permissions.FLAGS.CREATE_INSTANT_INVITE,
                  discord.Permissions.FLAGS.VIEW_AUDIT_LOG,
                  discord.Permissions.FLAGS.PRIORITY_SPEAKER,
                  discord.Permissions.FLAGS.SEND_TTS_MESSAGES,
                  discord.Permissions.FLAGS.READ_MESSAGE_HISTORY,
                  discord.Permissions.FLAGS.MENTION_EVERYONE,
                  discord.Permissions.FLAGS.USE_EXTERNAL_EMOJIS,
                  discord.Permissions.FLAGS.CONNECT,
                  discord.Permissions.FLAGS.SPEAK,
                  discord.Permissions.FLAGS.MUTE_MEMBERS,
                  discord.Permissions.FLAGS.DEAFEN_MEMBERS,
                  discord.Permissions.FLAGS.MOVE_MEMBERS,
                  discord.Permissions.FLAGS.USE_VAD,
                  discord.Permissions.FLAGS.MANAGE_WEBHOOKS,
                  discord.Permissions.FLAGS.MANAGE_EMOJIS_AND_STICKERS,
                ])
                .toArray()
                .join(',');
              console.log(
                ` - channel "${channel.name}", ` +
                  `type: "${channel.type}", ` +
                  `permissions: ${stringPermissions}`
              );
            }
          });
        });
      });
  }

  connect = (token: string): Promise<string> => this.client.login(token);

  destroy = () => this.client.destroy();

  private logGenericEvent = (eventName: string) => (...args: Array<{}>) => {
    console.log('Event ', eventName, ' with args ', args);
  };

  private message = async (message: discord.Message) => {
    if (message.author.id === this.client.user?.id) {
      // Ignore message from self.
      return;
    }

    if (message.author.bot) {
      // Ignore message from a bot.
      return;
    }

    const channel = message.channel;
    if (channel instanceof discord.DMChannel) {
      console.log(`Got a direct message from user ${message.author.username}`);
    } else if (channel instanceof discord.TextChannel) {
      console.log(
        `Got a message ${message.content} [CLEAN:${message.cleanContent}] ` +
        `from user ${message.author.username} in channel ` +
        `${message.channelId} server ${message.guild?.name}`
      );
    }
    if (this.client.user !== null && message.mentions.has(this.client.user)) {
      message.react(Emoji.Cat);

      exec('git rev-parse HEAD', async (error, stdout, stderr) => {
        message.reply(`I'm alive.
Bot: https://github.com/dotdoom/comicsbot/tree/${stdout.trim()}
Renderer: \`${await this.renderer.version()}\`
Doku: \`${await this.comicslate.doku.getVersion()}\`
Render stats:\n\`\`\`${this.renderer.stats}\`\`\`
`);
      });
    }
  };
}
