import * as mkdirp from 'mkdirp';
import * as path from 'path';
import * as puppeteer from 'puppeteer';
import * as sharp from 'sharp';
import { URL } from 'url';

interface RenderOptions {
  findRect(id: string): DOMRect;
}

export class Renderer {
  private readonly renderOptionsFile: string;
  private readonly browser: puppeteer.Browser;
  private readonly baseDirectory: string;

  constructor(
    renderOptionsFile: string,
    browser: puppeteer.Browser,
    baseDirectory: string
  ) {
    this.renderOptionsFile = renderOptionsFile;
    this.browser = browser;
    this.baseDirectory = baseDirectory;
  }

  renderSinglePage = async (
    url: URL,
    baseDirectory: string = this.baseDirectory
  ): Promise<string> => {
    const render = this.loadRenderOptions();
    const browserPage = await this.browser.newPage();
    try {
      // Increase deviceScaleFactor to mimic "retina" image quality.
      const viewport = await browserPage.viewport();
      viewport.deviceScaleFactor = Math.max(viewport.deviceScaleFactor || 1, 2);
      await browserPage.setViewport(viewport);

      // TODO(dotdoom): when we have 18+ control in Discord.
      //await browserPage.setCookie(...this.doku.getCookies());
      await browserPage.goto(url.href);
      const renderFilename = this.renderFilename(url, baseDirectory);
      console.info(`rendering page ${url} into ${renderFilename}`);
      const pngBuffer = await browserPage.screenshot({
        clip: (await browserPage.evaluate(render.findRect)) as DOMRect,
      });
      mkdirp.sync(path.dirname(renderFilename));
      await sharp(pngBuffer)
        .webp()
        .toFile(renderFilename);
      return renderFilename;
    } finally {
      await browserPage.close();
    }
  };

  renderFilename = (url: URL, baseDirectory: string = this.baseDirectory) =>
    path.join(
      path.dirname(path.join(baseDirectory, url.pathname)),
      'u',
      path.basename(url.pathname) + '.webp'
    );

  private loadRenderOptions = (): RenderOptions => {
    const resolved = require.resolve(this.renderOptionsFile);
    if (resolved && resolved in require.cache) {
      delete require.cache[resolved];
    }

    return require(this.renderOptionsFile);
  };
}
