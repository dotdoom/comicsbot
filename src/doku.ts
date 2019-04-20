import * as url from 'url';
import * as xmlrpc from 'xmlrpc';

// Fix for https://github.com/baalexander/node-xmlrpc/issues/152.
// @ts-ignore
xmlrpc.dateFormatter.constructor.ISO8601 = new RegExp(
    '([0-9]{4})([-]?([0-9]{2}))([-]?([0-9]{2}))'
    + '(T([0-9]{2})(((:?([0-9]{2}))?((:?([0-9]{2}))?([.]([0-9]+))?))?)'
    + '(Z|([+-]([0-9]{2}(:?([0-9]{2}))?)))?)?'
);

interface SearchAllPagesOptions {
    /// Recursion level, 0 for all.
    depth?: number;
    /// Do md5 sum of content?
    hash?: boolean;
    /// list everything regardless of ACL.
    skipacl?: boolean;
}

interface Page {
    id: string;
    rev: number;
    mtime: Date;
    size: number;
    hash?: string;
}

export interface PageInfo {
    name: string;
    lastModified: Date;
    author: string;
    version: number;
}

interface MediaInfo extends PageInfo {
    perms: string;
    size: number;
}

interface Cookie {
    name: string;
    value: string;
    domain?: string;
}

function utcSecondsToDate(seconds: number) {
    let date = new Date(0);
    date.setUTCSeconds(seconds);
    return date;
}

export class Doku {
    private readonly client: xmlrpc.Client

    constructor(client: xmlrpc.Client) {
        this.client = client;
    }

    login = async (
        user: string,
        password: string,
    ): Promise<boolean> =>
        (await this.methodCall('dokuwiki.login', [user, password])) == true;

    getTime = async () => utcSecondsToDate(
        <number>(await this.methodCall('dokuwiki.getTime', [])));

    getTitle = async () =>
        <string>(await this.methodCall('dokuwiki.getTitle', []));

    getVersion = async () =>
        <string>(await this.methodCall('dokuwiki.getVersion', []));

    getPagelist = async (
        namespace: string,
        options?: SearchAllPagesOptions,
    ) =>
        (<any[]>(await this.methodCall(
            'dokuwiki.getPagelist', [namespace, options]))).map((page) =>
                <Page>{
                    id: page.id,
                    rev: page.rev,
                    // mtime is in UTC: https://bugs.dokuwiki.org/1625.html
                    mtime: utcSecondsToDate(page.mtime),
                    size: page.size,
                    hash: page.hash,
                });

    getPageInfo = async (pagename: string) =>
        <PageInfo>(await this.methodCall('wiki.getPageInfo', [pagename]));

    getPage = (pagename: string) =>
        <Promise<string>>this.methodCall('wiki.getPage', [pagename]);

    getCookies = (): Cookie[] => {
        const cookies = this.client.cookies;
        if (cookies !== undefined) {
            let domain = url.parse(this.client.options.url!).host;
            return cookies.toString().split(';').map((keyAndValue) => {
                let [key, value] = keyAndValue.split('=', 2);
                return {
                    name: key,
                    value: value,
                    domain: domain,
                };
            });
        }
        return [];
    }

    getRecentChanges = (timestamp: number): Promise<PageInfo[]> =>
        <Promise<PageInfo[]>>this.methodCall(
            'wiki.getRecentChanges',
            [timestamp],
        );

    getRecentMediaChanges = (timestamp: number): Promise<MediaInfo[]> =>
        <Promise<MediaInfo[]>>this.methodCall(
            'wiki.getRecentMediaChanges',
            [timestamp],
        );

    private methodCall = (method: string, params: any[]) =>
        new Promise((resolve, reject) => this.client.methodCall(
            method, params, (error, value) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(value);
                }
            }));
}
