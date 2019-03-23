import * as xmlrpc from 'xmlrpc';
import { Doku } from './doku';
import { Renderer } from './render';

export class App {
    private readonly server: xmlrpc.Server;
    private readonly render: Renderer;
    private readonly doku: Doku;

    constructor(server: xmlrpc.Server, render: Renderer, doku: Doku) {
        this.server = server;
        this.render = render;
        this.doku = doku;

        xmlrpc.dateFormatter.setOpts({ local: false });

        server.on('comicslate.getTime', async (error, params, callback) => {
            console.log(`comicslate.getTime: ${params}`);
            callback(null, await doku.getTime());
        });
    }
}
