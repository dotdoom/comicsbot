import * as acceptLanguage from 'accept-language-parser';
import * as express from 'express';
import {Application, RequestHandler} from 'express';
import * as moment from 'moment';
import * as morgan from 'morgan';
import {Comicslate, PageId} from './comicslate';
import {Renderer} from './render';

const clientLanguage = (comicslate: Comicslate): RequestHandler => {
  const serverPreference: {[language: string]: number} = {};
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
        if (res.headersSent) {
          console.error('Trying to send JSON reply after headers are sent!');
        } else {
          res.setHeader('Cache-Control', `public, max-age=${30 * 60}`);
        }
        res.json(reply);
      }
    } catch (e) {
      next(e);
    }
  };
};

const errorHandler: express.ErrorRequestHandler = (err, req, res, next) => {
  // Put values as separate arguments, instead of string interpolation, to
  // convert them into something that can be displayed on console, and avoid
  // "Uncaught TypeError: Cannot convert object to primitive value".
  console.error(
    '------\nError while processing <',
    req.url,
    '>\nQuery:  <',
    req.query,
    '>\nParams: <',
    req.params,
    '>\nLocals: <',
    res.locals,
    '>\nError:  <',
    err,
    '>\n------'
  );

  res.status(503).json(err.toString());
};

export class App {
  readonly express: Application;
  private readonly comicslate: Comicslate;

  constructor(comicslate: Comicslate) {
    this.comicslate = comicslate;
    this.express = express()
      .use(
        morgan('combined'),
        express.urlencoded({extended: true}),
        express.json(),
        clientLanguage(this.comicslate)
      )
      .get('/', (req, res) =>
        res.redirect(
          'https://play.google.com/' +
            'store/apps/details?id=org.dasfoo.comicslate'
        )
      )
      .get(
        '/comics',
        jsonApi(async (req, res) =>
          this.comicslate.getComics(res.locals.language)
        )
      )
      .get(
        '/comics/:comicId/strips',
        jsonApi((req, res) =>
          this.comicslate.getStrips(res.locals.language, req.params.comicId)
        )
      )
      .get(
        '/comics/:comicId/strips/:stripId',
        jsonApi(async (req, res, next) => {
          const ua = req.header('User-Agent');
          if (ua && ua.startsWith('org.dasfoo.comicslate')) {
            await this.getStrip(req, res, next);
            return undefined;
          } else {
            return this.comicslate.getStrip(
              new PageId(
                res.locals.language,
                req.params.comicId,
                req.params.stripId
              )
            );
          }
        })
      )
      .get('/comics/:comicId/strips/:stripId/render', jsonApi(this.renderStrip))
      /* For this to work, there has to be HTML markup similar to:

           <meta property="og:image" content="https://<server>/embed.webp?id=<id>" />
           <link rel="alternate" type="application/json+oembed" href="https://<server>/embed.json?id=<id>" />
           <meta name="twitter:card" content="summary_large_image">

           in <head> of each document.
        */
      // /embed/xxx are deprecated, to be removed after 2020-06-01.
      .get(['/embed.webp', '/embed/image'], jsonApi(this.embedImage))
      .get(['/embed.json', '/embed/json'], jsonApi(this.embedJson))

      /*.get('/updates/:snapshot', jsonApi((req, res) => {
            return this.getUpdates(res.locals.language, req.params.snapshot);
        }));*/

      // This express.use() call must always go last.
      .use(errorHandler);
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

  private getStrip: RequestHandler = async (req, res, next) => {
    const strip = await this.comicslate.getStrip(
      new PageId(res.locals.language, req.params.comicId, req.params.stripId)
    );
    res.setHeader(
      'X-Comicslate-Strip',
      Buffer.from(JSON.stringify(strip)).toString('base64')
    );

    const stripFilename = await this.comicslate.renderStrip(
      strip,
      !req.query.refresh
    );

    this.sendFile(res, stripFilename, next);
  };

  private sendFile = (
    res: express.Response<any>,
    path: string,
    next: express.NextFunction
  ): void => {
    // sendFile is smart:
    // - it adds Content-Type automatically
    // - it handles ranged requests
    // - it adds "Cache-Control: public", "ETag" and "Last-Modified" headers
    res.sendFile(
      path,
      {
        // Do not come back for some time; then, come with ETag for cache
        // validation. sendFile will serve 304 if ETag matches.
        maxAge: '30 minutes',
      },
      err => {
        if (err) {
          console.error(`When sending ${path}: ${err}`);
          next(err);
        } else {
          console.log(`Sent file ${path}`);
        }
      }
    );
  };

  private renderStrip: RequestHandler = async (req, res, next) => {
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
    this.sendFile(res, stripFilename, next);
  };

  private embedImage: RequestHandler = async (req, res, next) => {
    const extraQueryParams = Object.keys(req.query).filter(
      param => !['id', Renderer.versionParameterName].includes(param)
    );
    if (extraQueryParams.length > 0) {
      console.error(`Extra query parameters: ${extraQueryParams}.`);
      res.redirect(
        'https://upload.wikimedia.org/wikipedia/commons/1/14/Rubber_Duck_(8374802487).jpg'
      );
      return;
    }

    if (Object.keys(req.query)) {
    }
    // TODO(dotdoom): handle links to comics / user page / strip / unknown.
    const pageInfo = await this.comicslate.doku.getPageInfo(
      req.query.id as string,
      parseInt(req.query[Renderer.versionParameterName] as string)
    );
    this.sendFile(res, await this.comicslate.renderStrip(pageInfo), next);
  };

  private embedJson: RequestHandler = async (req, res) => {
    const page = this.comicslate.pageId(req.query.id as string)!;

    const versionStr = req.query[Renderer.versionParameterName];
    let version;
    if (typeof versionStr === 'string') {
      version = parseInt(versionStr);
    }

    const strip = await this.comicslate.getStrip(page, version);
    const comic = (await this.comicslate.getComic(
      page.language,
      page.comicId
    ))!;

    return {
      version: '1.0',
      title: strip.title,
      type: 'photo',
      // TODO(dotdoom): resolve to real author name.
      author_name: `${strip.author}, ${moment(strip.lastModified)
        .locale(res.locals.language)
        .fromNow()}`,
      author_url: this.comicslate.pageURL(`user:${strip.author}`),
      provider_name: `${comic.categoryName} | ${comic.name}`,
      provider_url: comic.homePageURL,
    };
  };
}
