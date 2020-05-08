import * as mkdirp from 'mkdirp';
import * as path from 'path';
import * as puppeteer from 'puppeteer';
import * as sharp from 'sharp';
import {URL} from 'url';

interface RenderOptions {
  findRect(id: string): DOMRect;
}

export class Renderer {
  private readonly renderOptionsFile: string;
  private readonly browser: puppeteer.Browser;
  private readonly baseDirectory: string;
  private readonly deviceScaleFactor?: number;

  constructor(
    renderOptionsFile: string,
    browser: puppeteer.Browser,
    baseDirectory: string,
    deviceScaleFactor?: number
  ) {
    this.renderOptionsFile = renderOptionsFile;
    this.browser = browser;
    this.baseDirectory = baseDirectory;
    this.deviceScaleFactor = deviceScaleFactor;
  }

  renderSinglePage = async (
    url: URL,
    baseDirectory: string = this.baseDirectory
  ): Promise<string> => {
    const render = this.loadRenderOptions();
    const browserPage = await this.browser.newPage();
    try {
      if (this.deviceScaleFactor) {
        const viewport = await browserPage.viewport();
        viewport.deviceScaleFactor = this.deviceScaleFactor;
        await browserPage.setViewport(viewport);
      }

      // TODO(dotdoom): when we have 18+ control in Discord.
      //await browserPage.setCookie(...this.doku.getCookies());
      await browserPage.goto(url.href);
      const renderFilename = this.renderFilename(url, baseDirectory);
      console.info(`rendering page ${url} into ${renderFilename}`);
      const pngBuffer = await browserPage.screenshot({
        clip: (await browserPage.evaluate(render.findRect)) as DOMRect,
      });
      mkdirp.sync(path.dirname(renderFilename));
      await sharp(pngBuffer).webp().toFile(renderFilename);
      return renderFilename;
    } finally {
      await browserPage.close();
    }
  };

  renderFilename = (url: URL, baseDirectory: string = this.baseDirectory) =>
    path.join(baseDirectory, `${url.pathname.replace(/[.]/g, '__dot__')}.webp`);

  private loadRenderOptions = (): RenderOptions => {
    const resolved = require.resolve(this.renderOptionsFile);
    if (resolved && resolved in require.cache) {
      delete require.cache[resolved];
    }

    return require(this.renderOptionsFile);
  };
}
