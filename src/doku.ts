import * as url from 'url';
import * as xmlrpc from 'xmlrpc';

// Fix for https://github.com/baalexander/node-xmlrpc/issues/152.
((xmlrpc.dateFormatter.constructor as unknown) as {
  ISO8601: RegExp;
}).ISO8601 = new RegExp(
  '([0-9]{4})([-]?([0-9]{2}))([-]?([0-9]{2}))' +
    '(T([0-9]{2})(((:?([0-9]{2}))?((:?([0-9]{2}))?([.]([0-9]+))?))?)' +
    '(Z|([+-]([0-9]{2}(:?([0-9]{2}))?)))?)?'
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
  const date = new Date(0);
  date.setUTCSeconds(seconds);
  return date;
}

export class Doku {
  private readonly client: xmlrpc.Client;

  constructor(client: xmlrpc.Client) {
    this.client = client;
  }

  login = async (user: string, password: string): Promise<boolean> =>
    (await this.methodCall('dokuwiki.login', [user, password])) === true;

  getTime = async () =>
    utcSecondsToDate((await this.methodCall('dokuwiki.getTime', [])) as number);

  getTitle = async () =>
    (await this.methodCall('dokuwiki.getTitle', [])) as string;

  getVersion = async () =>
    (await this.methodCall('dokuwiki.getVersion', [])) as string;

  getPagelist = async (namespace: string, options?: SearchAllPagesOptions) =>
    ((await this.methodCall('dokuwiki.getPagelist', [
      namespace,
      options,
    ])) as Array<{
      id: string;
      rev: number;
      mtime: number;
      size: number;
      hash?: string;
    }>).map(page => {
      return {
        id: page.id,
        rev: page.rev,
        // mtime is in UTC: https://bugs.dokuwiki.org/1625.html
        mtime: utcSecondsToDate(page.mtime),
        size: page.size,
        hash: page.hash,
      } as Page;
    });

  getPageInfo = async (pagename: string, version?: number) =>
    (await (version
      ? this.methodCall('wiki.getPageInfoVersion', [
          pagename,
          // Making sure version is an integer.
          Math.round(version),
        ])
      : this.methodCall('wiki.getPageInfo', [pagename]))) as PageInfo;

  getPage = (pagename: string, version?: number) =>
    (version
      ? this.methodCall('wiki.getPageVersion', [
          pagename,
          // Making sure version is an integer.
          Math.round(version),
        ])
      : this.methodCall('wiki.getPage', [pagename])) as Promise<string>;

  getCookies = (): Cookie[] => {
    const cookies = this.client.cookies;
    if (cookies !== undefined) {
      const domain = new url.URL(this.client.options.url!).host || undefined;
      return cookies
        .toString()
        .split(';')
        .map(keyAndValue => {
          const [key, value] = keyAndValue.split('=', 2);
          return {
            name: key,
            value,
            domain,
          };
        });
    }
    return [];
  };

  getRecentChanges = (timestamp: number): Promise<PageInfo[]> =>
    this.methodCall('wiki.getRecentChanges', [timestamp]) as Promise<
      PageInfo[]
    >;

  getRecentMediaChanges = (timestamp: number): Promise<MediaInfo[]> =>
    this.methodCall('wiki.getRecentMediaChanges', [timestamp]) as Promise<
      MediaInfo[]
    >;

  private methodCall = (method: string, params: Array<{} | undefined>) =>
    new Promise((resolve, reject) =>
      this.client.methodCall(method, params, (error, value) => {
        if (error) {
          reject(error);
        } else {
          resolve(value);
        }
      })
    );
}
