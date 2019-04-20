import escapeStringRegexp from 'escape-string-regexp';
import { URL } from 'url';
import * as doku from './doku';

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

interface Strip extends doku.PageInfo {
    url: URL;
    title?: string;
}

class PageId {
    readonly language: string;
    readonly comicId: string;
    readonly stripId?: string;

    constructor(language: string, comicId: string, stripId?: string) {
        this.language = language;
        this.comicId = comicId;
        this.stripId = stripId;
    }

    toString = () => [this.language, this.comicId, this.stripId]
        .filter(Boolean)
        .join(':');
}

export class Comicslate {
    private readonly doku: doku.Doku;
    private readonly baseUrl: URL;
    private readonly comicsCache: {
        [language: string]: Comic[];
    } = {};

    constructor(doku: doku.Doku, baseUrl: URL) {
        this.doku = doku;
        this.baseUrl = baseUrl;
    }

    getStrips = async (
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

    getStrip = async (
        language: string,
        comicId: string,
        stripId: string,
    ): Promise<Strip> => {
        const pageId = [language, comicId, stripId].join(':');
        const strip: Strip = {
            url: this.pageURL(pageId, true),
            ...await this.doku.getPageInfo(pageId),
        }

        const pageText = await this.doku.getPage(pageId);
        const titleMatch = pageText.match(/[*][*]([^*]+)[*][*]/);
        if (titleMatch) {
            strip.title = titleMatch[1];
        }

        return strip;
    }

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

    getComics = async (language: string): Promise<Comic[]> => {
        if (!(language in this.comicsCache)) {
            const refreshCache = async () =>
                this.comicsCache[language] = await this.fetchComics(language);
            await refreshCache();
            setInterval(refreshCache, (Math.random() * 5 + 7) * 60 * 1000);
        }
        return this.comicsCache[language];
    }

    private pageURL = (id: string, html: boolean = false) => {
        const url = new URL('/' + id.replace(/:/g, '/'), this.baseUrl);
        if (html) {
            url.searchParams.set('do', 'export_xhtml');
        }
        return url;
    }

    parsePageURL = async (url: URL): Promise<PageId | undefined> => {
        const fullId = url.pathname
            .replace(/^[/]/, '')
            .replace(/[/]+/g, ':')
            .replace(/^_media:/, '')
            .replace(/[.]\w+$/, '');
        // Can't do much better here, we really need a language to fetch comics.
        const languageMatch = fullId.match(/^(..):(.*)$/);
        if (languageMatch) {
            const language = languageMatch[1];
            const comicAndStripId = languageMatch[2];
            for (const comic of await this.getComics(language)) {
                if (comicAndStripId.indexOf(comic.id) == 0) {
                    return new PageId(
                        language,
                        comic.id,
                        comicAndStripId == comic.id ?
                            undefined :
                            comicAndStripId.substring(comic.id.length + 1),
                    );
                }
            }
        }
    }

    private fetchComics = async (language: string): Promise<Comic[]> => {
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
                const ratings = match[2].match(/[@*]\w+[@*]/g);
                comics.push(this.getComic(language, {
                    category: categoryName,
                    ...this.createComicObject(match[1]),
                    ...(ratings ? this.parseComicRating(ratings[0]) : {}),
                }));
            }
        }
        return Promise.all(comics);
    }
}
