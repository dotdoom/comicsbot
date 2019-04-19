import * as acceptLanguage from 'accept-language-parser';
import * as bodyParser from 'body-parser';
import escapeStringRegexp from 'escape-string-regexp';
import { Application, RequestHandler } from 'express';
import { dirSync } from 'tmp';
import { URL } from 'url';
import { Doku } from './doku';
import { Renderer } from './render';

const preferredLanguage = (preferredLanguageCode: string): RequestHandler => {
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

export class App {
    private readonly app: Application;
    private readonly render: Renderer;
    private readonly doku: Doku;
    private readonly baseUrl: URL;

    constructor(app: Application, render: Renderer, doku: Doku, baseUrl: URL) {
        this.app = app;
        this.render = render;
        this.doku = doku;
        this.baseUrl = baseUrl;

        app.use(
            bodyParser.urlencoded({ extended: true }),
            bodyParser.json(),
            preferredLanguage('ru'),
        );

        app.get('/strips/:id', async (req, res) => {
            res.json({});
        });
        app.get('/strips/:id/render', this.stripRender);
        app.get('/comics', this.comics);
        app.get('/comics/:id', async (req, res) => {

        });
        app.get('/updates/:timestamp', async (req, res) => {
            res.json({});
        });
    }

    private stripRender: RequestHandler = async (req, res) => {
        const pageId = [res.locals.language, req.params.id].join(':');
        try {
            const dir = dirSync();
            try {
                const page = await this.render.renderSinglePage(
                    pageId, dir.name);
                if (page.pageURL) {
                    if (page.boxes.length == 1) {
                        res.sendFile(page.boxes[0].path);
                    } else {
                        res.json(`${page.boxes.length} boxes found`)
                            .status(400);
                    }
                } else {
                    res.json('Page URL can not be computed').status(400);
                }
            } finally {
                dir.removeCallback();
            }
        } catch (e) {
            console.error(e);
            res.json(`Error: ${e}`).status(503);
        }
    }

    private comics: RequestHandler = async (req, res) => {
        res.json(await this.getComics(res.locals.language));
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
        for (
            let comicIdParser = (new RegExp(
                '^(' +
                escapeStringRegexp(language) +
                ':)?(.*?)(:index)?$')).exec(comic.id); comicIdParser;) {
            comic.id = comicIdParser[2];
            comic.numberOfStrips = (await this.doku.getPagelist(
                comicIdParser[1] + comicIdParser[2])).length;
            break;
        }

        for (let titleMatch = indexPage.match(/=([^=]+?)=/); titleMatch;) {
            comic.name = titleMatch[1].trim();
            break;
        }

        for (
            let imageMatch = indexPage.match(
                /{{([^}]+[.](png|jpe?g)[^|}]+)[^}]*}}/);
            imageMatch;) {
            comic.thumbnailURL = this.pageURL(
                ['_media', comic.id, imageMatch[1].trim()].join('/'));
            break;
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

    private comicsCache?: Comic[];

    private getComics = async (language: string): Promise<Comic[]> => {
        if (this.comicsCache) {
            return this.comicsCache;
        }

        const menu = (await this.doku.getPage(`${language}:menu`)).split('\n');
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
        return (this.comicsCache = await Promise.all(comics));
    }
}
