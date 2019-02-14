import * as discord from 'discord.js';
import { Renderer } from './render';

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

        if (message.content.includes('GaMERCaT')) {
            try {
                await message.react('👍');
            } catch (e) {
                console.error(e);
            }
            try {
                await message.edit(message.content.replace(/GaMERCaT/g, 'GaMERCaT (The Best)'));
            } catch (e) {
                console.error(e);
            }
            message.reply('I have amended your message for better understanding');
        }

        // TODO(dotdoom): understand `quoted text` because otherwise Discord can
        //                replace some parts of the message with smileys.

        if (message.content.startsWith('render ')) {
            const params = message.content.split(' ');
            if (params.length != 2) {
                return;
            }
            const id = params[1];
            console.log(`Rendering page ${id}`);

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
                message.channel.send(response);
            } catch (e) {
                message.channel.send(new discord.RichEmbed()
                    .setTitle('Exception caught')
                    .setColor(0xFF0000)
                    .setDescription(e.message));
            }
        }
    }
};
