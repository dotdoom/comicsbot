import * as mkdirp from 'mkdirp';
import * as path from 'path';
import puppeteer from 'puppeteer';
import { URL } from 'url';
import { Doku } from './doku';

interface FoundBoxes {
    [screenshotFilename: string]: DOMRect;
}

interface RenderOptions {
    searchNamespaces: string[];
    pageURLPath(id: string): string | null;
    findBoxes(id: string): FoundBoxes;
}

interface RenderedBox {
    clip?: puppeteer.BoundingBox;
    path?: string;
}

interface RenderedPage {
    pageId: string;
    pageURL?: URL;
    boxes: RenderedBox[];
}

export class Renderer {
    readonly baseUrl: URL;
    private readonly renderOptionsFile: string;
    private readonly doku: Doku;
    private readonly browser: puppeteer.Browser;

    constructor(
        renderOptionsFile: string,
        doku: Doku,
        browser: puppeteer.Browser,
        baseUrl: URL,
    ) {
        this.renderOptionsFile = renderOptionsFile;
        this.doku = doku;
        this.browser = browser;
        this.baseUrl = baseUrl;
    }

    renderSinglePage = async (
        id: string,
        targetDirectory: string,
    ): Promise<RenderedPage> => {
        let page: RenderedPage = {
            pageId: id,
            boxes: [],
        };
        const render = this.loadRenderOptions();
        const pageURLPath = render.pageURLPath(id);
        if (pageURLPath) {
            page.pageURL = new URL(pageURLPath, this.baseUrl);

            const browserPage = await this.browser.newPage();
            try {
                // TODO(dotdoom): uncomment when we have 18+ control in Discord.
                //await browserPage.setCookie(...this.doku.getCookies());
                await browserPage.goto(page.pageURL.href);
                const boxes = <FoundBoxes>(
                    await browserPage.evaluate(render.findBoxes, id));
                for (const screenshotFilename in boxes) {
                    let screenshotOptions: puppeteer.ScreenshotOptions = {
                        clip: boxes[screenshotFilename],
                        path: path.join(targetDirectory, screenshotFilename),
                    };
                    mkdirp.sync(path.dirname(screenshotOptions.path!));
                    page.boxes.push(screenshotOptions);
                    await browserPage.screenshot(screenshotOptions);
                }
            } finally {
                await browserPage.close();
            }
        }
        return page;
    }

    private loadRenderOptions = () => {
        const resolved = require.resolve(this.renderOptionsFile);
        if (resolved && resolved in require.cache) {
            delete require.cache[resolved];
        }

        return <RenderOptions>require(this.renderOptionsFile);
    }
}
