import express from 'express';
import puppeteer from 'puppeteer';
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
  discordToken: string
  doku: {
    user: string,
    password: string,
    baseUrl: string,
  },
  app: {
    port: number
  },
  render: {
    baseDirectory: string,
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

  let baseUrl = new URL(config.doku.baseUrl);
  let xmlrpcConstructor = baseUrl.protocol == 'http:'
    ? xmlrpc.createClient
    : xmlrpc.createSecureClient;
  let xmlrpcURL = new URL('lib/exe/xmlrpc.php', baseUrl);
  const doku = new Doku(xmlrpcConstructor({
    url: xmlrpcURL.href,
    cookies: true,
    // headers: {
    //   'User-Agent': await browser.userAgent(),
    // },
  }));
  await doku.login(config.doku.user, config.doku.password);

  const render = new Renderer('../config/render.js', browser,
    config.render.baseDirectory);

  const comicslate = new Comicslate(doku, baseUrl);

  console.log('Initializing Wiki...');
  await comicslate.initialized;

  console.log('Starting API server...');
  const app = express();
  new App(app, render, comicslate);
  app.listen(config.app.port);

  if (config.discordToken) {
    console.log('Starting Discord bot...');
    const bot = new Bot(render, comicslate, baseUrl);
    bot.connect(config.discordToken);
    onExit(bot.destroy);
  }

  console.log('Started!');
})();
