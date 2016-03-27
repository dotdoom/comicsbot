#!/usr/bin/env python2.7
# coding: utf-8

import inspect
import logging
logging.basicConfig()

from comicsbot import ComicsBot
from dokuwiki import DokuWiki

execfile("config.py")

w = DokuWiki()
if w.dokuwiki.login(config["dokuwiki"]["username"],
        config["dokuwiki"]["password"]):
    welcome_message = "Hello! I've connected to wiki version %s, " \
        "xmlrpc %s" % (w.dokuwiki.getVersion(),
                w.dokuwiki.getXMLRPCAPIVersion())
else:
    welcome_message = "Hi! I cannot authorize to the wiki."
    w = None

bot = ComicsBot(config["jabber"]["username"],
        config["jabber"]["password"], debug=True, wiki=w)
bot.join_room(config["jabber"]["room"], config["jabber"]["nick"])
bot.send(config["jabber"]["room"], welcome_message, message_type="groupchat")
bot.serve_forever()
