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
            .on('debug', this.logGenericEvent('debug'))
            .on('warn', this.logGenericEvent('warn'))
            .on('disconnect', this.logGenericEvent('disconnect'))
            .on('rateLimit', this.logGenericEvent('rateLimit'))
            .on('reconnecting', this.logGenericEvent('reconnecting'))
            .on('message', this.message)
            .on('ready', () => {
                this.client.guilds.forEach((guild) => {
                    console.log(`Joined Discord server: ${guild.name} ` +
                        `[${guild.region}] (owned by ${guild.owner.user.tag})`);
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
                const rendered = await this.renderer.renderSinglePage(id);
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
                    response.setURL(page.pageURL);

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
