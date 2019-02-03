import puppeteer from 'puppeteer';
import * as xmlrpc from 'xmlrpc';
import { Bot } from './src/bot';
import { Doku } from './src/doku';
import { onExit } from './src/on_exit';
import { Renderer } from './src/render';

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
  let config: Config = require('../config.json');

  const doku = new Doku(xmlrpc.createClient({
    url: config.doku.baseUrl + 'lib/exe/xmlrpc.php',
    cookies: true,
  }));
  await doku.login(config.doku.user, config.doku.password);

  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  onExit(browser.close);

  const render = new Renderer('../../render.js', doku, browser,
    config.doku.baseUrl);
  const bot = new Bot(render);
  bot.connect(config.discordToken);
  onExit(bot.destroy);
})();
