import * as fs from 'fs';
import {URL} from 'url';
import * as doku from './doku';
import {Renderer} from './render';

interface ComicRating {
  // Data available from $language:menu.
  ratingColor?: string;
  isActive?: boolean;
}

interface Comic extends ComicRating {
  id: string;
  homePageURL: URL;

  // Data available from $language:menu.
  categoryName?: string;

  // Data that has to be extracted.
  name?: string;
  thumbnailURL?: URL;
}

interface ComicStrips {
  storyStrips: string[];
}

interface Strip extends doku.PageInfo {
  // TODO(dotdoom): remove this deprecated field.
  url: URL;
  displayUrl: URL;
  shareUrl: URL;
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

  toString = () =>
    [this.language, this.comicId, this.stripId].filter(Boolean).join(':');
}

export class Comicslate {
  readonly initialized: Promise<void>;
  readonly doku: doku.Doku;
  private readonly render: Renderer;
  private readonly baseUrl: URL;
  private readonly comicsCache: {
    [language: string]: Comic[];
  } = {};

  private static readonly menuPage = ':menu';

  constructor(doku: doku.Doku, render: Renderer, baseUrl: URL) {
    this.doku = doku;
    this.baseUrl = baseUrl;
    this.render = render;

    this.initialized = this.scanAllComics();
    setInterval(this.scanAllComics, 10 * 60 * 1000);
  }

  private scanAllComics = async () => {
    for (const page of await this.doku.getPagelist('', {depth: 2})) {
      if (page.id.endsWith(Comicslate.menuPage)) {
        const language = page.id.slice(0, -Comicslate.menuPage.length);
        this.comicsCache[language] = await this.fetchMenu(language);
      }
    }
  };

  getLanguages = () => Object.keys(this.comicsCache);

  getStrips = async (
    language: string,
    comicId: string
  ): Promise<ComicStrips> => {
    const comicIdPrefix = [language, comicId].join(':');
    return {
      storyStrips: (await this.doku.getPagelist(comicIdPrefix))
        .map(s => s.id.substring(comicIdPrefix.length + 1))
        .filter(s => s.match(/^\d+$/)),
    };
  };

  getStrip = async (
    // TODO(dotdoom): accept PageId class.
    language: string,
    comicId: string,
    stripId: string
  ): Promise<Strip> => {
    const pageId = [language, comicId, stripId].join(':');
    const strip: Strip = {
      url: this.pageURL(pageId, true),
      displayUrl: this.pageURL(pageId, true),
      shareUrl: this.pageURL(pageId),
      ...(await this.doku.getPageInfo(pageId)),
    };

    const pageText = await this.doku.getPage(pageId);
    const titleMatch = pageText.match(/[*][*]([^*]+)[*][*]/);
    if (titleMatch) {
      strip.title = titleMatch[1];
    }

    return strip;
  };

  renderStrip = async (
    page: doku.PageInfo,
    allowCache = true
  ): Promise<string> => {
    const pageUrl = this.pageURL(page.name, true);

    if (allowCache) {
      const renderedFilename = this.render.renderFilename(pageUrl);
      try {
        const renderedFileStat = fs.statSync(renderedFilename);
        if (renderedFileStat.mtime.getTime() >= page.lastModified.getTime()) {
          return renderedFilename;
        }
      } catch (e) {
        // Might be that either the rendered file or the page itself
        // does not exist.
      }
    }
    return this.render.renderSinglePage(pageUrl);
    // fs.utimesSync(renderedFilename, pageInfo.lastModified,
    //               pageInfo.lastModified);
  };

  getComics = (language: string) => this.comicsCache[language];

  getComic = (language: string, comicId: string) => {
    const comics = this.getComics(language);
    if (comics) {
      for (const comic of comics) {
        if (comic.id === comicId) {
          return comic;
        }
      }
    }
    return null;
  };

  private fetchComics = async (
    language: string,
    menuEntry: string,
    categoryName: string | undefined,
    ratings: ComicRating[]
  ): Promise<Comic[]> => {
    menuEntry = this.pathToId(menuEntry);
    const indexPage = await this.doku.getPage(menuEntry.toString());

    const comicTemplate: Comic = {
      id: menuEntry.replace(/:index$/, ''),
      homePageURL: this.pageURL(menuEntry),
      categoryName,
    };

    if (comicTemplate.id.startsWith(language + ':')) {
      comicTemplate.id = comicTemplate.id.substring(language.length + 1);
    }

    const titleMatch = indexPage.match(/=([^=]+?)=/);
    if (titleMatch) {
      comicTemplate.name = titleMatch[1].trim();
    }

    const imageMatch = indexPage.match(/{{([^}]+[.](png|jpe?g)[^|}]+)[^}]*}}/);
    if (imageMatch) {
      comicTemplate.thumbnailURL = this.pageURL(
        ['_media', comicTemplate.id, imageMatch[1].trim()].join('/')
      );
    }

    const cnavMatch = indexPage.match(/[{]cnav(>([^}]+))?[}]/);
    if (cnavMatch) {
      // TODO(dotdoom): #story cnavMatch[2] is the 1st strip.
      const comic: Comic = {
        ...comicTemplate,
        ...ratings[0],
      };
      return [comic];
    }

    const cnavMultiMatch = indexPage.match(/[{][{]section>[^#]+[/]index#cnav/g);
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
  };

  private parseComicRating = (rating: string) => {
    const isActive = rating.startsWith('@');
    return {
      ratingColor: rating.slice(1, -1),
      isActive,
    };
  };

  pageURL = (id: string, onlyPageContent = false) => {
    const url = new URL('/' + id.replace(/:/g, '/'), this.baseUrl);
    if (onlyPageContent) {
      url.searchParams.set('do', 'export_xhtml');
    }
    return url;
  };

  private pathToId = (path: string) =>
    path
      .replace(/[/]+/g, ':') // Replace slashes with colons.
      .replace(/^[:]+/, ''); // Remove leading slash.

  parsePageURL = (url: URL) => {
    const fullId = this.pathToId(url.pathname)
      .replace(/^_media:/, '') // Remove leading _media part.
      .replace(/[.].*$/, ''); // Remove extension (for _media links).

    for (const language in this.comicsCache) {
      if (fullId.startsWith(language + ':')) {
        const comicAndStripId = fullId.substring(language.length + 1);
        if (comicAndStripId.indexOf(':') < 0) {
          return new PageId(language, comicAndStripId);
        } else {
          const parser = comicAndStripId.match(/^(.+):([^:]+)$/);
          if (parser) {
            return new PageId(language, parser[1], parser[2]);
          }
        }
      }
    }
    return null;
  };

  private fetchMenu = async (language: string): Promise<Comic[]> => {
    const menu = (
      await this.doku.getPage(language + Comicslate.menuPage)
    ).split('\n');
    const comics: Array<Promise<Comic[]>> = [];
    let categoryName: string | undefined = undefined;
    for (const line of menu) {
      let match: RegExpMatchArray | null;
      if (
        // tslint:disable-next-line:no-conditional-assignment
        (match = line.match(/=+([^=]+)=+/))
      ) {
        categoryName = match[1].trim();
      } else if (line.indexOf('add?do=edit') >= 0) {
        // "Add new comics" line, ignore.
        continue;
      } else if (
        // tslint:disable-next-line:no-conditional-assignment
        (match = line.match(/\*.*\[\[([^\]]+)\]\](.*)/))
      ) {
        const ratings = match[2].match(/[@*]\w+[@*]/g) || [];
        comics.push(
          this.fetchComics(
            language,
            match[1],
            categoryName,
            ratings.map(r => this.parseComicRating(r))
          )
        );
      }
    }
    return ([] as Comic[]).concat(...(await Promise.all(comics)));
  };
}
