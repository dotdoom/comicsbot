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
    private readonly baseDirectory: string;

    constructor(
        renderOptionsFile: string,
        browser: puppeteer.Browser,
        baseDirectory: string,
    ) {
        this.renderOptionsFile = renderOptionsFile;
        this.browser = browser;
        this.baseDirectory = baseDirectory;
    }

    renderSinglePage = async (
        url: URL,
        baseDirectory: string = this.baseDirectory,
    ): Promise<RenderedPage> => {
        const render = this.loadRenderOptions();
        const browserPage = await this.browser.newPage();
        try {
            // TODO(dotdoom): when we have 18+ control in Discord.
            //await browserPage.setCookie(...this.doku.getCookies());
            await browserPage.goto(url.href);

            const renderedPage: RenderedPage = {
                clip: <DOMRect>(await browserPage.evaluate(render.findRect)),
                path: this.renderFilename(url, baseDirectory),
            };
            console.info(`rendering page ${url} into ${renderedPage.path}`);

            mkdirp.sync(path.dirname(renderedPage.path));
            await browserPage.screenshot(renderedPage);
            return renderedPage;
        } finally {
            await browserPage.close();
        }
    }

    renderFilename = (
        url: URL,
        baseDirectory: string = this.baseDirectory,
    ) =>
        path.join(
            path.dirname(path.join(baseDirectory, url.pathname)),
            'u',
            path.basename(url.pathname) + '.png',
        );

    private loadRenderOptions = () => {
        const resolved = require.resolve(this.renderOptionsFile);
        if (resolved && resolved in require.cache) {
            delete require.cache[resolved];
        }

        return <RenderOptions>require(this.renderOptionsFile);
    }
}
