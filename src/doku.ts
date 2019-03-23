import * as url from "url";
import * as xmlrpc from 'xmlrpc';

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
    private client: xmlrpc.Client

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
                });

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
