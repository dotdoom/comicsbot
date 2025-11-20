import * as puppeteer from 'puppeteer';
import {URL} from 'url';
import * as xmlrpc from 'xmlrpc';
import {App} from './app';
import {Comicslate} from './comicslate';
import {Doku} from './doku';
import {onExit} from './on_exit';
import {Renderer} from './render';

// Used by our .service initfile to find the bot process.
process.title = 'comicsbot';

interface Config {
  doku: {
    user: string;
    password: string;
    baseUrl: string;
    address?: string;
  };
  app: {
    port: number;
    cachePage: string;
    bannedComicRegex?: string[];
  };
  render: {
    baseDirectory: string;
    cacheDirectory?: string;
  };
}

(async () => {
  const config: Config = require('../../config/config.json');
  const baseUrl = new URL(config.doku.baseUrl);

  console.log('Starting browser...');
  const browser_config: puppeteer.PuppeteerLaunchOptions = {
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      // https://github.com/GoogleChrome/puppeteer/issues/2410
      '--disable-font-subpixel-positioning',
      '--font-render-hinting=none',
    ],
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  };
  if (config.doku.address) {
    // Map to localhost.
    browser_config.args!.push(
      `--host-resolver-rules=MAP ${baseUrl.host} ${config.doku.address}`,
    );
  }
  if (config.render.cacheDirectory) {
    browser_config.env = {
      XDG_CONFIG_HOME: `${config.render.cacheDirectory}/.config`,
      XDG_CACHE_HOME: `${config.render.cacheDirectory}/.cache`,
    };
  }
  if (process.env.CHROME_EXECUTABLE_PATH) {
    browser_config.executablePath = process.env.CHROME_EXECUTABLE_PATH;
  }
  var browser: puppeteer.Browser | null = null;
  try {
    browser = await puppeteer.launch(browser_config);
    onExit(() => browser?.close());
  } catch (e) {
    console.error('Failed to launch browser, rendering will not be available');
    console.error(e);
  }

  console.log('Logging in to Doku...');
  const xmlrpcConstructor =
    baseUrl.protocol === 'http:'
      ? xmlrpc.createClient
      : xmlrpc.createSecureClient;
  const xmlrpcURL = new URL('lib/exe/xmlrpc.php', baseUrl);
  if (config.doku.address) {
    xmlrpcURL.host = config.doku.address;
  }
  const doku = new Doku(
    xmlrpcConstructor({
      url: xmlrpcURL.href,
      cookies: true,
      headers: {
        'User-Agent': (await browser?.userAgent()) || 'comicsbot (render off)',
        Host: baseUrl.host,
      },
    }),
  );

  while (1) {
    try {
      await doku.login(config.doku.user, config.doku.password);
      break;
    } catch (e) {
      console.error(e);
      // 5s delay.
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  const render = new Renderer(
    '../../config/render.js',
    browser,
    config.render.baseDirectory,
  );

  const comicslate = new Comicslate(
    doku,
    render,
    baseUrl,
    config.app.cachePage,
    config.app.bannedComicRegex,
  );

  console.log('Initializing Wiki...');
  await comicslate.initialized;

  console.log('Starting API server...');
  const app = new App(comicslate);
  app.express.listen(config.app.port);

  console.log('Started!');
})().catch(e => {
  console.error(e);
  // Have to exit manually because Node does not do it on unhandled rejections,
  // as of yet.
  process.exit(1);
});
