import * as acceptLanguage from 'accept-language-parser';
import * as bodyParser from 'body-parser';
import * as express from 'express';
import { Application, RequestHandler } from 'express';
import * as moment from 'moment';
import * as morgan from 'morgan';
import { URL } from 'url';
import { Comicslate } from './comicslate';

const clientLanguage = (comicslate: Comicslate): RequestHandler => {
  const serverPreference: { [language: string]: number } = {};
  let maxPreference = 0;
  let preferredLanguageCode: string;
  for (const language of comicslate.getLanguages()) {
    serverPreference[language] = comicslate.getComics(language).length;
    if (serverPreference[language] > maxPreference) {
      maxPreference = serverPreference[language];
      preferredLanguageCode = language;
    }
  }
  for (const language of Object.keys(serverPreference)) {
    serverPreference[language] /= maxPreference;
  }

  return (req, res, next) => {
    const acceptLanguageHeader = req.header('Accept-Language');
    // If unspecified, language is the one server prefers.
    res.locals.language = preferredLanguageCode;
    if (acceptLanguageHeader) {
      const clientLanguages = acceptLanguage.parse(acceptLanguageHeader);
      let maxQuality = 0;
      for (const clientLanguage of clientLanguages) {
        if (clientLanguage.code in serverPreference) {
          const quality =
            clientLanguage.quality * serverPreference[clientLanguage.code];
          if (quality > maxQuality) {
            maxQuality = quality;
            res.locals.language = clientLanguage.code;
          }
        }
      }
      console.info(
        `For ${acceptLanguageHeader} picked ` +
          `${res.locals.language};q=${maxQuality}`
      );
    }

    next();
  };
};

const jsonApi = (handler: RequestHandler): RequestHandler => {
  return async (req, res, next) => {
    try {
      let reply = handler(req, res, next);
      while (reply instanceof Promise) {
        reply = await reply;
      }
      if (reply !== undefined) {
        res.setHeader('Cache-Control', `public, max-age=${30 * 60}`);
        res.json(reply);
      }
    } catch (e) {
      // Use a bunch of console.error() to convert object to primitives and
      // avoid "Uncaught TypeError: Cannot convert object to primitive value".
      console.error('Error while processing <', req.url, '>');
      console.error('Query:  <', req.query, '>');
      console.error('Params: <', req.params, '>');
      console.error('Locals: <', res.locals, '>');
      console.error('Error:  <', e, '>');
      console.error('Stacktrace follows on the next line:');
      console.error(e.stack);
      res.status(503).json(e.toString());
    }
  };
};

export class App {
  readonly express: Application;
  private readonly comicslate: Comicslate;

  constructor(comicslate: Comicslate) {
    this.comicslate = comicslate;
    this.express = express();

    this.express.use(
      morgan('dev'),
      bodyParser.urlencoded({ extended: true }),
      bodyParser.json(),
      clientLanguage(this.comicslate)
    );

    this.express.get('/', (req, res) =>
      res.redirect(
        'https://play.google.com/' +
          'store/apps/details?id=org.dasfoo.comicslate'
      )
    );

    this.express.get(
      '/comics',
      jsonApi(async (req, res) =>
        this.comicslate.getComics(res.locals.language)
      )
    );

    this.express.get(
      '/comics/:comicId/strips',
      jsonApi((req, res) =>
        this.comicslate.getStrips(res.locals.language, req.params.comicId)
      )
    );
    this.express.get(
      '/comics/:comicId/strips/:stripId',
      jsonApi(async (req, res) => {
        const ua = req.header('User-Agent');
        if (ua && ua.startsWith('org.dasfoo.comicslate')) {
          this.getStrip(req, res, () => {});
          return undefined;
        } else {
          return this.comicslate.getStrip(
            res.locals.language,
            req.params.comicId,
            req.params.stripId
          );
        }
      })
    );
    this.express.get(
      '/comics/:comicId/strips/:stripId/render',
      jsonApi(this.renderStrip)
    );

    /* For this to work, there has to be HTML markup similar to:

           <meta property="og:image" content="https://<server>/embed/image?id=<id>" />
           <link rel="alternate" type="application/json+oembed" href="https://<server>/embed/json?id=<id>" />
           <meta name="twitter:card" content="summary_large_image">

           in <head> of each document.
        */
    this.express.get('/embed/image', this.embedImage);
    this.express.get('/embed/json', jsonApi(this.embedJson));

    /*this.express.get('/updates/:snapshot', jsonApi((req, res) => {
            return this.getUpdates(res.locals.language, req.params.snapshot);
        }));*/
  }

  /*private getUpdates = async (
        language: string,
        oldSnapshot: number,
    ): Promise<Updates> => {
        const updates: Updates = {
            snapshot: (await this.doku.getTime()).getTime() / 1000,
            updates: {},
        }
        if (oldSnapshot != 0) {
            let dokuUpdates: PageInfo[] = [];
            try {
                dokuUpdates = await this.doku.getRecentChanges(oldSnapshot);
            } catch (e) {
                if (e.message.indexOf(
                    'There are no changes in the specified timeframe') < 0) {
                    throw e;
                }
                return updates;
            }
            const comics = await this.getComics(language);
            for (const comic of comics) {
                updates.updates[comic.id] = {
                    created: {
                        storyStrips: [],
                        bonusStrips: [],
                    },
                    updated: {
                        storyStrips: [],
                        bonusStrips: [],
                    },
                };
                const comicIdWithLanguage = language + ':' + comic.id;
                for (const dokuUpdate of dokuUpdates) {
                    if (dokuUpdate.name.indexOf(comicIdWithLanguage) >= 0) {
                        const id = dokuUpdate.name.substring(
                            comicIdWithLanguage.length + 1);
                        if (id.match(/^\d+$/)) {
                            updates.updates[comic.id].created.storyStrips.push(id);
                        }
                    }
                }
            }
        }
        return updates;
    }*/

  private getStrip: RequestHandler = async (req, res) => {
    const strip = await this.comicslate.getStrip(
      res.locals.language,
      req.params.comicId,
      req.params.stripId
    );
    res.setHeader(
      'X-Comicslate-Strip',
      Buffer.from(JSON.stringify(strip)).toString('base64')
    );

    const stripFilename = await this.comicslate.renderStrip(
      strip,
      !req.query.refresh
    );

    // sendFile is smart:
    // - it adds Content-Type automatically
    // - it handles ranged requests
    // - it adds "Cache-Control: public", "ETag" and "Last-Modified" headers
    return res.sendFile(stripFilename, {
      // Do not come back for some time; then, come with ETag for cache
      // validation. sendFile will serve 304 if ETag matches.
      maxAge: '30 minutes',
    });
  };

  private renderStrip: RequestHandler = async (req, res) => {
    const pageId = [
      res.locals.language,
      req.params.comicId,
      req.params.stripId,
    ].join(':');
    const pageInfo = await this.comicslate.doku.getPageInfo(pageId);
    const stripFilename = await this.comicslate.renderStrip(
      pageInfo,
      !req.query.refresh
    );

    // sendFile is smart:
    // - it adds Content-Type automatically
    // - it handles ranged requests
    // - it adds "Cache-Control: public", "ETag" and "Last-Modified" headers
    return res.sendFile(stripFilename, {
      // Do not come back for some time; then, come with ETag for cache
      // validation. sendFile will serve 304 if ETag matches.
      maxAge: '30 minutes',
    });
  };

  private embedImage: RequestHandler = async (req, res) => {
    // TODO(dotdoom): handle links to comics / user page / strip / unknown.
    // TODO(dotdoom): handle historical revision.
    const pageInfo = await this.comicslate.doku.getPageInfo(req.query
      .id as string);
    return res.sendFile(await this.comicslate.renderStrip(pageInfo));
  };

  private embedJson: RequestHandler = async (req, res) => {
    // TODO(dotdoom): find a better way to parse mixed IDs only.
    const page = this.comicslate.parsePageURL(
      new URL('http://fake.server/' + req.query.id)
    )!;
    const strip = await this.comicslate.getStrip(
      page.language,
      page.comicId,
      page.stripId!
    );
    const comic = (await this.comicslate.getComic(
      page.language,
      page.comicId
    ))!;

    moment.locale(res.locals.language);
    return {
      version: '1.0',
      title: strip.title,
      type: 'photo',
      // TODO(dotdoom): resolve to real author name.
      author_name: `${strip.author}, ${moment(strip.lastModified).fromNow()}`,
      author_url: this.comicslate.pageURL(`user:${strip.author}`),
      provider_name: `${comic.categoryName} | ${comic.name}`,
      provider_url: comic.homePageURL,
    };
  };
}
