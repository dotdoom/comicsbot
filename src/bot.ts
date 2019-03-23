import * as discord from 'discord.js';
import { Renderer } from './render';

enum Emoji {
    OK = "\u{1f44c}",
    ThumbsUp = "\u{1f44d}",
    ThumbsDown = "\u{1f44e}",
    Cat = "\u{1f431}",
}

export class Bot {
    private client: discord.Client = new discord.Client();
    private renderer: Renderer;

    constructor(renderer: Renderer) {
        this.renderer = renderer;

        setInterval(() => {
            console.log('Ping [1m]: ', this.client.pings);
        }, 60 * 1000);

        this.client
            .on('error', this.logGenericEvent('error'))
            //.on('debug', this.logGenericEvent('debug'))
            .on('warn', this.logGenericEvent('warn'))
            .on('disconnect', this.logGenericEvent('disconnect'))
            //.on('rateLimit', this.logGenericEvent('rateLimit'))
            .on('reconnecting', this.logGenericEvent('reconnecting'))
            .on('message', this.message)
            .on('ready', () => {
                this.client.guilds.forEach((guild) => {
                    console.log(`Joined Discord server: ${guild.name} ` +
                        `[${guild.region}] (owned by ${guild.owner.user.tag})`);
                    guild.channels.forEach((channel) => {
                        if (channel instanceof discord.TextChannel) {
                            const permissions = channel.permissionsFor(guild.me);
                            let stringPermissions = 'N/A';
                            if (permissions != null) {
                                // Remove boring permissions and print what's left.
                                stringPermissions = permissions.remove(
                                    discord.Permissions.FLAGS.CREATE_INSTANT_INVITE!,
                                    discord.Permissions.FLAGS.VIEW_AUDIT_LOG!,
                                    discord.Permissions.FLAGS.PRIORITY_SPEAKER!,
                                    discord.Permissions.FLAGS.SEND_TTS_MESSAGES!,
                                    discord.Permissions.FLAGS.READ_MESSAGE_HISTORY!,
                                    discord.Permissions.FLAGS.MENTION_EVERYONE!,
                                    discord.Permissions.FLAGS.USE_EXTERNAL_EMOJIS!,
                                    discord.Permissions.FLAGS.CONNECT!,
                                    discord.Permissions.FLAGS.SPEAK!,
                                    discord.Permissions.FLAGS.MUTE_MEMBERS!,
                                    discord.Permissions.FLAGS.DEAFEN_MEMBERS!,
                                    discord.Permissions.FLAGS.MOVE_MEMBERS!,
                                    discord.Permissions.FLAGS.USE_VAD!,
                                    discord.Permissions.FLAGS.MANAGE_WEBHOOKS!,
                                    discord.Permissions.FLAGS.MANAGE_EMOJIS!,
                                ).toArray().join(',');
                            }
                            console.log(` - channel "${channel.name}", ` +
                                `type: "${channel.type}", ` +
                                `permissions: ${stringPermissions}`);
                        }
                    });
                });
            });
    }

    public connect = (token: string): Promise<string> =>
        // Automatically reconnect.
        // TODO(dotdoom): add exponential backoff, jitter.
        this.client.once('disconnect', () => this.connect(token))
            .login(token);

    public destroy = () => this.client.destroy();

    private logGenericEvent = (eventName: string) =>
        (...args: any[]) => {
            console.log('Event ', eventName, ' with args ', args);
        };

    // A very stupid way of cleaning up the message from backquotes. Putting a
    // message in backquotes may be necessary when otherwise Discord interprets
    // certain character sequences as smileys, e.g. in
    // "en:furry:comic:new:0001", ":new:" turns into a Unicode emoji.
    private plainText = (message: string) => message
        .replace(/```[a-z]*/ig, '')
        .replace(/`/g, '')
        .trim();

    private message = async (message: discord.Message) => {
        if (message.author.id === this.client.user.id) {
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
            console.log(`Got a message ${message.content} [CLEAN:${message.cleanContent}] from user ${message.author.username} in channel ${channel.name} server ${channel.guild.name}`);
        }

        if (message.isMentioned(this.client.user)) {
            message.react(Emoji.Cat);
        }

        const text = this.plainText(message.cleanContent);

        if (text == 'count20') {
            for (let i = 0; i < 20; ++i) {
                message.channel.send(`Message number ${i + 1}`);
            }
        }

        if (text.startsWith('render ')) {
            const params = text.split(' ');
            if (params.length != 2) {
                return;
            }
            const id = params[1];
            console.log(`Rendering page ${id}`);

            message.react(Emoji.OK);
            message.channel.startTyping();
            try {
                const rendered = await this.renderer.renderSinglePage(id, '/tmp');
                if (rendered === undefined) {
                    message.channel.send(new discord.RichEmbed()
                        .setTitle('Page rejected')
                        .setDescription('pagePath() returns "null"'));
                    return;
                }

                let response = new discord.RichEmbed();
                response.setTitle(`Rendered page ${id}`);
                let description = '';
                let imageAdded = false;
                for (const page of rendered) {
                    console.log('  rendered box ', page);

                    if (page.box) {
                        description += 'Box ' + JSON.stringify(page.box);
                    } else {
                        description += 'Full page';
                    }

                    description += ' would be saved to `' +
                        page.originalScreenshotPath + '`\n';
                    response.setURL(page.pageURL.toString());

                    if (imageAdded) {
                        description += '*more than 1 box rendered, only ' +
                            'the latest is attached*\n';
                    } else {
                        imageAdded = true;
                        response.attachFile(page.screenshotPath);
                    }
                }

                if (imageAdded) {
                    response.setImage('attachment://render-screenshot.png');
                } else {
                    description += '*no images rendered (empty boxes list)*';
                }
                response.setDescription(description);

                message.react(Emoji.ThumbsUp);
                message.reply(response);
            } catch (e) {
                message.react(Emoji.ThumbsDown);
                message.reply(new discord.RichEmbed()
                    .setTitle('Exception caught')
                    .setColor(0xFF0000)
                    .setDescription(e.message));
            } finally {
                message.channel.stopTyping(true);
            }
        }
    }
};
