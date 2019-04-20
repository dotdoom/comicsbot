import { URL } from 'url';
import * as doku from './doku';

interface ComicRating {
    // Data available from $language:menu.
    ratingColor?: string,
    isActive?: boolean,
}

interface Comic extends ComicRating {
    id: string;
    homePageURL: URL;

    // Data available from $language:menu.
    category?: string;
    categoryName?: string;

    // Data that has to be extracted.
    name?: string;
    thumbnailURL?: URL;
}

interface ComicStrips {
    storyStrips: string[];
}

interface Strip extends doku.PageInfo {
    url: URL;
    title?: string;
}

class PageId {
    language: string;
    comicId: string;
    stripId?: string;

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
    readonly initialized: Promise<void>;

    private readonly doku: doku.Doku;
    private readonly baseUrl: URL;
    private readonly comicsCache: {
        [language: string]: Comic[];
    } = {};

    private static readonly menuPage = ':menu';

    constructor(doku: doku.Doku, baseUrl: URL) {
        this.doku = doku;
        this.baseUrl = baseUrl;

        this.initialized = this.scanAllComics();
        setInterval(this.scanAllComics, 10 * 60 * 1000);
    }

    private scanAllComics = async () => {
        for (const page of (await this.doku.getPagelist('', { depth: 2 }))) {
            if (page.id.endsWith(Comicslate.menuPage)) {
                const language = page.id.slice(0, -Comicslate.menuPage.length);
                this.comicsCache[language] = await this.fetchMenu(language);
            }
        }
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

    getComics = (language: string) => this.comicsCache[language];

    getComic = (language: string, comicId: string) => {
        const comics = this.getComics(language);
        if (comics) {
            for (const comic of comics) {
                if (comic.id == comicId) {
                    return comic;
                }
            }
        }
    }

    private fetchComics = async (
        language: string,
        menuEntry: string,
        categoryName: string | undefined,
        ratings: ComicRating[],
    ): Promise<Comic[]> => {
        menuEntry = this.pathToId(menuEntry);
        const indexPage = await this.doku.getPage(menuEntry.toString());

        const comicTemplate: Comic = {
            id: menuEntry.replace(/:index$/, ''),
            homePageURL: this.pageURL(menuEntry),
            category: categoryName,
            categoryName: categoryName,
        }

        if (comicTemplate.id.startsWith(language + ':')) {
            comicTemplate.id = comicTemplate.id.substring(language.length + 1);
        }

        let titleMatch = indexPage.match(/=([^=]+?)=/);
        if (titleMatch) {
            comicTemplate.name = titleMatch[1].trim();
        }

        let imageMatch = indexPage.match(
            /{{([^}]+[.](png|jpe?g)[^|}]+)[^}]*}}/);
        if (imageMatch) {
            comicTemplate.thumbnailURL = this.pageURL(
                ['_media', comicTemplate.id, imageMatch[1].trim()].join('/'));
        }

        const cnavMatch = indexPage.match(/[{]cnav(>([^}]+))?[}]/);
        if (cnavMatch) {
            // TODO(dotdoom): #story cnavMatch[2] is the 1st strip.
            const comic: Comic = {
                ...comicTemplate,
                ...ratings[0],
            }
            return [comic];
        }

        const cnavMultiMatch = indexPage.match(
            /[{][{]section>[^#]+[/]index#cnav/g);
        if (cnavMultiMatch) {
            const comics: Comic[] = [];
            for (const cnav of cnavMultiMatch) {
                const subcomicMatch = cnav.match(/>[./]*([^#]+)[/]index/);
                if (subcomicMatch) {
                    comics.push({
                        ...comicTemplate,
                        id: comicTemplate.id + ':' + subcomicMatch[1],
                        name: comicTemplate.name + ` #${comics.length + 1}`,
                    });
                }
            }
            comics.forEach((c, index) => {
                if (index < ratings.length) {
                    Object.assign(c, ratings[index]);
                }
            });

            return comics;
        }

        return [];
    }

    private parseComicRating = (rating: string) => {
        const isActive = rating.startsWith('@');
        return {
            ratingColor: rating.slice(1, -1),
            isActive: isActive,
        };
    }

    pageURL = (id: string, html: boolean = false) => {
        const url = new URL('/' + id.replace(/:/g, '/'), this.baseUrl);
        if (html) {
            url.searchParams.set('do', 'export_xhtml');
        }
        return url;
    }

    private pathToId = (path: string) => path
        .replace(/[/]+/g, ':')  // Replace slashes with colons.
        .replace(/^[:]+/, '');  // Remove leading slash.

    parsePageURL = async (url: URL): Promise<PageId | undefined> => {
        const fullId = this.pathToId(url.pathname)
            .replace(/^_media:/, '')  // Remove leading _media part.
            .replace(/[.].*$/, '');  // Remove extension (for _media links).

        for (const language in this.comicsCache) {
            if (fullId.startsWith(language + ':')) {
                const comicAndStripId = fullId.substring(language.length + 1);
                if (comicAndStripId.indexOf(':') < 0) {
                    return new PageId(
                        language,
                        comicAndStripId,
                    );
                } else {
                    const parser = comicAndStripId.match(/^(.+):([^:]+)$/);
                    if (parser) {
                        return new PageId(
                            language,
                            parser[1],
                            parser[2],
                        );
                    }
                }
            }
        }
    }

    private fetchMenu = async (language: string): Promise<Comic[]> => {
        const menu = (await this.doku.getPage(language + Comicslate.menuPage))
            .split('\n');
        const comics: Promise<Comic[]>[] = [];
        let categoryName: string | undefined = undefined;
        for (const line of menu) {
            let match: RegExpMatchArray | null;
            if (match = line.match(/<spoiler[|](.*)>/)) {
                categoryName = match[1];
            } else if (line.indexOf('add?do=edit') >= 0) {
                // "Add new comics" line, ignore.
                continue;
            } else if (match = line.match(/\[\[([^\]]+)\]\](.*)/)) {
                const ratings = match[2].match(/[@*]\w+[@*]/g) || [];
                comics.push(this.fetchComics(
                    language,
                    match[1],
                    categoryName,
                    ratings.map((r) => this.parseComicRating(r)),
                ));
            }
        }
        return (<Comic[]>[]).concat(...await Promise.all(comics));
    }
}
