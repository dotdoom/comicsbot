import * as discord from 'discord.js';
import { Renderer } from './render';

export class Bot {
    private client: discord.Client = new discord.Client();
    private renderer: Renderer;

    constructor(renderer: Renderer) {
        this.renderer = renderer;

        // TODO(dotdoom): debug? warn? rateLimit?
        this.client
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

    private message = async (message: discord.Message) => {
        if (message.author.id === this.client.user.id) {
            // Ignore message from self.
            return;
        }

        const channel = message.channel;
        if (channel instanceof discord.DMChannel) {
            console.log(`Got a direct message from user ${message.author.username}`);
        } else if (channel instanceof discord.TextChannel) {
            console.log(`Got a message from user ${message.author.username} in channel ${channel.name} server ${channel.guild.name}`);
        }

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

                    description += `Box ${JSON.stringify(page.box)} would be ` +
                        'saved to `' + page.originalScreenshotPath + '`\n';
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
