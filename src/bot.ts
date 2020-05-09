import * as discord from 'discord.js';
import {Comicslate} from './comicslate';
import {Renderer} from './render';

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
  private readonly client: discord.Client = new discord.Client();
  private readonly renderer: Renderer;
  private readonly comicslate: Comicslate;

  constructor(renderer: Renderer, comicslate: Comicslate) {
    this.renderer = renderer;
    this.comicslate = comicslate;

    this.client
      .on('error', this.logGenericEvent('error'))
      .on('debug', this.logGenericEvent('debug'))
      .on('warn', this.logGenericEvent('warn'))
      .on('disconnect', this.logGenericEvent('disconnect'))
      .on('rateLimit', this.logGenericEvent('rateLimit'))
      .on('webhookUpdate', this.logGenericEvent('webhookUpdate'))
      .on('message', this.message)
      .on('ready', () => {
        this.client.guilds.cache.forEach(guild => {
          console.log(
            `Joined Discord server: ${guild.name} ` +
              `[${guild.region}] (owned by ${guild!.owner?.user.tag})`
          );
          guild.channels.cache.forEach(channel => {
            if (channel instanceof discord.TextChannel) {
              const permissions = channel.permissionsFor(guild.me!);
              let stringPermissions = 'N/A';
              if (permissions !== null) {
                // Remove boring permissions and print what's left.
                stringPermissions = permissions
                  .remove(
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
                    discord.Permissions.FLAGS.MANAGE_EMOJIS
                  )
                  .toArray()
                  .join(',');
              }
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

  connect = (token: string): Promise<string> =>
    // Automatically reconnect.
    // TODO(dotdoom): add exponential backoff, jitter.
    this.client.once('disconnect', () => this.connect(token)).login(token);

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
        `Got a message ${message.content} [CLEAN:${message.cleanContent}] from user ${message.author.username} in channel ${channel.name} server ${channel.guild.name}`
      );
    }
    if (this.client.user !== null && message.mentions.has(this.client.user)) {
      message.react(Emoji.Cat);
    }
  };
}
