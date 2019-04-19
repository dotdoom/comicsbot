import * as acceptLanguage from 'accept-language-parser';
import * as bodyParser from 'body-parser';
import { Application, RequestHandler } from 'express';
import { dirSync } from 'tmp';
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

interface Comics {
    id: string;
    name: string;
    numberOfStrips: number;
    homePageURL: string;
    thumbnailURL: string;
    rating: number;
    updatedAt: Date;
}

interface ComicsCategory {
    name: string;
    id: string;
    comicses: Comics[];
}

export class App {
    private readonly app: Application;
    private readonly render: Renderer;
    private readonly doku: Doku;

    constructor(app: Application, render: Renderer, doku: Doku) {
        this.app = app;
        this.render = render;
        this.doku = doku;

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
        res.json(this.parseMenuPage(
            res.locals.language,
            await this.doku.getPage(`${res.locals.language}:menu`),
        ));
    }

    private comicsRateToInt = (rate: string) => {
        switch (rate) {
            case 'GOLD': return 5;
            case 'SILV': return 4;
            case 'BRNZ': return 3;
            case 'PUST': return 2;
            default: return 1;
        }
    }

    private parseMenuPage = (
        language: string,
        menu: string,
    ): ComicsCategory[] => {
        const categories: ComicsCategory[] = [];

        for (let categoryText of menu.split('<spoiler|')) {
            const categoryParser = /([^>]+)>([\S\s]*)/m.exec(categoryText);
            if (!categoryParser) {
                continue;
            }
            const comicsParserRe =
                /\[\[([^\]?]+)\]\](\s*[@*]([a-z]+)[@*])*/gi;

            const category: ComicsCategory = {
                name: categoryParser[1],
                id: '',
                comicses: [],
            };
            categories.push(category);

            let longestPath: string[] = [];
            while (true) {
                const comicsParser = comicsParserRe.exec(categoryParser[2]);
                if (!comicsParser) {
                    break;
                }

                const comicsId = comicsParser[1].split(':');
                if (comicsId[0] == language) {
                    comicsId.splice(0, 1);
                }

                if (longestPath.length == 0) {
                    longestPath = comicsId;
                }

                for (
                    let i = 0;
                    i < longestPath.length && i < comicsId.length;
                    ++i) {
                    if (longestPath[i] != comicsId[i]) {
                        longestPath.splice(i);
                    }
                }

                category.comicses.push({
                    id: comicsId.join(':'),
                    rating: this.comicsRateToInt(comicsParser[3]),
                    name: 'PLACEHOLDER NAME',
                    numberOfStrips: 42,
                    homePageURL: 'https://comicslate.org/' + language + '/' +
                        comicsId.join('/'),
                    thumbnailURL: 'PLACEHOLDER URL',
                    updatedAt: new Date(),
                });
            }
            category.id = longestPath.join(':');
        }

        return categories;
    }
}
