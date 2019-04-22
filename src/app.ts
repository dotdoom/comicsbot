import * as acceptLanguage from 'accept-language-parser';
import * as bodyParser from 'body-parser';
import { Application, RequestHandler } from 'express';
import fs from 'fs';
import morgan from 'morgan';
import { Comicslate } from './comicslate';
import { Renderer } from './render';

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
    for (const language in serverPreference) {
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
                    const quality = clientLanguage.quality *
                        serverPreference[clientLanguage.code];
                    if (quality > maxQuality) {
                        maxQuality = quality;
                        res.locals.language = clientLanguage.code;
                    }
                }
            }
            console.info(`For ${acceptLanguageHeader} picked ` +
                `${res.locals.language};q=${maxQuality}`);
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
            morgan('dev'),
            bodyParser.urlencoded({ extended: true }),
            bodyParser.json(),
            clientLanguage(this.comicslate),
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
        const pageUrl = await this.comicslate.pageURL([
            res.locals.language,
            req.params.comicId,
            req.params.stripId,
        ].join(':'), true);

        const fileName = this.render.renderFilename(pageUrl);
        const sendFileOptions = {
            maxAge: 7 * 24 * 60 * 60 * 1000,
        };
        if (fs.existsSync(fileName)) {
            res.sendFile(fileName, sendFileOptions);
        } else {
            res.sendFile((await this.render.renderSinglePage(pageUrl)).path,
                sendFileOptions);
        }

        /*console.log(`time on server: ${await doku.getTime()}`);
        let stats = fs.statSync("/tmp/page");
        console.log(`file: ${stats.mtime} (${stats.mtime.getTime()})`);
        const date = (await doku.getPageInfo('ru:user:dot')).lastModified;
        console.log(`page: ${date}`);
        //console.log(`page == file: ${stats.mtime.getTime() === date.getTime()}`);
        fs.utimesSync('/tmp/page', date, date);*/
    }
}
