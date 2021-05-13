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

  // Whether the first story strip renders without issues. Can be null until the
  // renderer returns. Useful in app's UI to filter out unsupported comics.
  firstStripRenders?: boolean;
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

export class PageId {
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
  private readonly cachePage: string;
  private readonly acceptComic: (path: string) => boolean;
  private comicsCache: {
    [language: string]: Comic[];
  } = {};

  private static readonly menuPage = ':menu';

  constructor(
    doku: doku.Doku,
    render: Renderer,
    baseUrl: URL,
    cachePage: string,
    bannedComicRegex?: string[]
  ) {
    this.doku = doku;
    this.baseUrl = baseUrl;
    this.render = render;
    this.cachePage = cachePage;

    if (bannedComicRegex) {
      const bannedComicRegexCompiled = bannedComicRegex.map(r =>
        RegExp(r, 'is')
      );
      this.acceptComic = path =>
        !bannedComicRegexCompiled.some(r => r.test(path));
    } else {
      this.acceptComic = _ => true;
    }

    this.initialized = this.scanAllComics();
    setInterval(this.scanAllComics, 10 * 60 * 1000);
  }

  private scanAllComics = async () => {
    if (!Object.keys(this.comicsCache).length) {
      try {
        this.comicsCache = JSON.parse(
          (await this.doku.getPage(this.cachePage)).replace(
            /^<code>|<[/]code>$/g,
            ''
          )
        );

        let numberOfComics = 0;
        for (const language in this.comicsCache) {
          numberOfComics += this.comicsCache[language].length;
        }
        console.info(`Loaded ${numberOfComics} comics from cache`);

        // This must have been the first invocation, and we successfully read
        // cache. Let's not block initialization on the slower process below.
        // The scan will repeat by timer later.
        return;
      } catch (e) {
        this.comicsCache = {};
        console.error(
          `Error loading comics cache from page ${this.cachePage}`,
          e
        );
      }
    }

    console.info('Scanning all comics...');
    const rootPages = (
      await this.doku.getPagelist('', {depth: 2})
    ).sort((a, b) => a.id.localeCompare(b.id));
    for (const page of rootPages) {
      if (page.id.endsWith(Comicslate.menuPage)) {
        const language = page.id.slice(0, -Comicslate.menuPage.length);
        console.log(`- Language ${language}...`);

        const comics = await this.fetchComicsForLanguage(language);
        if (
          language in this.comicsCache &&
          this.comicsCache[language].length / 2 > comics.length
        ) {
          console.error(
            '-- Existing cache is sufficiently larger than the newly ' +
              'fetched value, discarding new value ' +
              `(${this.comicsCache[language].length} >> ${comics.length})`
          );
        } else {
          this.comicsCache[language] = comics;
          console.log(`-- Loaded ${comics.length} comics`);
        }
      }
    }

    const numberOfValidComics = await this.validateAllComics();
    console.info(
      `Comics validated (valid: ${numberOfValidComics}), saving cache`
    );
    // Don't wait for the write to finish and return ASAP.
    this.doku.putPage(
      this.cachePage,
      `<code>${JSON.stringify(this.comicsCache, null, 2)}</code>`,
      `${numberOfValidComics} valid comics`
    );
  };

  private validateAllComics = async () => {
    const validations: Promise<any>[] = [];
    let numberOfValidComics = 0;

    for (const language in this.comicsCache) {
      for (const comic of this.comicsCache[language]) {
        validations.push(
          (async () => {
            const firstStripId = new PageId(language, comic.id);
            try {
              const strips = await this.getStrips(language, comic.id);
              if (!strips.storyStrips.length) {
                throw 'Empty list of story strips';
              }
              firstStripId.stripId = strips.storyStrips[0];
              await this.renderStrip(
                await this.doku.getPageInfo(firstStripId.toString())
              );
              comic.firstStripRenders = true;
              numberOfValidComics += 1;
            } catch (e) {
              console.error(
                `Failed to render the 1st story strip (${firstStripId}):`,
                e
              );
              comic.firstStripRenders = false;
            }
          })()
        );
      }
    }

    await Promise.all(validations);
    return numberOfValidComics;
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

  getStrip = async (pageId: PageId, version?: number): Promise<Strip> => {
    const strip: Strip = {
      url: this.pageURL(pageId.toString(), true),
      displayUrl: this.pageURL(pageId.toString(), true),
      shareUrl: this.pageURL(pageId.toString(), false),
      ...(await this.doku.getPageInfo(pageId.toString(), version)),
    };

    const pageText = await this.doku.getPage(pageId.toString(), version);
    const titleMatch = pageText.match(/[*][*]([^*]+)[*][*]/);
    if (titleMatch) {
      strip.title = titleMatch[1];
    }
    if (version) {
      strip.title += ` @ ${version}`;
    }

    return strip;
  };

  renderStrip = async (
    page: doku.PageInfo,
    allowCache = true
  ): Promise<string> => {
    const pageUrl = this.pageURL(page.name, true, page.version);

    if (allowCache) {
      const renderedFilename = this.render.renderFilename(pageUrl);
      if (fs.existsSync(renderedFilename)) {
        return renderedFilename;
      }
    }
    return this.render.renderSinglePage(pageUrl);
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

  private fetchComicsForMenuEntry = async (
    language: string,
    menuEntry: string,
    categoryName: string | undefined,
    ratings: ComicRating[]
  ): Promise<Comic[]> => {
    if (!this.acceptComic(menuEntry)) {
      console.warn(`Comic '${menuEntry}' has not been accepted, skipping.`);
      return [];
    }

    menuEntry = this.pathToId(menuEntry);
    const indexPage = await this.doku.getPage(menuEntry.toString());

    if (indexPage.match('<note adult>')) {
      console.warn(`Comic '${menuEntry}' is marked Adult Content, skipping.`);
      return [];
    }

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

  pageURL = (id: string, onlyPageContent = false, version?: number) => {
    const url = new URL('/' + id.replace(/:/g, '/'), this.baseUrl);
    if (onlyPageContent) {
      url.searchParams.set('do', 'export_xhtml');
    }
    if (version) {
      url.searchParams.set(Renderer.versionParameterName, version.toString());
    }
    return url;
  };

  private pathToId = (path: string) =>
    path
      .replace(/[/]+/g, ':') // Replace slashes with colons.
      .replace(/^[:]+/, ''); // Remove leading slash.

  pageId = (path: string) => {
    const fullId = this.pathToId(path);
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

  private fetchComicsForLanguage = async (
    language: string
  ): Promise<Comic[]> => {
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
          this.fetchComicsForMenuEntry(
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
