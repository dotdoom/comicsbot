import * as acceptLanguage from 'accept-language-parser';
import * as bodyParser from 'body-parser';
import escapeStringRegexp from 'escape-string-regexp';
import { Application, RequestHandler } from 'express';
import { dirSync } from 'tmp';
import { URL } from 'url';
import { Doku, PageInfo } from './doku';
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
                '\n -> LOCALS:', res.locals,
                '\n -> QUERY :', req.query,
                '\n -> ', e.toString(), e.stack);
            res.status(503).json(e.toString());
        }
    };
}

interface Comic {
    // Data available from $language:menu.
    id: string;
    homePageURL: URL;
    category?: string;
    ratingColor?: string,
    isActive?: boolean,

    // Data that has to be extracted.
    name?: string;
    numberOfStrips?: number;
    thumbnailURL?: URL;
}

interface Strip extends PageInfo {
    title?: string;
}

export class App {
    private readonly render: Renderer;
    private readonly doku: Doku;
    private readonly baseUrl: URL;

    constructor(app: Application, render: Renderer, doku: Doku, baseUrl: URL) {
        this.render = render;
        this.doku = doku;
        this.baseUrl = baseUrl;

        app.use(
            bodyParser.urlencoded({ extended: true }),
            bodyParser.json(),
            clientLanguage('ru'),
        );

        app.get('/strips/:id', jsonApi(this.getStrip));
        app.get('/strips/:id/render', jsonApi(this.renderStrip));

        let comicsCache: Comic[] | undefined;
        app.get('/comics', jsonApi(async (req, res) =>
            (comicsCache = comicsCache ||
                await this.getComics(res.locals.language))));
        app.get('/comics/:id', async (req, res) => {

        });
        app.get('/updates/:timestamp', async (req, res) => {
            res.json({});
        });
    }

    private getStrip: RequestHandler = async (req, res) => {
        const pageId = [res.locals.language, req.params.id].join(':');
        const pageText = await this.doku.getPage(pageId);

        const strip: Strip = await this.doku.getPageInfo(pageId);
        const titleMatch = pageText.match(/[*][*]([^*]+)[*][*]/);
        if (titleMatch) {
            strip.title = titleMatch[1];
        }

        return strip;
    }

    private renderStrip: RequestHandler = async (req, res) => {
        const pageId = [res.locals.language, req.params.id].join(':');

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

    private pageURL = (id: string) => new URL('/' + id.replace(/:/g, '/'),
        this.baseUrl);

    private processComic = async (
        language: string,
        comic: Comic,
    ): Promise<Comic> => {
        const indexPage = await this.doku.getPage(comic.id);

        // When comic arrives to us, its id is normally in the form:
        //   $language:$comicId[:index]
        // we need $language and :index to form a URL, and otherwise throw them
        // away.
        let comicIdMatch = (new RegExp('^(' +
            escapeStringRegexp(language) +
            ':)?(.*?)(:index)?$')).exec(comic.id);
        if (comicIdMatch) {
            comic.id = comicIdMatch[2];
            comic.numberOfStrips = (await this.doku.getPagelist(
                comicIdMatch[1] + comicIdMatch[2])).length;
        }

        let titleMatch = indexPage.match(/=([^=]+?)=/);
        if (titleMatch) {
            comic.name = titleMatch[1].trim();
        }

        let imageMatch = indexPage.match(
            /{{([^}]+[.](png|jpe?g)[^|}]+)[^}]*}}/);
        if (imageMatch) {
            comic.thumbnailURL = this.pageURL(
                ['_media', comic.id, imageMatch[1].trim()].join('/'));
        }

        return comic;
    }

    private parseComicsRating = (rating: string) => {
        const isActive = rating.startsWith('@');
        return {
            ratingColor: rating.slice(1, -1),
            isActive: isActive,
        };
    }

    private getComics = async (language: string): Promise<Comic[]> => {
        const menu = (await this.doku.getPage(`${language}: menu`)).split('\n');
        const comics: Promise<Comic>[] = [];
        let categoryName: string | undefined = undefined;
        for (const line of menu) {
            let match: RegExpMatchArray | null;
            if (match = line.match(/<spoiler[|](.*)>/)) {
                categoryName = match[1];
            } else if (match = line.match(/\[\[([^\]]+)\]\](.*)/)) {
                const ratings = match[2].match(/[@*]\w+[@*]/g);
                comics.push(this.processComic(language, {
                    id: match[1],
                    category: categoryName,
                    homePageURL: this.pageURL(match[1]),
                    ...(ratings ? this.parseComicsRating(ratings[0]) : null),
                }));
            }
        }
        return Promise.all(comics);
    }
}
