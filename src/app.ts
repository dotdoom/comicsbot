import * as acceptLanguage from 'accept-language-parser';
import * as bodyParser from 'body-parser';
import { Application, RequestHandler } from 'express';
import { dirSync } from 'tmp';
import { Comicslate } from './comicslate';
import { Renderer } from './render';

const clientLanguage = (preferredLanguageCode: string): RequestHandler => {
    return (req, res, next) => {
        const acceptLanguageHeader = req.header('Accept-Language');
        // If unspecified, language is the one server prefers.
        res.locals.language = preferredLanguageCode;
        if (acceptLanguageHeader) {
            const languages = acceptLanguage.parse(
                acceptLanguageHeader);
            if (languages.length > 0) {
                // If requestor doesn't know server preferred language
                // at 0.5 quality, pick the one requestor knows best.
                res.locals.language = languages[0].code;
                for (let language of languages) {
                    if (language.code == preferredLanguageCode &&
                        language.quality >= 0.5) {
                        res.locals.language = preferredLanguageCode;
                        break;
                    }
                }
            }
        }

        next();
    }
}

const jsonApi = (handler: RequestHandler): RequestHandler => {
    return async (req, res, next) => {
        try {
            let reply = handler(req, res, next);
            while (reply instanceof Promise) {
                reply = await reply;
            }
            if (reply !== undefined) {
                res.json(reply);
            }
        } catch (e) {
            console.error(
                'Error while processing', req.url,
                '\n-> PARAMS:', req.params,
                '\n-> LOCALS:', res.locals,
                '\n-> QUERY :', req.query,
                '\n-> ', e.toString(), '\n', e.stack);
            res.status(503).json(e.toString());
        }
    };
}

export class App {
    private readonly render: Renderer;
    private readonly comicslate: Comicslate;

    constructor(app: Application, render: Renderer, comicslate: Comicslate) {
        this.render = render;
        this.comicslate = comicslate;

        app.use(
            bodyParser.urlencoded({ extended: true }),
            bodyParser.json(),
            clientLanguage('ru'),
        );

        app.get('/comics', jsonApi(async (req, res) =>
            await this.comicslate.getComics(res.locals.language)));

        app.get('/comics/:comicId/strips', jsonApi((req, res) =>
            this.comicslate.getStrips(
                res.locals.language,
                req.params.comicId,
            )));
        app.get('/comics/:comicId/strips/:stripId', jsonApi((req, res) =>
            this.comicslate.getStrip(
                res.locals.language,
                req.params.comicId,
                req.params.stripId,
            )));
        app.get('/comics/:comicId/strips/:stripId/render',
            jsonApi(this.renderStrip));

        /*app.get('/updates/:snapshot', jsonApi((req, res) => {
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

    private renderStrip: RequestHandler = async (req, res) => {
        const pageId = [
            res.locals.language,
            req.params.comicId,
            req.params.stripId,
        ].join(':');

        const dir = dirSync();
        try {
            const page = await this.render.renderSinglePage(pageId, dir.name);
            if (!page.pageURL) {
                throw new Error('Page URL can not be computed')
            }
            if (page.boxes.length != 1) {
                throw new Error(`${page.boxes.length} boxes found`);
            }
            res.sendFile(page.boxes[0].path);
        } finally {
            dir.removeCallback();
        }
    }
}
