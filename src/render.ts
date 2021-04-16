import * as mkdirp from 'mkdirp';
import * as path from 'path';
import * as puppeteer from 'puppeteer';
import * as sharp from 'sharp';
import {URL} from 'url';

interface RenderOptions {
  findRect(id: string): DOMRect;
}

export class Renderer {
  static readonly versionParameterName = 'rev';

  private readonly renderOptionsFile: string;
  private readonly browser: puppeteer.Browser | null;
  private readonly baseDirectory: string;
  private readonly deviceScaleFactor?: number;

  constructor(
    renderOptionsFile: string,
    browser: puppeteer.Browser | null,
    baseDirectory: string,
    deviceScaleFactor?: number
  ) {
    this.renderOptionsFile = renderOptionsFile;
    this.browser = browser;
    this.baseDirectory = baseDirectory;
    this.deviceScaleFactor = deviceScaleFactor;
  }

  version = async (): Promise<string> =>
    (await this.browser?.version()) || '[Rendering disabled]';

  renderSinglePage = async (
    url: URL,
    baseDirectory: string = this.baseDirectory
  ): Promise<string> => {
    if (this.browser == null) {
      throw Error('Rendering disabled: browser has not been launched');
    }

    const render = this.loadRenderOptions();
    const browserPage = await this.browser.newPage();
    try {
      // Render each strip anew; client is usually local, so the cost is low.
      await browserPage.setCacheEnabled(false);

      if (this.deviceScaleFactor) {
        const viewport = browserPage.viewport();
        viewport.deviceScaleFactor = this.deviceScaleFactor;
        await browserPage.setViewport(viewport);
      }

      // TODO(dotdoom): when we have 18+ control in Discord.
      //await browserPage.setCookie(...this.doku.getCookies());
      await browserPage.goto(url.href);

      const clip = (await browserPage.evaluate(render.findRect)) as DOMRect;
      const clipDebugString = `rect[${clip.left}, ${clip.top}; ${clip.right}, ${clip.bottom}]`;
      const viewport = browserPage.viewport();
      if (viewport.height < clip.bottom || viewport.width < clip.right) {
        console.log(
          `resizing viewport ${viewport.width}x${viewport.height} to fit ` +
            clipDebugString
        );
        // Must resize viewport to get the full element on the screen:
        // https://github.com/puppeteer/puppeteer/issues/5080
        viewport.width = Math.ceil(clip.right);
        viewport.height = Math.ceil(clip.bottom);
      }
      await browserPage.setViewport(viewport);

      const renderFilename = this.renderFilename(url, baseDirectory);
      console.info(
        `rendering page ${url} ${clipDebugString} into ` + renderFilename
      );
      const pngBuffer = await browserPage.screenshot({
        clip: clip,
      });
      mkdirp.sync(path.dirname(renderFilename));
      let image = sharp(pngBuffer);
      if (this.deviceScaleFactor != null) {
        // Scale the image back to the amount of pixels it takes on screen.
        image = image.resize({
          width: clip.width,
          // Default setting of "true" may result in slight moire pattern.
          fastShrinkOnLoad: false,
        });
      }
      await image
        .webp({
          nearLossless: true,
        })
        .toFile(renderFilename);
      return renderFilename;
    } finally {
      await browserPage.close();
    }
  };

  renderFilename = (url: URL, baseDirectory: string = this.baseDirectory) => {
    let fileName = url.pathname.replace(/:/g, '/').replace(/[.]/g, '__dot__');
    if (url.searchParams.has(Renderer.versionParameterName)) {
      const rev = parseInt(
        url.searchParams.get(Renderer.versionParameterName)!
      );
      if (isFinite(rev)) {
        fileName += `@${rev}`;
      }
    }
    return path.join(baseDirectory, `${fileName}.webp`);
  };

  private loadRenderOptions = (): RenderOptions => {
    const resolved = require.resolve(this.renderOptionsFile);
    if (resolved && resolved in require.cache) {
      delete require.cache[resolved];
    }

    return require(this.renderOptionsFile);
  };
}
