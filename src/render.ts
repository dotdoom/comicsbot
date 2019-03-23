import * as path from "path";
import puppeteer from "puppeteer";
import { URL } from "url";
import { Doku } from "./doku";

interface RenderOptions {
    searchNamespaces: string[];
    pagePath(id: string): string | null;
    findBoxes(id: string): [][] | string[];
}

interface RenderedBox {
    // TODO(dotdoom): move these to higher-level struct.
    pageId: string;
    pageURL: URL;

    box: puppeteer.BoundingBox | undefined;
    originalScreenshotPath: string;
    screenshotPath: string;
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
    ): Promise<RenderedBox[] | undefined> => {
        const render = this.loadRenderOptions();
        const pagePath = render.pagePath(id);
        if (pagePath === null) {
            return undefined;
        }
        const url = new URL(pagePath, this.baseUrl);

        const browserPage = await this.browser.newPage();
        try {
            let pages: RenderedBox[] = [];
            await browserPage.setCookie(...this.doku.getCookies());
            await browserPage.goto(url.toString());
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
                screenshotOptions.path = path.join(targetDirectory,
                    path.basename(originalScreenshotPath!));
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
