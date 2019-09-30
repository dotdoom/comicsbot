import * as puppeteer from 'puppeteer';
import { URL } from 'url';
import * as xmlrpc from 'xmlrpc';
import { App } from './app';
import { Bot } from './bot';
import { Comicslate } from './comicslate';
import { Doku } from './doku';
import { onExit } from './on_exit';
import { Renderer } from './render';

// Used by our .service initfile to find the bot process.
process.title = 'comicsbot';

interface Config {
  discordToken: string;
  doku: {
    user: string;
    password: string;
    baseUrl: string;
  };
  app: {
    port: number;
  };
  render: {
    baseDirectory: string;
  };
}

(async () => {
  const config: Config = require('../../config/config.json');

  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  });
  onExit(browser.close);

  const baseUrl = new URL(config.doku.baseUrl);
  const xmlrpcConstructor =
    baseUrl.protocol === 'http:'
      ? xmlrpc.createClient
      : xmlrpc.createSecureClient;
  const xmlrpcURL = new URL('lib/exe/xmlrpc.php', baseUrl);
  const doku = new Doku(
    xmlrpcConstructor({
      url: xmlrpcURL.href,
      cookies: true,
      // headers: {
      //   'User-Agent': await browser.userAgent(),
      // },
    })
  );
  await doku.login(config.doku.user, config.doku.password);

  const render = new Renderer(
    '../../config/render.js',
    browser,
    config.render.baseDirectory
  );

  const comicslate = new Comicslate(doku, render, baseUrl);

  console.log('Initializing Wiki...');
  await comicslate.initialized;

  console.log('Starting API server...');
  const app = new App(comicslate);
  app.express.listen(config.app.port);

  if (config.discordToken) {
    console.log('Starting Discord bot...');
    const bot = new Bot(render, comicslate, baseUrl);
    bot.connect(config.discordToken);
    onExit(bot.destroy);
  }

  console.log('Started!');
})();
