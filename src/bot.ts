import {MarkovChain} from 'acausal';
import {exec} from 'child_process';
import * as discord from 'discord.js';
import * as fs from 'fs';
import * as mkdirp from 'mkdirp';
import * as path from 'path';
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

class Chatter {
  private readonly chain: MarkovChain = new MarkovChain({seed: 1});
  private readonly storageFilename: string;
  private readonly encoding = 'utf8';

  constructor(storageFilename: string) {
    this.storageFilename = storageFilename;

    if (fs.existsSync(this.storageFilename)) {
      try {
        const sequences = JSON.parse(
          '[' + fs.readFileSync(this.storageFilename, this.encoding) + ']'
        );
        this.chain.addSequences(sequences);
      } catch (e) {
        console.error(
          `Error reading / parsing chatter data from ${this.storageFilename}`,
          e
        );
      }
    }
  }

  public record = (message: string) => {
    if (message) {
      const sequence = message.split(/\s+/);
      this.chain.addSequence(sequence);
      let data = JSON.stringify(sequence);
      if (fs.existsSync(this.storageFilename)) {
        data = ',' + data;
      }
      fs.appendFileSync(this.storageFilename, data, this.encoding);
    }
  };

  public generate = (): string =>
    this.chain
      .generate({
        min: 4,
        max: 30,
        order: 1,
        strict: false,
      })
      .join(' ');
}

export class Bot {
  private readonly client: discord.Client;
  private readonly renderer: Renderer;
  private readonly comicslate: Comicslate;
  private readonly chatterDataDirectory: string;
  private readonly chatters: {[channelId: string]: Chatter} = {};

  constructor(
    renderer: Renderer,
    comicslate: Comicslate,
    chatterDataDirectory: string
  ) {
    this.renderer = renderer;
    this.comicslate = comicslate;
    this.chatterDataDirectory = chatterDataDirectory;

    if (!fs.existsSync(this.chatterDataDirectory)) {
      mkdirp.sync(this.chatterDataDirectory);
    }

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
      partials: ['MESSAGE', 'CHANNEL'],
    })
      .on('error', this.logGenericEvent('error'))
      .on('debug', this.logGenericEvent('debug'))
      .on('warn', this.logGenericEvent('warn'))
      .on('disconnect', this.logGenericEvent('disconnect'))
      .on('rateLimit', this.logGenericEvent('rateLimit'))
      .on('webhookUpdate', this.logGenericEvent('webhookUpdate'))
      .on('messageCreate', this.message)
      .on('ready', () => {
        this.client.guilds.cache.forEach(async guild => {
          console.log(
            `\nJoined Discord server: ${guild.name} ` +
              `| locale:${guild.preferredLocale} | owner:${
                (await guild!.fetchOwner()).user.tag
              } | since:${guild.createdAt} | joined:${guild.joinedAt}`
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
                  discord.Permissions.FLAGS.ATTACH_FILES,
                  discord.Permissions.FLAGS.EMBED_LINKS,
                  discord.Permissions.FLAGS.SEND_MESSAGES_IN_THREADS,
                  discord.Permissions.FLAGS.USE_EXTERNAL_STICKERS,
                  discord.Permissions.FLAGS.START_EMBEDDED_ACTIVITIES,
                ])
                .toArray()
                .join(', ');
              console.log(
                ` - channel "${channel.name}"\n` +
                  `   type: "${channel.type}"\n` +
                  `   permissions: ${stringPermissions}`
              );
            }
          });
        });
      });
  }

  connect = (token: string): Promise<string> => this.client.login(token);

  destroy = () => {
    this.client.destroy();
  };

  private logGenericEvent =
    (eventName: string) =>
    (...args: Array<{}>) => {
      console.log(
        `Discord bot received event "${eventName}" with args:\n`,
        args
      );
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
      if (!(message.channelId in this.chatters)) {
        this.chatters[message.channelId] = new Chatter(
          path.join(this.chatterDataDirectory, `${message.channelId}.json`)
        );
      }
      this.chatters[message.channelId].record(message.cleanContent);

      if (message.content) {
        console.log(
          `Got a message: [${message.cleanContent}]` +
            ` | sender:${message.author.username}` +
            ` | attachments:${message.attachments.entries.length}` +
            ` | embeds:${message.embeds.entries.length}` +
            ` | stickers:${message.stickers.entries.length}` +
            ` | channel:${message.channelId}` +
            ` | server:${message.guild?.name}`
        );
      } else {
        console.log('Got a message:', message);
      }

      console.log(
        `Would reply: [${this.chatters[message.channelId].generate()}]`
      );
    }
    if (this.client.user !== null && message.mentions.has(this.client.user)) {
      message.react(Emoji.Cat);

      exec('git rev-parse HEAD', async (error, stdout, stderr) => {
        const reply = await message.reply(`I'm alive.
Bot: \`https://github.com/dotdoom/comicsbot/tree/${stdout.trim()}\`
Renderer: \`${await this.renderer.version()}\`
Doku: \`${await this.comicslate.doku.getVersion()}\`
Render stats:\n\`\`\`${this.renderer.stats}\`\`\`
`);
        // Delete our reply 5 minutes later to keep the chat clean.
        setTimeout(() => reply.delete(), 5 * 60 * 1000);
      });
    }
  };
}
