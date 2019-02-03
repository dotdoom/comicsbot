import puppeteer from 'puppeteer';
import { Doku } from "./doku";

interface RenderOptions {
    searchNamespaces: string[];
    pagePath(id: string): string | null;
    findBoxes(id: string): [][] | string[];
}

interface RenderedBox {
    // TODO(dotdoom): move these to higher-level struct.
    pageId: string;
    pageURL: string;

    box: puppeteer.BoundingBox | undefined;
    originalScreenshotPath: string;
    screenshotPath: string;
}

export class Renderer {
    private renderOptionsFile: string;
    private doku: Doku;
    private browser: puppeteer.Browser;
    private baseUrl: string;

    constructor(
        renderOptionsFile: string,
        doku: Doku,
        browser: puppeteer.Browser,
        baseUrl: string,
    ) {
        this.renderOptionsFile = renderOptionsFile;
        this.doku = doku;
        this.browser = browser;
        this.baseUrl = baseUrl;
    }

    renderSinglePage = async (
        id: string,
    ): Promise<RenderedBox[] | undefined> => {
        const render = this.loadRenderOptions();
        const path = render.pagePath(id);
        if (path === null) {
            return undefined;
        }
        const url = this.baseUrl + path;

        const browserPage = await this.browser.newPage();
        try {
            let pages: RenderedBox[] = [];
            // browserPage.setCookie(this.doku.getCookies());

            await browserPage.goto(url);
            const boxes = await browserPage.evaluate(render.findBoxes, id);
            for (const box of boxes) {
                let screenshotOptions: puppeteer.ScreenshotOptions = {};
                if (typeof box === "string") {
                    screenshotOptions.fullPage = true;
                    screenshotOptions.path = box;
                } else {
                    screenshotOptions.clip = {
                        x: box[0],
                        y: box[1],
                        width: box[2],
                        height: box[3],
                    };
                    screenshotOptions.path = box[4];
                }

                const originalScreenshotPath = screenshotOptions.path;
                // TODO(dotdoom): replace with a real temporary file.
                screenshotOptions.path = '/tmp/render-screenshot.png';
                pages.push({
                    pageURL: url,
                    pageId: id,
                    box: screenshotOptions.clip,
                    originalScreenshotPath: <string>originalScreenshotPath,
                    screenshotPath: <string>screenshotOptions.path,
                });

                await browserPage.screenshot(screenshotOptions);
            }

            return pages;
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
