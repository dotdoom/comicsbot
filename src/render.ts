import * as mkdirp from 'mkdirp';
import path from 'path';
import puppeteer from 'puppeteer';
import { URL } from 'url';

interface RenderOptions {
    findRect(id: string): DOMRect;
}

interface RenderedPage {
    clip: puppeteer.BoundingBox;
    path: string;
}

export class Renderer {
    private readonly renderOptionsFile: string;
    private readonly browser: puppeteer.Browser;

    constructor(
        renderOptionsFile: string,
        browser: puppeteer.Browser,
    ) {
        this.renderOptionsFile = renderOptionsFile;
        this.browser = browser;
    }

    renderSinglePage = async (
        url: URL,
        baseDirectory: string,
    ): Promise<RenderedPage> => {
        const render = this.loadRenderOptions();
        const browserPage = await this.browser.newPage();
        try {
            // TODO(dotdoom): when we have 18+ control in Discord.
            //await browserPage.setCookie(...this.doku.getCookies());
            await browserPage.goto(url.href);

            const targetDirectory = path.join(
                path.dirname(path.join(baseDirectory, url.pathname)),
                'u',
            );

            const renderedPage: RenderedPage = {
                clip: <DOMRect>(await browserPage.evaluate(render.findRect)),
                path: path.join(
                    targetDirectory,
                    path.basename(url.pathname) + '.png',
                ),
            };
            console.info(`rendering page ${url} into ${renderedPage.path}`);

            mkdirp.sync(targetDirectory);
            await browserPage.screenshot(renderedPage);
            return renderedPage;
        } finally {
            await browserPage.close();
        }
    }

    private loadRenderOptions = () => {
        const resolved = require.resolve(this.renderOptionsFile);
        if (resolved && resolved in require.cache) {
            delete require.cache[resolved];
        }

        return <RenderOptions>require(this.renderOptionsFile);
    }
}
