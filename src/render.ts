import {randomUUID} from 'crypto';
import * as mkdirp from 'mkdirp';
import * as path from 'path';
import * as puppeteer from 'puppeteer';
import * as sharp from 'sharp';
import {URL} from 'url';

interface RenderOptions {
  findRect(): DOMRect;
}

export class RenderTracker {
  private lastFailedRenderURL?: URL;
  private lastFailedRenderReason?: any;
  private numRenderRequests = 0;
  private numRenderFailures = 0;
  private inFlightRenders: URL[] = [];
  private concurrency = 1;

  public recordRender = async (
    url: URL,
    render: () => Promise<any>,
  ): Promise<string> => {
    ++this.numRenderRequests;

    while (
      this.concurrency >= 0 &&
      this.inFlightRenders.length >= this.concurrency
    ) {
      await new Promise(r => setTimeout(r, 10));
    }

    this.inFlightRenders.push(url);
    try {
      return await render();
    } catch (e) {
      ++this.numRenderFailures;
      this.lastFailedRenderReason = e;
      this.lastFailedRenderURL = url;
      throw e;
    } finally {
      this.inFlightRenders.splice(this.inFlightRenders.indexOf(url), 1);
    }
  };

  public toString = (): string => {
    if (this.numRenderRequests == 0) {
      return 'No rendering took place, ever';
    }
    let summary = `${this.numRenderRequests} request(s) have been issued`;
    if (this.numRenderFailures > 0) {
      summary +=
        ` of which ${this.numRenderFailures} failed, for example ` +
        `URL ${this.lastFailedRenderURL} (${this.lastFailedRenderReason})`;
    }
    if (this.inFlightRenders.length > 0) {
      summary +=
        ` and ${this.inFlightRenders.length} are still in-flight` +
        `: ${this.inFlightRenders.slice(0, 3)}`;
    }
    return summary;
  };
}

export class Renderer {
  static readonly versionParameterName = 'rev';

  private readonly renderOptionsFile: string;
  private readonly browser: puppeteer.Browser | null;
  private readonly baseDirectory: string;

  public readonly stats = new RenderTracker();

  public inRender: boolean = false;

  constructor(
    renderOptionsFile: string,
    browser: puppeteer.Browser | null,
    baseDirectory: string,
  ) {
    this.renderOptionsFile = renderOptionsFile;
    this.browser = browser;
    this.baseDirectory = baseDirectory;
  }

  version = async (): Promise<string> =>
    (await this.browser?.version()) || '[Rendering disabled]';

  renderSinglePage = (
    url: URL,
    baseDirectory: string = this.baseDirectory,
  ): Promise<string> =>
    this.stats.recordRender(url, async (): Promise<string> => {
      if (this.browser == null) {
        throw Error('Rendering disabled: browser has not been launched');
      }

      const renderSessionId = randomUUID();
      const debugLog = (msg: string) => {
        console.log(`[${renderSessionId}] ${msg}`);
      };
      debugLog(`Starting render session for ${url}`);
      const render = this.loadRenderOptions();
      debugLog(`Opening new browser page`);
      const browserPage = await this.browser.newPage();
      try {
        // Render each strip anew; client is usually local, so the cost is low.
        debugLog(`Disabling cache`);
        await browserPage.setCacheEnabled(false);
        // Bump the default timeout of 30s to 300s (useful when we spawn a lot of
        // workers e.g. during scanning).
        browserPage.setDefaultNavigationTimeout(300000);

        // TODO(dotdoom): when we have 18+ control in Discord/App.
        //await browserPage.setCookie(...this.doku.getCookies());
        debugLog(`Navigating and waiting for 0 network activity for 500ms`);
        await browserPage.goto(url.href, {waitUntil: 'networkidle0'});

        // @ts-ignore - doc / examples insist that this should work.
        debugLog(`Finding page coordinates to render into strip`);
        const clip = (await browserPage.evaluate(render.findRect)) as DOMRect;
        const clipDebugString = `rect[${clip.left}, ${clip.top}; ${clip.right}, ${clip.bottom}]`;
        const renderFilename = this.renderFilename(url, baseDirectory);
        console.info(
          `rendering page ${url} ${clipDebugString} into ` + renderFilename,
        );
        debugLog(`Rendering page`);
        let pngBuffer: Buffer<ArrayBufferLike>;
        pngBuffer = (await browserPage.screenshot({
          clip: clip,
        })) as Buffer;
        mkdirp.sync(path.dirname(renderFilename));
        let image = sharp(pngBuffer);
        debugLog(`Saving rendered image`);
        await image
          .webp({
            nearLossless: true,
          })
          .toFile(renderFilename);
        return renderFilename;
      } finally {
        debugLog(`Closing browser page`);
        await browserPage.close();
        debugLog(`Render session complete`);
      }
    });

  renderFilename = (url: URL, baseDirectory: string = this.baseDirectory) => {
    let fileName = url.pathname.replace(/:/g, '/').replace(/[.]/g, '__dot__');
    if (url.searchParams.has(Renderer.versionParameterName)) {
      const rev = parseInt(
        url.searchParams.get(Renderer.versionParameterName)!,
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
