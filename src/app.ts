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
                '\n-> LOCALS:', res.locals,
                '\n-> QUERY :', req.query,
                '\n-> ', e.toString(), '\n', e.stack);
            res.status(503).json(e.toString());
        }
    };
}

interface Comic {
    id: string;
    homePageURL: URL;

    // Data available from $language:menu.
    category?: string;
    ratingColor?: string,
    isActive?: boolean,

    // Data that has to be extracted.
    name?: string;
    thumbnailURL?: URL;
}

interface ComicStrips {
    storyStrips: string[];
    bonusStrips: string[];
}

interface Strip extends PageInfo {
    url: URL;
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

        let comicsCache: Comic[] | undefined;
        app.get('/comics', jsonApi(async (req, res) =>
            (comicsCache = comicsCache ||
                await this.getComics(res.locals.language, req.params.id))));
        app.get('/comics/:comicsId', jsonApi((req, res) =>
            this.getComics(res.locals.language, req.params.comicsId)));

        app.get('/comics/:comicId/strips', jsonApi((req, res) =>
            this.getStrips(res.locals.language, req.params.comicId)));
        app.get('/comics/:comicId/strips/:stripId', jsonApi((req, res) =>
            this.getStrip(
                res.locals.language,
                req.params.comicId,
                req.params.stripId,
            )));
        app.get('/comics/:comicId/strips/:stripId/render',
            jsonApi(this.renderStrip));
    }

    private getStrips = async (
        language: string,
        comicId: string,
    ): Promise<ComicStrips> => {
        const comicIdPrefix = [language, comicId].join(':');
        return {
            storyStrips: (await this.doku.getPagelist(comicIdPrefix))
                .map((s) => s.id.substring(comicIdPrefix.length + 1))
                .filter((s) => s.match(/^\d+$/)),
            bonusStrips: [],
        };
    }

    private getStrip = async (
        language: string,
        comicId: string,
        stripId: string,
    ): Promise<Strip> => {
        const pageId = [language, comicId, stripId].join(':');
        const strip: Strip = {
            url: this.pageURL(pageId),
            ...await this.doku.getPageInfo(pageId),
        }

        const pageText = await this.doku.getPage(pageId);
        const titleMatch = pageText.match(/[*][*]([^*]+)[*][*]/);
        if (titleMatch) {
            strip.title = titleMatch[1];
        }

        return strip;
    }

    private renderStrip: RequestHandler = async (req, res) => {
        const pageId = req.params.id ?
            [res.locals.language, req.params.id].join(':') :
            [
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

    private pageURL = (id: string) =>
        new URL('/' + id.replace(/:/g, '/'), this.baseUrl);

    private createComicObject = (indexId: string): Comic => {
        return {
            id: indexId,
            homePageURL: this.pageURL(indexId),
        };
    };

    private getComic = async (
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

    private parseComicRating = (rating: string) => {
        const isActive = rating.startsWith('@');
        return {
            ratingColor: rating.slice(1, -1),
            isActive: isActive,
        };
    }

    private getComics = async (
        language: string,
        id: string | undefined = undefined,
    ): Promise<Comic[]> => {
        if (!id) {
            id = '';
        }
        const menu = (await this.doku.getPage(`${language}: menu`)).split('\n');
        const comics: Promise<Comic>[] = [];
        let categoryName: string | undefined = undefined;
        for (const line of menu) {
            let match: RegExpMatchArray | null;
            if (match = line.match(/<spoiler[|](.*)>/)) {
                categoryName = match[1];
            } else if (line.indexOf('add?do=edit') >= 0) {
                // "Add new comics" line, ignore.
                continue;
            } else if (match = line.match(/\[\[([^\]]+)\]\](.*)/)) {
                if (match[1].indexOf(id) >= 0) {
                    const ratings = match[2].match(/[@*]\w+[@*]/g);
                    comics.push(this.getComic(language, {
                        category: categoryName,
                        ...this.createComicObject(match[1]),
                        ...(ratings ? this.parseComicRating(ratings[0]) : {}),
                    }));
                }
            }
        }
        return Promise.all(comics);
    }
}
