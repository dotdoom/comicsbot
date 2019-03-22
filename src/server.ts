import puppeteer from 'puppeteer';
import * as xmlrpc from 'xmlrpc';
import { Bot } from './bot';
import { Doku } from './doku';
import { onExit } from './on_exit';
import { Renderer } from './render';

// Used by our .service initfile to find the bot process.
process.title = 'comicsbot';

interface Config {
  discordToken: string
  doku: {
    user: string,
    password: string,
    baseUrl: string,
  },
}

(async () => {
  let config: Config = require('../config/config.json');

  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  });
  onExit(browser.close);

  // TODO(dotdoom): createClient vs createSecureClient based on protocol in URL.
  const doku = new Doku(xmlrpc.createSecureClient({
    url: config.doku.baseUrl + 'lib/exe/xmlrpc.php',
    cookies: true,
    // headers: {
    //   'User-Agent': await browser.userAgent(),
    // },
  }));
  await doku.login(config.doku.user, config.doku.password);

  const render = new Renderer('../config/render.js', doku, browser,
    config.doku.baseUrl);

  const bot = new Bot(render);
  bot.connect(config.discordToken);
  onExit(bot.destroy);
})();
